import { NextRequest, NextResponse } from "next/server";

export const GITHUB_RELEASE_API_URL =
  "https://api.github.com/repos/Lovedayjoshua/jee-aegis/releases/tags/apk-latest";
export const EXPECTED_APK_ASSET_NAME = "jee-aegis.apk";

export interface GitHubReleaseAsset {
  id?: number;
  url?: string;
  name?: string;
  size?: number;
  digest?: string;
  browser_download_url?: string;
  content_type?: string;
  updated_at?: string;
}

export interface GitHubReleasePayload {
  tag_name?: string;
  name?: string;
  body?: string;
  published_at?: string;
  assets?: GitHubReleaseAsset[];
}

export interface ResolvedApkRelease {
  available: boolean;
  version: string;
  versionCode: number;
  commitSha: string | null;
  sha256: string | null;
  buildMode: "firebase-enabled" | "non-firebase-fallback";
  releaseTag: string;
  releaseName: string | null;
  publishedAt: string | null;
  fileName: string;
  downloadUrl: string;
  directDownloadUrl: string | null;
  assetApiUrl: string | null;
  sizeBytes: number;
  reason?: string;
  httpStatus?: number;
}

export function getGitHubApiHeaders(accept = "application/vnd.github+json"): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: accept,
    "User-Agent": "JEE-AEGIS-Web-Portal/1.0",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const token = (process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "").trim();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

export async function resolveGitHubApkRelease(
  fetchImpl: typeof fetch = fetch
): Promise<ResolvedApkRelease> {
  const baseUnavailable: ResolvedApkRelease = {
    available: false,
    version: "1.2.0",
    versionCode: 3,
    commitSha: null,
    sha256: null,
    buildMode: "non-firebase-fallback",
    releaseTag: "apk-latest",
    releaseName: null,
    publishedAt: null,
    fileName: EXPECTED_APK_ASSET_NAME,
    downloadUrl: "/api/apk/download",
    directDownloadUrl: null,
    assetApiUrl: null,
    sizeBytes: 0,
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetchImpl(GITHUB_RELEASE_API_URL, {
      method: "GET",
      headers: getGitHubApiHeaders("application/vnd.github+json"),
      cache: "no-store",
      signal: controller.signal,
    });

    if (res.status === 404) {
      return {
        ...baseUnavailable,
        reason: "RELEASE_NOT_FOUND",
        httpStatus: 404,
      };
    }

    if (res.status === 403 || res.status === 429) {
      return {
        ...baseUnavailable,
        reason: "GITHUB_RATE_LIMITED",
        httpStatus: 503,
      };
    }

    if (!res.ok) {
      return {
        ...baseUnavailable,
        reason: `GITHUB_API_ERROR_${res.status}`,
        httpStatus: 502,
      };
    }

    const data = (await res.json()) as GitHubReleasePayload;
    if (!data || typeof data !== "object" || !Array.isArray(data.assets)) {
      return {
        ...baseUnavailable,
        reason: "MALFORMED_RELEASE_RESPONSE",
        httpStatus: 502,
      };
    }

    const asset =
      data.assets.find((a) => a && a.name === EXPECTED_APK_ASSET_NAME) ??
      data.assets.find(
        (a) => a && typeof a.name === "string" && a.name.toLowerCase() === EXPECTED_APK_ASSET_NAME
      );

    if (
      !asset ||
      typeof asset.browser_download_url !== "string" ||
      !asset.browser_download_url.startsWith("https://github.com/") ||
      typeof asset.size !== "number" ||
      asset.size <= 0
    ) {
      return {
        ...baseUnavailable,
        releaseName: data.name ?? null,
        publishedAt: data.published_at ?? null,
        reason: "APK_ASSET_NOT_FOUND",
        httpStatus: 404,
      };
    }

    const notesAndTitle = `${data.name ?? ""} ${data.body ?? ""}`;
    const versionMatch = notesAndTitle.match(/v?(\d+\.\d+\.\d+)/i);
    const detectedVersion = versionMatch ? versionMatch[1] : "1.2.0";
    const versionCodeMatch = notesAndTitle.match(/versionCode\s*=\s*(\d+)|build\s+(\d+)/i);
    const detectedVersionCode = versionCodeMatch
      ? Number(versionCodeMatch[1] || versionCodeMatch[2])
      : detectedVersion === "1.2.0"
      ? 3
      : 2;
    const commitMatch = notesAndTitle.match(/commit\s*=\s*([0-9a-f]{7,40})/i);
    const detectedCommit = commitMatch ? commitMatch[1] : null;
    const digestFromAsset =
      typeof asset.digest === "string" && asset.digest.startsWith("sha256:")
        ? asset.digest.slice("sha256:".length)
        : null;
    const shaMatch = notesAndTitle.match(/sha256\s*=\s*([0-9a-f]{64})/i);
    const detectedSha256 = digestFromAsset || (shaMatch ? shaMatch[1] : null);
    const isFirebaseEnabled =
      /firebase-enabled/i.test(notesAndTitle) && !/non-firebase/i.test(notesAndTitle);

    return {
      available: true,
      version: detectedVersion,
      versionCode: detectedVersionCode,
      commitSha: detectedCommit,
      sha256: detectedSha256,
      buildMode: isFirebaseEnabled ? "firebase-enabled" : "non-firebase-fallback",
      releaseTag: data.tag_name || "apk-latest",
      releaseName: data.name || "JEE AEGIS Android Connector APK",
      publishedAt: asset.updated_at ?? data.published_at ?? null,
      fileName: asset.name || EXPECTED_APK_ASSET_NAME,
      downloadUrl: `/api/apk/download?v=${encodeURIComponent(detectedVersion)}-${detectedVersionCode}-${asset.size}`,
      directDownloadUrl: asset.browser_download_url,
      assetApiUrl: typeof asset.url === "string" ? asset.url : null,
      sizeBytes: asset.size,
      httpStatus: 200,
    };
  } catch (err) {
    const isAbort = err instanceof Error && err.name === "AbortError";
    return {
      ...baseUnavailable,
      reason: isAbort ? "GITHUB_API_TIMEOUT" : "GITHUB_NETWORK_ERROR",
      httpStatus: 503,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function GET(request: NextRequest) {
  void request.nextUrl.searchParams.get("t");

  const resolved = await resolveGitHubApkRelease();

  return NextResponse.json(
    {
      available: resolved.available,
      version: resolved.version,
      versionCode: resolved.versionCode,
      commitSha: resolved.commitSha,
      sha256: resolved.sha256,
      buildMode: resolved.buildMode,
      releaseTag: resolved.releaseTag,
      releaseName: resolved.releaseName,
      publishedAt: resolved.publishedAt,
      fileName: resolved.fileName,
      downloadUrl: resolved.downloadUrl,
      directDownloadUrl: resolved.directDownloadUrl,
      sizeBytes: resolved.sizeBytes,
      ...(resolved.reason ? { reason: resolved.reason } : {}),
    },
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    }
  );
}

import { NextRequest, NextResponse } from "next/server";
import { getGitHubApiHeaders, resolveGitHubApkRelease } from "../status/route";

export async function GET(request: NextRequest) {
  void request.nextUrl.searchParams.get("t");

  const resolved = await resolveGitHubApkRelease();

  if (!resolved.available || !resolved.directDownloadUrl) {
    const status = resolved.httpStatus ?? 404;
    const message =
      resolved.reason === "RELEASE_NOT_FOUND" || resolved.reason === "APK_ASSET_NOT_FOUND"
        ? "The jee-aegis.apk release asset is not currently available under tag 'apk-latest'."
        : "Unable to retrieve the APK release from GitHub at this moment. Please try again shortly.";

    return NextResponse.json(
      {
        error: resolved.reason || "APK_BUILD_PENDING",
        message,
      },
      {
        status,
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      }
    );
  }

  // If a server-side GITHUB_TOKEN is configured (e.g. while repository is private),
  // resolve GitHub's pre-signed octet-stream redirect URL; otherwise redirect directly to browser_download_url.
  const hasServerToken = Boolean(
    (process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "").trim()
  );
  if (hasServerToken && resolved.assetApiUrl) {
    try {
      const assetRes = await fetch(resolved.assetApiUrl, {
        method: "GET",
        headers: getGitHubApiHeaders("application/octet-stream"),
        redirect: "manual",
        cache: "no-store",
      });
      const signedLocation = assetRes.headers.get("location");
      if (signedLocation && signedLocation.startsWith("https://")) {
        return NextResponse.redirect(signedLocation, {
          status: 302,
          headers: {
            "Cache-Control": "no-store, max-age=0",
          },
        });
      }
    } catch {
      // Fall back to direct browser_download_url redirect
    }
  }

  return NextResponse.redirect(resolved.directDownloadUrl, {
    status: 302,
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}

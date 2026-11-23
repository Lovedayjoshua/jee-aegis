"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Lock,
  RefreshCw,
  Shield,
  Smartphone,
  Terminal,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

interface ApkStatus {
  available: boolean;
  version: string;
  fileName: string;
  downloadUrl: string;
  expectedPath: string;
  sizeBytes: number;
  missingBuildTools: string[];
  buildCommand: string;
}

const USER_JOURNEY_STEPS = [
  "Create or sign into your JEE AEGIS account on this platform.",
  "Download JEE-AEGIS.apk onto your Android phone.",
  "Install the APK and sign in with your JEE AEGIS account.",
  "Confirm device registration to bind a per-device encrypted secret.",
  "Grant or decline permissions individually (Location, Camera, Mic, Notifications).",
  "Manage recovery actions and MediaProjection screen sharing from your dashboard.",
];

const PERMISSIONS_GUIDE = [
  {
    name: "Location (Fine / Background)",
    purpose: "Reports current and last-known coordinates with timestamps to the map.",
    required: "Optional — only for Location Tracking.",
  },
  {
    name: "Screen Capture (MediaProjection)",
    purpose: "Allows owner-initiated Android screen sharing with a persistent Stop notification.",
    required: "Optional — requires Android system prompt each session.",
  },
  {
    name: "Camera & Microphone",
    purpose: "Enables owner-authorized Camera Assistance and Live Companion voice.",
    required: "Optional — always shows a visible foreground notification.",
  },
];

export function ApkPortal() {
  const [status, setStatus] = useState<ApkStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const checkStatus = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/apk/status", { cache: "no-store" });
      if (res.ok) {
        setStatus((await res.json()) as ApkStatus);
      }
    } catch {
      // ignore transient error
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  return (
    <div className="min-w-0 space-y-4 text-slate-100 sm:space-y-6">
      <div className="rounded-2xl border border-violet-500/30 bg-gradient-to-br from-[#131936] via-[#10142c] to-[#1a1336] p-4 shadow-xl sm:p-6">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center md:gap-5">
          <div className="min-w-0 space-y-2">
            <div className="inline-flex max-w-full items-center gap-2 rounded-full border border-violet-400/30 bg-violet-500/15 px-3 py-1 text-xs font-semibold text-violet-200">
              <Smartphone className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">Native Android Kotlin • v{status?.version ?? "1.0.0"}</span>
            </div>
            <h2 className="text-xl font-bold text-white sm:text-2xl">
              JEE AEGIS Phone Connector APK
            </h2>
            <p className="max-w-2xl text-sm leading-relaxed text-slate-300">
              Secure, permission-scoped bridge between your Android phone and JEE AEGIS.
              Supports encrypted device credentials, FCM wakeup, recovery alarm, torch,
              GPS telemetry, and MediaProjection screen sharing.
            </p>
          </div>

          <div className="flex w-full flex-col items-stretch gap-2 md:w-auto md:shrink-0 md:items-end">
            {status?.available ? (
              <a
                href={status.downloadUrl}
                download={status.fileName}
                className="inline-flex min-h-[46px] w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-900/30 transition hover:from-violet-500 hover:to-indigo-500 md:w-auto"
              >
                <Download className="h-4 w-4 shrink-0" />
                Download {status.fileName} ({(status.sizeBytes / (1024 * 1024)).toFixed(1)} MB)
              </a>
            ) : (
              <div className="flex w-full flex-col items-stretch gap-2 md:w-auto md:items-end">
                <button
                  type="button"
                  disabled
                  className="inline-flex min-h-[46px] w-full cursor-not-allowed items-center justify-center gap-2 rounded-xl border border-amber-400/30 bg-amber-500/10 px-5 py-3 text-sm font-semibold text-amber-200 md:w-auto"
                >
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  APK Not Compiled Yet
                </button>
                <button
                  type="button"
                  onClick={checkStatus}
                  className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-violet-300 hover:text-violet-200 md:min-h-0 md:border-0 md:bg-transparent md:p-0"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
                  Re-check build status
                </button>
              </div>
            )}
            <span className="break-all text-xs text-slate-400 md:text-right">
              Expected file: <code className="text-violet-300">{status?.expectedPath ?? "public/downloads/jee-aegis.apk"}</code>
            </span>
          </div>
        </div>

        {!loading && status && !status.available && (
          <div className="mt-4 min-w-0 rounded-xl border border-amber-400/30 bg-amber-950/30 p-3.5 text-xs text-amber-100 sm:mt-5 sm:p-4">
            <div className="flex items-center gap-2 font-semibold text-amber-200">
              <Terminal className="h-4 w-4 shrink-0" />
              Why the download is unavailable on this server
            </div>
            <p className="mt-1 leading-relaxed text-amber-100/90">
              This host is missing Android build tools:{" "}
              <strong>{status.missingBuildTools.join(", ")}</strong>. Build the real APK on
              your Windows/macOS machine with Android Studio (JDK 17 + Android SDK 35) and
              copy it to <code className="break-all">public/downloads/jee-aegis.apk</code>:
            </p>
            <pre className="mt-2 max-w-full overflow-x-auto rounded-lg bg-slate-950/70 p-2.5 font-mono text-[11px] text-violet-200">
              {`cd android\n.\\gradlew assembleDebug\ncopy app\\build\\outputs\\apk\\debug\\app-debug.apk ..\\public\\downloads\\jee-aegis.apk`}
            </pre>
          </div>
        )}
      </div>

      <div className="grid gap-4 sm:gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-[#0f152d] p-4 sm:p-5">
          <h3 className="mb-3 flex items-center gap-2 text-base font-semibold text-white">
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            Onboarding Journey
          </h3>
          <ol className="space-y-2.5 text-sm text-slate-300">
            {USER_JOURNEY_STEPS.map((step, idx) => (
              <li key={idx} className="flex items-start gap-2.5">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet-500/20 text-xs font-semibold text-violet-300">
                  {idx + 1}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </div>

        <div className="rounded-2xl border border-white/10 bg-[#0f152d] p-4 sm:p-5">
          <h3 className="mb-3 flex items-center gap-2 text-base font-semibold text-white">
            <Lock className="h-4 w-4 text-violet-400" />
            Individual Permission Transparency
          </h3>
          <div className="space-y-3">
            {PERMISSIONS_GUIDE.map((perm) => (
              <div
                key={perm.name}
                className="rounded-xl border border-white/10 bg-white/5 p-3"
              >
                <div className="text-sm font-semibold text-white">{perm.name}</div>
                <p className="mt-0.5 text-xs text-slate-300">{perm.purpose}</p>
                <p className="mt-1 text-[11px] font-medium text-violet-300">{perm.required}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-[#0f152d] p-4 sm:p-5">
        <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-white">
          <Shield className="h-4 w-4 text-emerald-400" />
          Android Privacy &amp; Platform Boundaries
        </h3>
        <p className="text-xs text-slate-300">
          Remote commands require active Wi-Fi or cellular data. Powered-off devices cannot
          respond. MediaProjection screen sharing and Camera Assistance always display a
          persistent foreground notification and can be stopped by the owner at any time.
        </p>
      </div>
    </div>
  );
}

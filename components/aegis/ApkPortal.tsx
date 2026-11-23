"use client";

import {
  CheckCircle2,
  Clock,
  Download,
  Lock,
  RefreshCw,
  Shield,
  Smartphone,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

interface ApkStatus {
  available: boolean;
  version: string;
  fileName: string;
  downloadUrl: string;
  expectedPath: string;
  sizeBytes: number;
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
    void checkStatus();
  }, [checkStatus]);

  const isAvailable = Boolean(status?.available && status.sizeBytes > 0);

  return (
    <div className="min-w-0 space-y-4 text-slate-100 sm:space-y-6">
      <div className="rounded-2xl border border-violet-500/30 bg-gradient-to-br from-[#131936] via-[#10142c] to-[#1a1336] p-4 shadow-xl sm:p-6">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center md:gap-5">
          <div className="min-w-0 space-y-2">
            <div className="inline-flex max-w-full items-center gap-2 rounded-full border border-violet-400/30 bg-violet-500/15 px-3 py-1 text-xs font-semibold text-violet-200">
              <Smartphone className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">
                JEE AEGIS Android Connector
                {isAvailable && status?.version ? ` • v${status.version}` : ""}
              </span>
            </div>
            <h2 className="text-xl font-bold text-white sm:text-2xl">
              {isAvailable ? "JEE AEGIS Phone Connector APK" : "APK Build Pending"}
            </h2>
            <p className="max-w-2xl text-sm leading-relaxed text-slate-300">
              {isAvailable
                ? "Secure, permission-scoped bridge between your Android phone and JEE AEGIS. Download and install the package on your Android device (Android 8.0+)."
                : "The JEE AEGIS Android application is being prepared. Our automated build system will make the installation package available here shortly."}
            </p>
          </div>

          <div className="flex w-full flex-col items-stretch gap-2.5 md:w-auto md:shrink-0 md:items-end">
            {isAvailable && status ? (
              <>
                <a
                  href="/downloads/jee-aegis.apk"
                  download={status.fileName || "JEE-AEGIS.apk"}
                  className="inline-flex min-h-[46px] w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-900/30 transition hover:from-violet-500 hover:to-indigo-500 md:w-auto"
                >
                  <Download className="h-4 w-4 shrink-0" />
                  Download {status.fileName || "JEE-AEGIS.apk"}
                </a>
                <span className="text-xs text-slate-300 md:text-right">
                  Version {status.version} • {(status.sizeBytes / (1024 * 1024)).toFixed(1)} MB
                </span>
              </>
            ) : (
              <div className="flex w-full flex-col items-stretch gap-2.5 md:w-auto md:items-end">
                <div className="inline-flex min-h-[42px] items-center justify-center gap-2 rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-2.5 text-xs font-semibold text-amber-200">
                  <Clock className="h-4 w-4 shrink-0 text-amber-300" />
                  <span>APK Build Pending — Trigger GitHub Action or Check Back Soon</span>
                </div>
                <button
                  type="button"
                  onClick={() => void checkStatus()}
                  disabled={loading}
                  className="inline-flex min-h-[42px] items-center justify-center gap-2 rounded-xl border border-violet-400/30 bg-violet-500/15 px-4 py-2 text-xs font-semibold text-violet-100 transition hover:bg-violet-500/25 disabled:opacity-60"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
                  Check Again
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-[#0f152d] p-4 sm:p-5">
          <h3 className="mb-3 flex items-center gap-2 text-base font-semibold text-white">
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            Installation &amp; Onboarding Guide
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

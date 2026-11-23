"use client";

import { Clock, MapPin, Navigation } from "lucide-react";
import { TelemetrySnapshot } from "@/lib/aegis/types";

interface DeviceMapProps {
  telemetry: TelemetrySnapshot | null;
  onLocateNow: () => void;
  busy: boolean;
}

export function DeviceMap({ telemetry, onLocateNow, busy }: DeviceMapProps) {
  const hasCoords =
    telemetry?.latitude !== null &&
    telemetry?.latitude !== undefined &&
    telemetry?.longitude !== null &&
    telemetry?.longitude !== undefined;

  const freshness = telemetry?.location_freshness ?? "unavailable";

  const freshnessBadge =
    freshness === "fresh"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : freshness === "stale"
      ? "bg-amber-50 text-amber-700 border-amber-200"
      : "bg-slate-100 text-slate-600 border-slate-200";

  const lat = telemetry?.latitude ?? 0;
  const lon = telemetry?.longitude ?? 0;
  const delta = 0.012;
  const bbox = `${lon - delta},${lat - delta},${lon + delta},${lat + delta}`;
  const osmEmbedUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lon}`;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4 text-indigo-600" />
          <h3 className="text-sm font-semibold text-slate-900">Device Location</h3>
          <span
            className={`rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize ${freshnessBadge}`}
          >
            {freshness === "fresh"
              ? "Fresh (<5m)"
              : freshness === "stale"
              ? "Last-Known (Stale)"
              : "Unavailable"}
          </span>
        </div>

        <button
          type="button"
          onClick={onLocateNow}
          disabled={busy}
          className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
        >
          <Navigation className="h-3.5 w-3.5" />
          Locate Now
        </button>
      </div>

      {hasCoords ? (
        <>
          <div className="overflow-hidden rounded-lg border border-slate-200">
            <iframe
              title="Device Location Map"
              src={osmEmbedUrl}
              className="h-52 w-full border-0 sm:h-64"
              loading="lazy"
            />
          </div>
          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 break-words text-xs text-slate-600">
            <span>
              Coordinates:{" "}
              <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono">
                {lat.toFixed(5)}, {lon.toFixed(5)}
              </code>
              {telemetry?.location_accuracy_m != null &&
                ` (±${Math.round(telemetry.location_accuracy_m)}m)`}
            </span>
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" />
              {telemetry?.location_timestamp
                ? new Date(telemetry.location_timestamp + "Z").toLocaleString()
                : "Timestamp unavailable"}
            </span>
          </div>
        </>
      ) : (
        <div className="flex h-48 flex-col items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 text-center">
          <MapPin className="mb-2 h-6 w-6 text-slate-400" />
          <p className="text-sm font-medium text-slate-700">No location reported yet</p>
          <p className="mt-1 max-w-sm text-xs text-slate-500">
            Ensure Location permission is granted in the AEGIS Android Connector and click Locate Now.
          </p>
        </div>
      )}
    </div>
  );
}

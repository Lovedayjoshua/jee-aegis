"use client";

import {
  BatteryCharging,
  BatteryMedium,
  BellOff,
  BellRing,
  Camera,
  CheckCircle2,
  Flashlight,
  FlashlightOff,
  History,
  RefreshCw,
  ShieldAlert,
  Smartphone,
  Trash2,
  Wifi,
  WifiOff,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  fetchDeviceCommands,
  fetchDevices,
  issueDeviceCommand,
  revokeDevice,
} from "@/lib/aegis/api";
import { AegisCommand, AegisCommandType, AegisDevice } from "@/lib/aegis/types";
import { DeviceMap } from "./DeviceMap";

interface DevicesDashboardProps {
  token: string;
}

export function DevicesDashboard({ token }: DevicesDashboardProps) {
  const [devices, setDevices] = useState<AegisDevice[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [commands, setCommands] = useState<AegisCommand[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyCmd, setBusyCmd] = useState(false);
  const [banner, setBanner] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const loadDevices = useCallback(async () => {
    setLoading(true);
    try {
      const list = await fetchDevices(token);
      setDevices(list);
      if (list.length > 0 && (!selectedId || !list.some((d) => d.id === selectedId))) {
        setSelectedId(list[0].id);
      }
    } catch (err) {
      setBanner({
        kind: "err",
        text: err instanceof Error ? err.message : "Failed to load devices",
      });
    } finally {
      setLoading(false);
    }
  }, [token, selectedId]);

  const loadCommands = useCallback(async () => {
    if (!selectedId) return;
    try {
      const list = await fetchDeviceCommands(token, selectedId);
      setCommands(list);
    } catch {
      // ignore transient poll failure
    }
  }, [token, selectedId]);

  useEffect(() => {
    loadDevices();
  }, [loadDevices]);

  useEffect(() => {
    loadCommands();
  }, [loadCommands]);

  const selected = devices.find((d) => d.id === selectedId) ?? null;

  async function sendCommand(commandType: AegisCommandType) {
    if (!selected) return;
    setBusyCmd(true);
    setBanner(null);
    try {
      const res = await issueDeviceCommand(token, selected.id, commandType, 120);
      setBanner({
        kind: "ok",
        text: `Command ${res.command_type} queued (${res.status}). Expires at ${new Date(
          res.expires_at + "Z"
        ).toLocaleTimeString()}.`,
      });
      await Promise.all([loadCommands(), loadDevices()]);
    } catch (err) {
      setBanner({
        kind: "err",
        text: err instanceof Error ? err.message : "Command failed",
      });
    } finally {
      setBusyCmd(false);
    }
  }

  async function handleRevoke(deviceId: string) {
    if (!confirm("Revoke and disconnect this device? Its connector secret will be invalidated.")) {
      return;
    }
    setBusyCmd(true);
    try {
      await revokeDevice(token, deviceId);
      setBanner({ kind: "ok", text: "Device revoked and disconnected." });
      await loadDevices();
    } catch (err) {
      setBanner({
        kind: "err",
        text: err instanceof Error ? err.message : "Revocation failed",
      });
    } finally {
      setBusyCmd(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Connected Android Devices</h2>
          <p className="text-xs text-slate-500">
            Authenticated remote recovery, telemetry, and permission status
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            loadDevices();
            loadCommands();
          }}
          className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh Status
        </button>
      </div>

      {banner && (
        <div
          className={`rounded-xl border px-4 py-2.5 text-xs font-medium ${
            banner.kind === "ok"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-rose-200 bg-rose-50 text-rose-800"
          }`}
        >
          {banner.text}
        </div>
      )}

      {devices.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <Smartphone className="mx-auto mb-3 h-8 w-8 text-slate-400" />
          <h3 className="text-base font-semibold text-slate-900">No Android devices connected</h3>
          <p className="mx-auto mt-1 max-w-md text-xs text-slate-500">
            Install the JEE AEGIS Phone Connector APK on your Android phone, sign in with this
            account, and grant the permissions you want to enable.
          </p>
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-12">
          {/* Device Selector List */}
          <div className="space-y-2.5 lg:col-span-4">
            {devices.map((dev) => {
              const active = dev.id === selected?.id;
              return (
                <button
                  key={dev.id}
                  type="button"
                  onClick={() => setSelectedId(dev.id)}
                  className={`w-full rounded-xl border p-3.5 text-left transition ${
                    active
                      ? "border-indigo-500 bg-indigo-50/40 ring-1 ring-indigo-500"
                      : "border-slate-200 bg-white hover:border-slate-300"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-sm text-slate-900">
                      {dev.device_name}
                    </span>
                    {dev.is_revoked ? (
                      <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold text-rose-700">
                        Revoked
                      </span>
                    ) : dev.is_online ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                        <Wifi className="h-3 w-3" /> Online
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                        <WifiOff className="h-3 w-3" /> Offline
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {dev.manufacturer} {dev.model} {dev.android_version && `• Android ${dev.android_version}`}
                  </p>
                  <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
                    <span className="inline-flex items-center gap-1">
                      {dev.telemetry?.is_charging ? (
                        <BatteryCharging className="h-3.5 w-3.5 text-emerald-600" />
                      ) : (
                        <BatteryMedium className="h-3.5 w-3.5 text-slate-500" />
                      )}
                      {dev.telemetry?.battery_level != null
                        ? `${dev.telemetry.battery_level}%`
                        : "Battery N/A"}
                    </span>
                    <span>
                      {dev.last_seen_at
                        ? `Seen ${new Date(dev.last_seen_at + "Z").toLocaleTimeString()}`
                        : "Never seen"}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Selected Device Details & Controls */}
          {selected && (
            <div className="space-y-4 lg:col-span-8">
              {/* Recovery Controls */}
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">
                      Remote Device Recovery &amp; Assistance
                    </h3>
                    <p className="text-xs text-slate-500">
                      Commands expire after 120s if the phone remains offline.
                    </p>
                  </div>
                  {!selected.is_revoked && (
                    <button
                      type="button"
                      onClick={() => handleRevoke(selected.id)}
                      disabled={busyCmd}
                      className="inline-flex items-center gap-1 rounded-lg border border-rose-200 px-2.5 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Revoke Device
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
                  <button
                    type="button"
                    disabled={busyCmd || selected.is_revoked}
                    onClick={() => sendCommand("RING_START")}
                    className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg bg-rose-600 px-2.5 py-2.5 text-xs font-semibold text-white transition hover:bg-rose-700 disabled:opacity-50 sm:gap-2 sm:px-3"
                  >
                    <BellRing className="h-4 w-4 shrink-0" />
                    <span className="truncate">Ring Alarm</span>
                  </button>
                  <button
                    type="button"
                    disabled={busyCmd || selected.is_revoked}
                    onClick={() => sendCommand("RING_STOP")}
                    className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-50 sm:gap-2 sm:px-3"
                  >
                    <BellOff className="h-4 w-4 shrink-0" />
                    <span className="truncate">Stop Alarm</span>
                  </button>
                  <button
                    type="button"
                    disabled={busyCmd || selected.is_revoked}
                    onClick={() => sendCommand("TORCH_ON")}
                    className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg bg-amber-500 px-2.5 py-2.5 text-xs font-semibold text-white transition hover:bg-amber-600 disabled:opacity-50 sm:gap-2 sm:px-3"
                  >
                    <Flashlight className="h-4 w-4 shrink-0" />
                    <span className="truncate">Torch On</span>
                  </button>
                  <button
                    type="button"
                    disabled={busyCmd || selected.is_revoked}
                    onClick={() => sendCommand("TORCH_OFF")}
                    className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-50 sm:gap-2 sm:px-3"
                  >
                    <FlashlightOff className="h-4 w-4 shrink-0" />
                    <span className="truncate">Torch Off</span>
                  </button>
                  <button
                    type="button"
                    disabled={busyCmd || selected.is_revoked}
                    onClick={() => sendCommand("CAMERA_ASSIST_START")}
                    className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-2.5 py-2.5 text-xs font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50 sm:gap-2 sm:px-3"
                  >
                    <Camera className="h-4 w-4 shrink-0" />
                    <span className="truncate">Camera Assist</span>
                  </button>
                  <button
                    type="button"
                    disabled={busyCmd || selected.is_revoked}
                    onClick={() => sendCommand("CAMERA_ASSIST_STOP")}
                    className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-50 sm:gap-2 sm:px-3"
                  >
                    <ShieldAlert className="h-4 w-4 shrink-0" />
                    <span className="truncate">Stop Camera</span>
                  </button>
                </div>

                <p className="mt-2.5 text-[11px] text-slate-500">
                  Camera Assistance always displays a persistent foreground notification on the
                  phone and can be stopped immediately by the device owner.
                </p>
              </div>

              {/* Interactive Location Map */}
              <DeviceMap
                telemetry={selected.telemetry}
                onLocateNow={() => sendCommand("LOCATE_NOW")}
                busy={busyCmd || selected.is_revoked}
              />

              {/* Granular Permission Status */}
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <h3 className="mb-2.5 text-sm font-semibold text-slate-900">
                  Granted Android Permissions
                </h3>
                <div className="flex flex-wrap gap-2">
                  {[
                    ["location", "Location"],
                    ["background_location", "Background Location"],
                    ["camera", "Camera"],
                    ["microphone", "Microphone"],
                    ["notifications", "Notifications"],
                    ["torch_available", "Torch Hardware"],
                  ].map(([key, label]) => {
                    const granted = Boolean(selected.telemetry?.permissions?.[key]);
                    return (
                      <span
                        key={key}
                        className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium ${
                          granted
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                            : "border-slate-200 bg-slate-50 text-slate-500"
                        }`}
                      >
                        {granted ? (
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        ) : (
                          <XCircle className="h-3.5 w-3.5" />
                        )}
                        {label}
                      </span>
                    );
                  })}
                </div>
              </div>

              {/* Command History */}
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <h3 className="mb-2.5 flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <History className="h-4 w-4 text-indigo-600" />
                  Recent Command History
                </h3>
                {commands.length === 0 ? (
                  <p className="text-xs text-slate-500">No commands issued yet.</p>
                ) : (
                  <div className="max-h-56 divide-y divide-slate-100 overflow-y-auto text-xs">
                    {commands.map((cmd) => (
                      <div
                        key={cmd.id}
                        className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-2"
                      >
                        <div className="min-w-0 break-words">
                          <span className="font-semibold text-slate-900">{cmd.command_type}</span>
                          {cmd.error_message && (
                            <span className="ml-2 text-rose-600">({cmd.error_message})</span>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                              cmd.status === "acked"
                                ? "bg-emerald-100 text-emerald-700"
                                : cmd.status === "failed" || cmd.status === "expired"
                                ? "bg-rose-100 text-rose-700"
                                : "bg-amber-100 text-amber-700"
                            }`}
                          >
                            {cmd.status}
                          </span>
                          <span className="text-slate-400">
                            {new Date(cmd.created_at + "Z").toLocaleTimeString()}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

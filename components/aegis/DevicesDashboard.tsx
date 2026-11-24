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
  saveUserPreferences,
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
  const [activeCmdType, setActiveCmdType] = useState<AegisCommandType | null>(null);
  const [banner, setBanner] = useState<{ kind: "ok" | "err" | "warn"; text: string } | null>(null);

  const loadDevices = useCallback(async () => {
    setLoading(true);
    try {
      const list = await fetchDevices(token);
      setDevices(list);
      if (list.length > 0 && (!selectedId || !list.some((d) => d.id === selectedId))) {
        const storedId =
          typeof window !== "undefined"
            ? window.localStorage.getItem("jee_aegis_selected_device_v1")
            : null;
        const match = storedId && list.some((d) => d.id === storedId) ? storedId : list[0].id;
        setSelectedId(match);
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

  // Auto-poll command status & telemetry every 2.5s while any command is in-flight,
  // and refresh telemetry every 10s while viewing the Connected Devices dashboard.
  const hasInFlightCommand = commands.some((c) =>
    ["pending", "sent", "dispatched", "retrieved", "delivered", "executing"].includes(c.status)
  );

  useEffect(() => {
    const pollMs = hasInFlightCommand ? 2500 : 10000;
    const interval = window.setInterval(() => {
      void loadDevices();
      if (selectedId) {
        void loadCommands();
      }
    }, pollMs);
    return () => window.clearInterval(interval);
  }, [selectedId, hasInFlightCommand, loadCommands, loadDevices]);

  const selected = devices.find((d) => d.id === selectedId) ?? null;

  async function sendCommand(commandType: AegisCommandType) {
    if (!selected || busyCmd) return;
    setBusyCmd(true);
    setActiveCmdType(commandType);
    setBanner(null);
    try {
      const res = await issueDeviceCommand(token, selected.id, commandType);
      const isOnline = selected.is_online;
      setBanner({
        kind: isOnline ? "ok" : "warn",
        text: isOnline
          ? `Command ${res.command_type} (${res.status.toUpperCase()}) sent to ${selected.device_name}. Waiting for device execution...`
          : `${selected.device_name} is currently offline — ${res.command_type} queued until ${new Date(
              res.expires_at + "Z"
            ).toLocaleTimeString()} and will execute when the phone reconnects.`,
      });
      await Promise.all([loadCommands(), loadDevices()]);
    } catch (err) {
      setBanner({
        kind: "err",
        text: err instanceof Error ? err.message : "Command failed",
      });
    } finally {
      setBusyCmd(false);
      setActiveCmdType(null);
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
    <div className="space-y-5 text-slate-100">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-white">Connected Android Devices</h2>
          <p className="text-xs text-slate-400">
            Authenticated remote recovery, telemetry, and permission status
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            loadDevices();
            loadCommands();
          }}
          className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-white/10"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh Status
        </button>
      </div>

      {banner && (
        <div
          className={`rounded-xl border px-4 py-2.5 text-xs font-medium ${
            banner.kind === "ok"
              ? "border-emerald-400/30 bg-emerald-500/15 text-emerald-200"
              : banner.kind === "warn"
              ? "border-amber-400/30 bg-amber-500/15 text-amber-200"
              : "border-rose-400/30 bg-rose-500/15 text-rose-200"
          }`}
        >
          {banner.text}
        </div>
      )}

      {devices.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/15 bg-[#0f152d] p-10 text-center">
          <Smartphone className="mx-auto mb-3 h-8 w-8 text-violet-400" />
          <h3 className="text-base font-semibold text-white">No Android devices connected</h3>
          <p className="mx-auto mt-1 max-w-md text-xs text-slate-400">
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
                  onClick={() => {
                    setSelectedId(dev.id);
                    try {
                      window.localStorage.setItem("jee_aegis_selected_device_v1", dev.id);
                    } catch {
                      // ignore
                    }
                    void saveUserPreferences(token, { selected_device_id: dev.id }).catch(() => {});
                  }}
                  className={`w-full rounded-xl border p-3.5 text-left transition ${
                    active
                      ? "border-violet-500 bg-violet-500/15 ring-1 ring-violet-500"
                      : "border-white/10 bg-[#0f152d] hover:border-white/20"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-white">
                      {dev.device_name}
                    </span>
                    {dev.is_revoked ? (
                      <span className="rounded-full bg-rose-500/20 px-2 py-0.5 text-[10px] font-semibold text-rose-300">
                        Revoked
                      </span>
                    ) : dev.is_online ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                        <Wifi className="h-3 w-3" /> Online
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-slate-300">
                        <WifiOff className="h-3 w-3" /> Offline
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-slate-400">
                    {dev.manufacturer} {dev.model}{" "}
                    {dev.android_version && `• Android ${dev.android_version}`}
                  </p>
                  <p className="mt-0.5 font-mono text-[10px] text-violet-300/80">
                    Device ID: {dev.id.slice(0, 8)}…
                  </p>
                  <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400">
                    <span className="inline-flex items-center gap-1">
                      {dev.telemetry?.is_charging ? (
                        <BatteryCharging className="h-3.5 w-3.5 text-emerald-400" />
                      ) : (
                        <BatteryMedium className="h-3.5 w-3.5 text-slate-400" />
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
              <div className="rounded-xl border border-white/10 bg-[#0f152d] p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold text-white">
                      Remote Device Recovery &amp; Assistance
                    </h3>
                    <p className="text-xs text-slate-400">
                      {activeCmdType
                        ? `Sending ${activeCmdType}...`
                        : "TTLs: Ring & Torch 300s • Locate 24h • 4s pull-queue sync active"}
                    </p>
                    <p className="mt-0.5 font-mono text-[11px] text-violet-300">
                      Target Device ID: {selected.id}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {!selected.is_revoked && (
                      <button
                        type="button"
                        onClick={() => sendCommand("SYNC_STATUS")}
                        disabled={busyCmd}
                        className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-violet-400/30 bg-violet-500/15 px-2.5 py-1 text-xs font-medium text-violet-100 hover:bg-violet-500/25 disabled:opacity-50"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        Sync Device
                      </button>
                    )}
                    {!selected.is_revoked && (
                      <button
                        type="button"
                        onClick={() => handleRevoke(selected.id)}
                        disabled={busyCmd}
                        className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-xs font-medium text-rose-200 hover:bg-rose-500/20 disabled:opacity-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Revoke Device
                      </button>
                    )}
                  </div>
                </div>

                {/* Live Hardware State Indicators */}
                {selected.telemetry && (
                  <div className="mb-3 flex flex-wrap items-center gap-2 text-[11px]">
                    <span
                      className={`rounded-full border px-2.5 py-0.5 font-medium ${
                        selected.telemetry.torch_on
                          ? "border-amber-400/40 bg-amber-500/20 text-amber-200"
                          : "border-white/10 bg-white/5 text-slate-400"
                      }`}
                    >
                      Torch: {selected.telemetry.torch_on ? "ON" : "OFF"}
                    </span>
                    <span
                      className={`rounded-full border px-2.5 py-0.5 font-medium ${
                        selected.telemetry.alarm_active
                          ? "border-rose-400/40 bg-rose-500/20 text-rose-200"
                          : "border-white/10 bg-white/5 text-slate-400"
                      }`}
                    >
                      Alarm: {selected.telemetry.alarm_active ? "RINGING" : "SILENT"}
                    </span>
                    <span
                      className={`rounded-full border px-2.5 py-0.5 font-medium ${
                        selected.telemetry.camera_assist_active
                          ? "border-indigo-400/40 bg-indigo-500/20 text-indigo-200"
                          : "border-white/10 bg-white/5 text-slate-400"
                      }`}
                    >
                      Camera Assist: {selected.telemetry.camera_assist_active ? "ACTIVE" : "OFF"}
                    </span>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
                  <button
                    type="button"
                    disabled={busyCmd || selected.is_revoked}
                    onClick={() => sendCommand("RING_START")}
                    className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg bg-rose-600 px-2.5 py-2.5 text-xs font-semibold text-white transition hover:bg-rose-500 disabled:opacity-50 sm:gap-2 sm:px-3"
                  >
                    <BellRing className="h-4 w-4 shrink-0" />
                    <span className="truncate">Ring Alarm</span>
                  </button>
                  <button
                    type="button"
                    disabled={busyCmd || selected.is_revoked}
                    onClick={() => sendCommand("RING_STOP")}
                    className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-2.5 py-2.5 text-xs font-semibold text-slate-200 transition hover:bg-white/10 disabled:opacity-50 sm:gap-2 sm:px-3"
                  >
                    <BellOff className="h-4 w-4 shrink-0" />
                    <span className="truncate">Stop Alarm</span>
                  </button>
                  <button
                    type="button"
                    disabled={busyCmd || selected.is_revoked}
                    onClick={() => sendCommand("TORCH_ON")}
                    className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg bg-amber-500 px-2.5 py-2.5 text-xs font-semibold text-slate-950 transition hover:bg-amber-400 disabled:opacity-50 sm:gap-2 sm:px-3"
                  >
                    <Flashlight className="h-4 w-4 shrink-0" />
                    <span className="truncate">Torch On</span>
                  </button>
                  <button
                    type="button"
                    disabled={busyCmd || selected.is_revoked}
                    onClick={() => sendCommand("TORCH_OFF")}
                    className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-2.5 py-2.5 text-xs font-semibold text-slate-200 transition hover:bg-white/10 disabled:opacity-50 sm:gap-2 sm:px-3"
                  >
                    <FlashlightOff className="h-4 w-4 shrink-0" />
                    <span className="truncate">Torch Off</span>
                  </button>
                  <button
                    type="button"
                    disabled={busyCmd || selected.is_revoked}
                    onClick={() => sendCommand("CAMERA_ASSIST_START")}
                    className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-violet-600 to-indigo-600 px-2.5 py-2.5 text-xs font-semibold text-white transition hover:from-violet-500 hover:to-indigo-500 disabled:opacity-50 sm:gap-2 sm:px-3"
                  >
                    <Camera className="h-4 w-4 shrink-0" />
                    <span className="truncate">Camera Assist</span>
                  </button>
                  <button
                    type="button"
                    disabled={busyCmd || selected.is_revoked}
                    onClick={() => sendCommand("CAMERA_ASSIST_STOP")}
                    className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-2.5 py-2.5 text-xs font-semibold text-slate-200 transition hover:bg-white/10 disabled:opacity-50 sm:gap-2 sm:px-3"
                  >
                    <ShieldAlert className="h-4 w-4 shrink-0" />
                    <span className="truncate">Stop Camera</span>
                  </button>
                </div>

                <p className="mt-2.5 text-[11px] text-slate-400">
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
              <div className="rounded-xl border border-white/10 bg-[#0f152d] p-4">
                <h3 className="mb-2.5 text-sm font-semibold text-white">
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
                            ? "border-emerald-400/30 bg-emerald-500/15 text-emerald-200"
                            : "border-white/10 bg-white/5 text-slate-400"
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
              <div className="rounded-xl border border-white/10 bg-[#0f152d] p-4">
                <h3 className="mb-2.5 flex items-center gap-2 text-sm font-semibold text-white">
                  <History className="h-4 w-4 text-violet-400" />
                  Recent Command History
                </h3>
                {commands.length === 0 ? (
                  <p className="text-xs text-slate-400">No commands issued yet.</p>
                ) : (
                  <div className="max-h-56 divide-y divide-white/10 overflow-y-auto text-xs">
                    {commands.map((cmd) => (
                      <div
                        key={cmd.id}
                        className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-2"
                      >
                        <div className="min-w-0 break-words">
                          <span className="font-semibold text-white">{cmd.command_type}</span>
                          {cmd.error_message && (
                            <span className="ml-2 text-rose-300">({cmd.error_message})</span>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                              cmd.status === "acked" ||
                              cmd.status === "executed" ||
                              cmd.status === "completed"
                                ? "bg-emerald-500/20 text-emerald-200"
                                : cmd.status === "failed" || cmd.status === "expired"
                                ? "bg-rose-500/20 text-rose-200"
                                : cmd.status === "delivered" ||
                                  cmd.status === "retrieved" ||
                                  cmd.status === "executing"
                                ? "bg-indigo-500/20 text-indigo-200"
                                : "bg-amber-500/20 text-amber-200"
                            }`}
                          >
                            {cmd.status === "acked" || cmd.status === "executed"
                              ? "Completed"
                              : cmd.status === "dispatched"
                              ? "Sent"
                              : cmd.status}
                          </span>
                          <span className="text-slate-400">
                            {cmd.acked_at
                              ? `Acked ${new Date(cmd.acked_at + "Z").toLocaleTimeString()}`
                              : `Sent ${new Date(cmd.created_at + "Z").toLocaleTimeString()}`}
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

"use client";

import { History, LogOut, RefreshCw, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { fetchAuditLogs } from "@/lib/aegis/api";
import { AegisUser, AuditLogItem } from "@/lib/aegis/types";

interface SecuritySettingsProps {
  token: string;
  user: AegisUser;
  onSignOut: () => void;
}

export function SecuritySettings({ token, user, onSignOut }: SecuritySettingsProps) {
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [loading, setLoading] = useState(false);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const items = await fetchAuditLogs(token);
      setLogs(items);
    } catch {
      // ignore transient errors
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:p-5">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 sm:h-11 sm:w-11">
            <ShieldCheck className="h-5 w-5 sm:h-6 sm:w-6" />
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-slate-900">{user.full_name}</h2>
            <p className="break-all text-xs text-slate-500">
              {user.email} • Member since {new Date(user.created_at + "Z").toLocaleDateString()}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onSignOut}
          className="inline-flex min-h-[42px] w-full items-center justify-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 sm:min-h-[38px] sm:w-auto"
        >
          <LogOut className="h-3.5 w-3.5" />
          Sign Out
        </button>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        <div className="mb-4 flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <History className="h-4 w-4 shrink-0 text-indigo-600" />
            Security &amp; Command Audit Trail
          </h3>
          <button
            type="button"
            onClick={loadLogs}
            className="inline-flex min-h-[38px] shrink-0 items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>

        {logs.length === 0 ? (
          <p className="py-6 text-center text-xs text-slate-500">No audit events recorded yet.</p>
        ) : (
          <div className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
            {logs.map((item) => (
              <div
                key={item.id}
                className="flex flex-col gap-1 py-2.5 text-xs sm:flex-row sm:items-center sm:justify-between sm:gap-4"
              >
                <div className="min-w-0 break-words">
                  <span className="break-all font-semibold text-slate-900">{item.action}</span>
                  <span className="ml-2 inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase text-slate-600">
                    {item.actor_type}
                  </span>
                </div>
                <span className="shrink-0 text-slate-500">
                  {new Date(item.created_at + "Z").toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

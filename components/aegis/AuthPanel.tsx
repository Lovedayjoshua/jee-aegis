"use client";

import { Lock, Mail, ShieldCheck, User, Loader2 } from "lucide-react";
import { FormEvent, useState } from "react";
import { loginUser, registerUser, setStoredToken } from "@/lib/aegis/api";
import { AegisUser } from "@/lib/aegis/types";

interface AuthPanelProps {
  onAuthenticated: (token: string, user: AegisUser) => void;
}

export function AuthPanel({ onAuthenticated }: AuthPanelProps) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res =
        mode === "register"
          ? await registerUser(email, fullName, password)
          : await loginUser(email, password);
      setStoredToken(res.access_token);
      onAuthenticated(res.access_token, res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-md rounded-2xl border border-violet-500/25 bg-[#0f152d] p-4 text-slate-100 shadow-xl sm:p-6">
      <div className="mb-4 flex items-center gap-3 sm:mb-5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 text-white shadow-md shadow-violet-900/40 sm:h-11 sm:w-11">
          <ShieldCheck className="h-5 w-5 sm:h-6 sm:w-6" />
        </div>
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-white sm:text-lg">
            {mode === "login" ? "Sign in to JEE AEGIS" : "Create JEE AEGIS Account"}
          </h2>
          <p className="text-xs text-slate-400">
            Manage connected Android devices &amp; security audit logs
          </p>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 rounded-xl border border-white/10 bg-[#080c1d] p-1 text-sm font-medium">
        <button
          type="button"
          onClick={() => {
            setMode("login");
            setError(null);
          }}
          className={`min-h-[40px] rounded-lg py-1.5 transition ${
            mode === "login"
              ? "bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-xs"
              : "text-slate-300 hover:text-white"
          }`}
        >
          Sign In
        </button>
        <button
          type="button"
          onClick={() => {
            setMode("register");
            setError(null);
          }}
          className={`min-h-[40px] rounded-lg py-1.5 transition ${
            mode === "register"
              ? "bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-xs"
              : "text-slate-300 hover:text-white"
          }`}
        >
          Create Account
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-rose-500/30 bg-rose-950/50 px-3 py-2 text-xs text-rose-200">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-3.5">
        {mode === "register" && (
          <div>
            <label
              htmlFor="aegis-full-name"
              className="mb-1 block text-xs font-medium text-slate-300"
            >
              Full Name
            </label>
            <div className="relative">
              <User className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
              <input
                id="aegis-full-name"
                type="text"
                autoComplete="name"
                required
                minLength={2}
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Adebayo Chinedu"
                className="min-h-[44px] w-full rounded-xl border border-white/10 bg-[#141b38] py-2.5 pl-9 pr-3 text-base text-white placeholder-slate-500 focus:border-violet-500 focus:outline-none sm:text-sm"
              />
            </div>
          </div>
        )}

        <div>
          <label
            htmlFor="aegis-email"
            className="mb-1 block text-xs font-medium text-slate-300"
          >
            Email Address
          </label>
          <div className="relative">
            <Mail className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
            <input
              id="aegis-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              autoCorrect="off"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="min-h-[44px] w-full rounded-xl border border-white/10 bg-[#141b38] py-2.5 pl-9 pr-3 text-base text-white placeholder-slate-500 focus:border-violet-500 focus:outline-none sm:text-sm"
            />
          </div>
        </div>

        <div>
          <label
            htmlFor="aegis-password"
            className="mb-1 block text-xs font-medium text-slate-300"
          >
            Password
          </label>
          <div className="relative">
            <Lock className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
            <input
              id="aegis-password"
              type="password"
              autoComplete={mode === "register" ? "new-password" : "current-password"}
              required
              minLength={mode === "register" ? 8 : 1}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === "register" ? "Minimum 8 characters" : "••••••••"}
              className="min-h-[44px] w-full rounded-xl border border-white/10 bg-[#141b38] py-2.5 pl-9 pr-3 text-base text-white placeholder-slate-500 focus:border-violet-500 focus:outline-none sm:text-sm"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="flex min-h-[46px] w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 py-2.5 text-sm font-semibold text-white shadow-lg shadow-violet-900/30 transition hover:from-violet-500 hover:to-indigo-500 disabled:opacity-60"
        >
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          {mode === "login" ? "Sign In" : "Create Account"}
        </button>
      </form>
    </div>
  );
}

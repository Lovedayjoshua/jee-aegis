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
    <div className="mx-auto w-full max-w-md rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
      <div className="mb-4 flex items-center gap-3 sm:mb-5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white sm:h-11 sm:w-11">
          <ShieldCheck className="h-5 w-5 sm:h-6 sm:w-6" />
        </div>
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-slate-900 sm:text-lg">
            {mode === "login" ? "Sign in to JEE AEGIS" : "Create JEE AEGIS Account"}
          </h2>
          <p className="text-xs text-slate-500">
            Manage connected Android devices &amp; security audit logs
          </p>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 rounded-xl bg-slate-100 p-1 text-sm font-medium">
        <button
          type="button"
          onClick={() => {
            setMode("login");
            setError(null);
          }}
          className={`min-h-[40px] rounded-lg py-1.5 transition ${
            mode === "login" ? "bg-white text-slate-900 shadow-xs" : "text-slate-600"
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
            mode === "register" ? "bg-white text-slate-900 shadow-xs" : "text-slate-600"
          }`}
        >
          Create Account
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-3.5">
        {mode === "register" && (
          <div>
            <label
              htmlFor="aegis-full-name"
              className="mb-1 block text-xs font-medium text-slate-700"
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
                className="min-h-[44px] w-full rounded-xl border border-slate-300 py-2.5 pl-9 pr-3 text-base text-slate-900 focus:border-indigo-500 focus:outline-none sm:text-sm"
              />
            </div>
          </div>
        )}

        <div>
          <label
            htmlFor="aegis-email"
            className="mb-1 block text-xs font-medium text-slate-700"
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
              className="min-h-[44px] w-full rounded-xl border border-slate-300 py-2.5 pl-9 pr-3 text-base text-slate-900 focus:border-indigo-500 focus:outline-none sm:text-sm"
            />
          </div>
        </div>

        <div>
          <label
            htmlFor="aegis-password"
            className="mb-1 block text-xs font-medium text-slate-700"
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
              className="min-h-[44px] w-full rounded-xl border border-slate-300 py-2.5 pl-9 pr-3 text-base text-slate-900 focus:border-indigo-500 focus:outline-none sm:text-sm"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="flex min-h-[46px] w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-60"
        >
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          {mode === "login" ? "Sign In" : "Create Account"}
        </button>
      </form>
    </div>
  );
}

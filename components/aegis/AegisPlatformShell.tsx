"use client";

import {
  ArrowRight,
  Download,
  GraduationCap,
  Lock,
  Menu,
  Monitor,
  Plus,
  ShieldCheck,
  Smartphone,
  Sparkles,
  X,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import {
  AegisAuthError,
  fetchCurrentUser,
  getStoredToken,
  getStoredUser,
  saveUserPreferences,
  setStoredToken,
  setStoredUser,
} from "@/lib/aegis/api";
import { AegisUser } from "@/lib/aegis/types";

const WorkspaceLoader = () => (
  <div className="flex min-h-[260px] items-center justify-center rounded-2xl border border-white/10 bg-[#0f152d]/60 p-6 text-xs text-slate-300">
    Loading workspace...
  </div>
);

const ApkPortal = dynamic(() => import("./ApkPortal").then((m) => m.ApkPortal), {
  loading: WorkspaceLoader,
});
const AuthPanel = dynamic(() => import("./AuthPanel").then((m) => m.AuthPanel), {
  loading: WorkspaceLoader,
});
const DevicesDashboard = dynamic(
  () => import("./DevicesDashboard").then((m) => m.DevicesDashboard),
  { loading: WorkspaceLoader }
);
const LiveCompanionWorkspace = dynamic(
  () => import("./LiveCompanionWorkspace").then((m) => m.LiveCompanionWorkspace),
  { loading: WorkspaceLoader }
);
const SecuritySettings = dynamic(
  () => import("./SecuritySettings").then((m) => m.SecuritySettings),
  { loading: WorkspaceLoader }
);
const StudySpaceWorkspace = dynamic(
  () => import("./StudySpaceWorkspace").then((m) => m.StudySpaceWorkspace),
  { loading: WorkspaceLoader }
);

type PlatformTab =
  | "welcome"
  | "study"
  | "companion"
  | "devices"
  | "apk"
  | "security";

const ACTIVE_TAB_KEY = "jee_aegis_active_tab_v1";
const VALID_TABS: PlatformTab[] = ["welcome", "study", "companion", "devices", "apk", "security"];

function hydrateLocalWorkspaceFromPreferences(prefs?: Record<string, unknown>) {
  if (typeof window === "undefined" || !prefs) return;
  try {
    if (typeof prefs.selected_device_id === "string" && prefs.selected_device_id) {
      window.localStorage.setItem("jee_aegis_selected_device_v1", prefs.selected_device_id);
    }
    if (prefs.companion_state && typeof prefs.companion_state === "object") {
      window.localStorage.setItem(
        "jee_aegis_companion_state_v1",
        JSON.stringify(prefs.companion_state)
      );
    }
    if (prefs.study_active_state && typeof prefs.study_active_state === "object") {
      window.localStorage.setItem(
        "jee_aegis_study_active_v1",
        JSON.stringify(prefs.study_active_state)
      );
    }
    if (Array.isArray(prefs.study_sessions) && prefs.study_sessions.length > 0) {
      window.localStorage.setItem(
        "socraticlab_study_sessions_v1",
        JSON.stringify(prefs.study_sessions)
      );
    }
    window.dispatchEvent(new CustomEvent("aegis:preferences-restored", { detail: prefs }));
  } catch {
    // ignore storage errors
  }
}

export function AegisPlatformShell() {
  const [activeTab, setActiveTab] = useState<PlatformTab>("welcome");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sessionSeed, setSessionSeed] = useState(0);
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AegisUser | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);

  useEffect(() => {
    try {
      const savedTab = window.localStorage.getItem(ACTIVE_TAB_KEY) as PlatformTab | null;
      if (savedTab && VALID_TABS.includes(savedTab)) {
        setActiveTab(savedTab);
      }
    } catch {
      // ignore storage errors
    }

    const saved = getStoredToken();
    const cachedUser = getStoredUser();
    if (!saved) {
      setCheckingAuth(false);
      return;
    }

    if (cachedUser) {
      setToken(saved);
      setUser(cachedUser);
      setCheckingAuth(false);
    }

    fetchCurrentUser(saved)
      .then((u) => {
        setToken(saved);
        setUser(u);
        setStoredUser(u);
        hydrateLocalWorkspaceFromPreferences(u.preferences);
      })
      .catch((err) => {
        // Only clear stored session on an explicit 401 Unauthorized — never on a network blip or cold-start timeout
        if (err instanceof AegisAuthError && err.status === 401) {
          setStoredToken(null);
          setToken(null);
          setUser(null);
        }
      })
      .finally(() => setCheckingAuth(false));
  }, []);

  useEffect(() => {
    function onSessionExpired() {
      setToken(null);
      setUser(null);
    }
    window.addEventListener("aegis:session-expired", onSessionExpired);
    return () => window.removeEventListener("aegis:session-expired", onSessionExpired);
  }, []);

  function handleAuthenticated(newToken: string, newUser: AegisUser) {
    setStoredToken(newToken);
    setStoredUser(newUser);
    setToken(newToken);
    setUser(newUser);
    hydrateLocalWorkspaceFromPreferences(newUser.preferences);
  }

  function handleSignOut() {
    setStoredToken(null);
    setStoredUser(null);
    setToken(null);
    setUser(null);
  }

  const navItems: { id: PlatformTab; label: string; icon: typeof Sparkles }[] = [
    { id: "study", label: "Study Space", icon: GraduationCap },
    { id: "companion", label: "Live Companion", icon: Sparkles },
    { id: "devices", label: "Connected Devices", icon: Smartphone },
    { id: "apk", label: "APK & Setup", icon: Download },
    { id: "security", label: "Account & Security", icon: Lock },
  ];

  function navigateTo(tab: PlatformTab) {
    setActiveTab(tab);
    setMobileMenuOpen(false);
    try {
      window.localStorage.setItem(ACTIVE_TAB_KEY, tab);
    } catch {
      // ignore
    }
    if (token) {
      void saveUserPreferences(token, { active_tab: tab }).catch(() => {});
    }
  }

  return (
    <div className="flex min-h-dvh w-full max-w-full overflow-x-clip bg-[#070a18] text-slate-100">
      {/* Left Sidebar (Desktop) */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-white/10 bg-[#0b0f24] p-4 lg:flex">
        <button
          type="button"
          onClick={() => navigateTo("welcome")}
          className="mb-5 flex items-center gap-2.5 text-left"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 text-white shadow-lg shadow-violet-900/40">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <div className="text-sm font-bold tracking-tight text-white">JEE AEGIS</div>
            <div className="text-[11px] text-violet-300/80">AI &amp; Device Platform</div>
          </div>
        </button>

        <button
          type="button"
          onClick={() => {
            setSessionSeed((s) => s + 1);
            if (activeTab === "welcome") setActiveTab("companion");
          }}
          className="mb-4 flex min-h-[42px] items-center justify-center gap-2 rounded-xl border border-violet-400/30 bg-violet-600/20 px-3 py-2 text-xs font-semibold text-violet-100 transition hover:bg-violet-600/30"
        >
          <Plus className="h-4 w-4" />
          New Conversation
        </button>

        <nav className="flex-1 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => navigateTo(item.id)}
                className={`flex min-h-[42px] w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-xs font-semibold transition ${
                  active
                    ? "bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-md shadow-violet-950/50"
                    : "text-slate-300 hover:bg-white/5 hover:text-white"
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-3 text-[11px] text-slate-400">
          {user ? (
            <div>
              <div className="truncate font-semibold text-white">{user.full_name}</div>
              <div className="truncate text-slate-400">{user.email}</div>
            </div>
          ) : (
            <div>Not signed in • Sign in via Connected Devices or Account</div>
          )}
        </div>
      </aside>

      {/* Main Column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top Bar with Prominent Mode Switcher — compact single row even at 320px */}
        <header className="sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-white/10 bg-[#0b0f24]/95 px-2.5 py-2 backdrop-blur sm:gap-3 sm:px-4 sm:py-3">
          <div className="flex min-w-0 flex-1 items-center gap-2 sm:flex-initial sm:gap-2.5">
            <button
              type="button"
              onClick={() => setMobileMenuOpen((v) => !v)}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-slate-200 active:bg-white/15 lg:hidden"
              aria-label="Toggle Menu"
              aria-expanded={mobileMenuOpen}
            >
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>

            <button
              type="button"
              onClick={() => navigateTo("welcome")}
              className="hidden shrink-0 items-center gap-1.5 text-sm font-bold text-white sm:inline-flex lg:hidden"
            >
              <ShieldCheck className="h-4 w-4 text-violet-400" />
              JEE AEGIS
            </button>

            {/* Prominent Experience Switcher */}
            <div className="grid min-w-0 flex-1 grid-cols-2 rounded-xl border border-white/10 bg-[#070a18] p-1 sm:inline-flex sm:flex-initial">
              <button
                type="button"
                onClick={() => navigateTo("study")}
                className={`inline-flex min-h-[38px] items-center justify-center gap-1.5 truncate rounded-lg px-2 py-1.5 text-xs font-semibold transition sm:min-h-[36px] sm:px-3 ${
                  activeTab === "study"
                    ? "bg-indigo-600 text-white shadow-sm"
                    : "text-slate-300 hover:text-white"
                }`}
              >
                <GraduationCap className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">Study Space</span>
              </button>
              <button
                type="button"
                onClick={() => navigateTo("companion")}
                className={`inline-flex min-h-[38px] items-center justify-center gap-1.5 truncate rounded-lg px-2 py-1.5 text-xs font-semibold transition sm:min-h-[36px] sm:px-3 ${
                  activeTab === "companion"
                    ? "bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-sm"
                    : "text-slate-300 hover:text-white"
                }`}
              >
                <Sparkles className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">Live Companion</span>
              </button>
            </div>
          </div>

          <div className="hidden items-center gap-2 sm:flex">
            <button
              type="button"
              onClick={() => navigateTo("devices")}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-white/10"
            >
              <Smartphone className="h-3.5 w-3.5 text-violet-300" />
              Devices
            </button>
            <button
              type="button"
              onClick={() => navigateTo("apk")}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-white/10"
            >
              <Download className="h-3.5 w-3.5 text-violet-300" />
              APK
            </button>
          </div>
        </header>

        {/* Mobile Navigation Drawer */}
        {mobileMenuOpen && (
          <div className="border-b border-white/10 bg-[#0b0f24] px-3 py-3 shadow-2xl lg:hidden">
            <div className="mb-3 flex items-center justify-between gap-2 border-b border-white/10 pb-2.5">
              <button
                type="button"
                onClick={() => navigateTo("welcome")}
                className="flex items-center gap-2 text-left"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-600 to-indigo-600 text-white">
                  <ShieldCheck className="h-4 w-4" />
                </div>
                <div>
                  <div className="text-xs font-bold text-white">JEE AEGIS</div>
                  <div className="text-[11px] text-slate-400">
                    {user ? user.email : "Home Overview"}
                  </div>
                </div>
              </button>
              <button
                type="button"
                onClick={() => {
                  setSessionSeed((s) => s + 1);
                  navigateTo(activeTab === "welcome" ? "companion" : activeTab);
                }}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-violet-400/30 bg-violet-600/20 px-3 py-1.5 text-xs font-semibold text-violet-100"
              >
                <Plus className="h-3.5 w-3.5" />
                New Chat
              </button>
            </div>

            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {navItems.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => navigateTo(item.id)}
                    className={`flex min-h-[44px] items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition ${
                      activeTab === item.id
                        ? "bg-gradient-to-r from-violet-600 to-indigo-600 text-white"
                        : "border border-white/10 bg-white/5 text-slate-200 active:bg-white/10"
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Workspace Content */}
        <main className="flex-1 p-2.5 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:p-4 md:p-6">
          {activeTab === "welcome" && (
            <div className="mx-auto max-w-5xl space-y-4 py-1 sm:space-y-6 sm:py-3">
              <div className="rounded-2xl border border-violet-500/30 bg-gradient-to-br from-[#131a3a] via-[#0e132c] to-[#1b1136] p-4 shadow-2xl sm:rounded-3xl sm:p-6 md:p-7">
                <div className="inline-flex items-center gap-2 rounded-full border border-violet-400/30 bg-violet-500/15 px-3 py-1 text-xs font-semibold text-violet-200">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  JEE AEGIS Platform
                </div>
                <h1 className="mt-2.5 text-xl font-bold tracking-tight text-white sm:mt-3 sm:text-2xl md:text-3xl">
                  Two Dedicated AI Experiences. One Connected Platform.
                </h1>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-300">
                  Choose <strong className="text-white">Study Space</strong> for structured
                  JAMB/WAEC &amp; STEM learning, or launch{" "}
                  <strong className="text-white">Live Companion</strong> to share your screen,
                  use your camera, and talk naturally with AEGIS.
                </p>
              </div>

              <div className="grid gap-3.5 sm:gap-5 md:grid-cols-2">
                <div className="flex flex-col justify-between rounded-2xl border border-indigo-400/25 bg-[#0f152d] p-4 sm:p-6">
                  <div>
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/20 text-indigo-300 sm:h-11 sm:w-11">
                      <GraduationCap className="h-5 w-5 sm:h-6 sm:w-6" />
                    </div>
                    <h2 className="mt-3 text-base font-bold text-white sm:mt-4 sm:text-lg">
                      Study Space
                    </h2>
                    <p className="mt-1 text-sm leading-relaxed text-slate-300">
                      Educational workspace for JAMB &amp; WAEC prep, Mathematics, Physics,
                      Chemistry, Biology, English, PDF/image analysis, and practice drills.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => navigateTo("study")}
                    className="mt-4 inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-500 sm:mt-5 sm:text-xs"
                  >
                    Open Study Space
                    <ArrowRight className="h-4 w-4" />
                  </button>
                </div>

                <div className="flex flex-col justify-between rounded-2xl border border-violet-400/30 bg-[#0f152d] p-4 sm:p-6">
                  <div>
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/20 text-violet-300 sm:h-11 sm:w-11">
                      <Monitor className="h-5 w-5 sm:h-6 sm:w-6" />
                    </div>
                    <h2 className="mt-3 text-base font-bold text-white sm:mt-4 sm:text-lg">
                      Live Companion
                    </h2>
                    <p className="mt-1 text-sm leading-relaxed text-slate-300">
                      Interactive screen sharing, optional camera assistance, and voice
                      guidance for websites, apps, error messages, and accessibility.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => navigateTo("companion")}
                    className="mt-4 inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:from-violet-500 hover:to-indigo-500 sm:mt-5 sm:text-xs"
                  >
                    Open Live Companion
                    <ArrowRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === "study" && (
            <div key={`study-${sessionSeed}`} className="mx-auto w-full max-w-7xl">
              <StudySpaceWorkspace />
            </div>
          )}

          {activeTab === "companion" && (
            <div key={`companion-${sessionSeed}`} className="mx-auto w-full max-w-5xl">
              <LiveCompanionWorkspace />
            </div>
          )}

          {activeTab === "apk" && (
            <div className="mx-auto w-full max-w-6xl">
              <ApkPortal />
            </div>
          )}

          {(activeTab === "devices" || activeTab === "security") && (
            <div className="mx-auto w-full max-w-6xl rounded-2xl border border-violet-500/20 bg-[#0b1024]/90 p-3 text-slate-100 shadow-2xl sm:p-5">
              {checkingAuth ? (
                <div className="py-12 text-center text-sm text-slate-400">
                  Verifying JEE AEGIS session...
                </div>
              ) : !token || !user ? (
                <div className="py-2 sm:py-6">
                  <AuthPanel onAuthenticated={handleAuthenticated} />
                </div>
              ) : activeTab === "devices" ? (
                <DevicesDashboard token={token} />
              ) : (
                <SecuritySettings
                  token={token}
                  user={user}
                  onSignOut={handleSignOut}
                />
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

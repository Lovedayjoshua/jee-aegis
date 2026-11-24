import {
  AegisAuthResponse,
  AegisCommand,
  AegisCommandType,
  AegisDevice,
  AegisUser,
  AegisUserPreferencesResponse,
  AuditLogItem,
} from "./types";

const TOKEN_KEY = "jee_aegis_token_v1";
const USER_KEY = "jee_aegis_user_v1";

export class AegisAuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "AegisAuthError";
    this.status = status;
  }
}

export function getApiBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_AEGIS_API_URL?.replace(/\/$/, "") ||
    "https://jee-aegis.onrender.com"
  );
}

export function getStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token: string | null): void {
  if (typeof window === "undefined") return;
  if (token) {
    window.localStorage.setItem(TOKEN_KEY, token);
  } else {
    window.localStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem(USER_KEY);
  }
}

export function getStoredUser(): AegisUser | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as AegisUser) : null;
  } catch {
    return null;
  }
}

export function setStoredUser(user: AegisUser | null): void {
  if (typeof window === "undefined") return;
  try {
    if (user) {
      window.localStorage.setItem(USER_KEY, JSON.stringify(user));
    } else {
      window.localStorage.removeItem(USER_KEY);
    }
  } catch {
    // ignore storage quota errors
  }
}

async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
  token?: string | null
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const timeoutId =
    typeof window !== "undefined"
      ? window.setTimeout(() => controller.abort(), 30000)
      : null;

  try {
    const res = await fetch(`${getApiBaseUrl()}${path}`, {
      ...options,
      headers,
      signal: options.signal ?? controller.signal,
    });

    const text = await res.text();
    let data: Record<string, unknown> = {};
    if (text) {
      try {
        data = JSON.parse(text) as Record<string, unknown>;
      } catch {
        data = { detail: text };
      }
    }
    if (!res.ok) {
      const msg =
        (typeof data.detail === "string" && data.detail) ||
        (typeof data.error === "string" && data.error) ||
        `Request failed (${res.status})`;
      if (res.status === 401 && token) {
        setStoredToken(null);
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("aegis:session-expired"));
        }
        throw new AegisAuthError(msg, 401);
      }
      throw new Error(msg);
    }
    return data as T;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("Request timed out while contacting the AEGIS cloud service.");
    }
    throw err;
  } finally {
    if (timeoutId !== null && typeof window !== "undefined") {
      window.clearTimeout(timeoutId);
    }
  }
}

export async function registerUser(
  email: string,
  fullName: string,
  password: string
): Promise<AegisAuthResponse> {
  return apiFetch<AegisAuthResponse>("/api/v1/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, full_name: fullName, password }),
  });
}

export async function loginUser(
  email: string,
  password: string
): Promise<AegisAuthResponse> {
  return apiFetch<AegisAuthResponse>("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export async function fetchCurrentUser(token: string): Promise<AegisUser> {
  return apiFetch<AegisUser>("/api/v1/auth/me", { method: "GET" }, token);
}

export async function refreshSessionToken(token: string): Promise<AegisAuthResponse> {
  return apiFetch<AegisAuthResponse>("/api/v1/auth/refresh", { method: "POST" }, token);
}

export async function fetchUserPreferences(
  token: string
): Promise<AegisUserPreferencesResponse> {
  return apiFetch<AegisUserPreferencesResponse>(
    "/api/v1/auth/preferences",
    { method: "GET" },
    token
  );
}

export async function saveUserPreferences(
  token: string,
  preferences: Record<string, unknown>
): Promise<AegisUserPreferencesResponse> {
  return apiFetch<AegisUserPreferencesResponse>(
    "/api/v1/auth/preferences",
    {
      method: "PUT",
      body: JSON.stringify({ preferences }),
    },
    token
  );
}

export async function fetchDevices(token: string): Promise<AegisDevice[]> {
  return apiFetch<AegisDevice[]>("/api/v1/devices", { method: "GET" }, token);
}

const DEFAULT_COMMAND_TTLS: Record<AegisCommandType, number> = {
  TORCH_ON: 300,
  TORCH_OFF: 300,
  RING_START: 300,
  RING_STOP: 300,
  LOCATE_NOW: 86400,
  SYNC_STATUS: 300,
  CAMERA_ASSIST_START: 300,
  CAMERA_ASSIST_STOP: 300,
};

export async function issueDeviceCommand(
  token: string,
  deviceId: string,
  commandType: AegisCommandType,
  ttlSeconds?: number
): Promise<AegisCommand> {
  const resolvedTtl = ttlSeconds ?? DEFAULT_COMMAND_TTLS[commandType] ?? 300;
  return apiFetch<AegisCommand>(
    `/api/v1/devices/${deviceId}/commands`,
    {
      method: "POST",
      body: JSON.stringify({ command_type: commandType, ttl_seconds: resolvedTtl }),
    },
    token
  );
}

export async function fetchDeviceCommands(
  token: string,
  deviceId: string
): Promise<AegisCommand[]> {
  return apiFetch<AegisCommand[]>(
    `/api/v1/devices/${deviceId}/commands`,
    { method: "GET" },
    token
  );
}

export async function revokeDevice(
  token: string,
  deviceId: string
): Promise<{ status: string; device_id: string }> {
  return apiFetch<{ status: string; device_id: string }>(
    `/api/v1/devices/${deviceId}`,
    { method: "DELETE" },
    token
  );
}

export async function fetchAuditLogs(token: string): Promise<AuditLogItem[]> {
  return apiFetch<AuditLogItem[]>("/api/v1/audit-logs", { method: "GET" }, token);
}

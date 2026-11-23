import {
  AegisAuthResponse,
  AegisCommand,
  AegisCommandType,
  AegisDevice,
  AegisUser,
  AuditLogItem,
} from "./types";

const TOKEN_KEY = "jee_aegis_token_v1";

export function getApiBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_AEGIS_API_URL?.replace(/\/$/, "") ||
    "http://localhost:8000"
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

  const res = await fetch(`${getApiBaseUrl()}${path}`, {
    ...options,
    headers,
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new Error(data.detail || data.error || `Request failed (${res.status})`);
  }
  return data as T;
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

export async function fetchDevices(token: string): Promise<AegisDevice[]> {
  return apiFetch<AegisDevice[]>("/api/v1/devices", { method: "GET" }, token);
}

export async function issueDeviceCommand(
  token: string,
  deviceId: string,
  commandType: AegisCommandType,
  ttlSeconds = 120
): Promise<AegisCommand> {
  return apiFetch<AegisCommand>(
    `/api/v1/devices/${deviceId}/commands`,
    {
      method: "POST",
      body: JSON.stringify({ command_type: commandType, ttl_seconds: ttlSeconds }),
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

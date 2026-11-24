export type AegisCommandType =
  | "RING_START"
  | "RING_STOP"
  | "TORCH_ON"
  | "TORCH_OFF"
  | "LOCATE_NOW"
  | "CAMERA_ASSIST_START"
  | "CAMERA_ASSIST_STOP"
  | "SYNC_STATUS";

export interface AegisUser {
  id: string;
  email: string;
  full_name: string;
  created_at: string;
}

export interface AegisAuthResponse {
  access_token: string;
  token_type: string;
  user: AegisUser;
}

export interface TelemetrySnapshot {
  battery_level: number | null;
  is_charging: boolean | null;
  network_type: string;
  latitude: number | null;
  longitude: number | null;
  location_accuracy_m: number | null;
  location_timestamp: string | null;
  location_freshness: "fresh" | "stale" | "unavailable";
  permissions: Record<string, boolean>;
  torch_on: boolean;
  alarm_active: boolean;
  camera_assist_active: boolean;
  recorded_at: string | null;
}

export interface AegisDevice {
  id: string;
  device_name: string;
  manufacturer: string;
  model: string;
  android_version: string;
  app_version: string;
  is_online: boolean;
  is_revoked: boolean;
  last_seen_at: string | null;
  created_at: string;
  telemetry: TelemetrySnapshot | null;
}

export type AegisCommandStatus =
  | "pending"
  | "sent"
  | "dispatched"
  | "retrieved"
  | "delivered"
  | "executing"
  | "completed"
  | "executed"
  | "acked"
  | "failed"
  | "expired";

export interface AegisCommand {
  id: string;
  device_id: string;
  command_type: AegisCommandType;
  payload: Record<string, unknown>;
  status: AegisCommandStatus;
  error_message: string;
  retry_count: number;
  expires_at: string;
  created_at: string;
  dispatched_at: string | null;
  acked_at: string | null;
  fcm_dispatched: boolean;
}

export interface AuditLogItem {
  id: string;
  device_id: string | null;
  action: string;
  actor_type: string;
  ip_address: string;
  details: Record<string, unknown>;
  created_at: string;
}

# JEE AEGIS — System Architecture & Technical Specification

**Company:** JEE (formerly Venflow)  
**Product:** JEE AEGIS — Intelligent AI Phone Companion & Remote Device Management Platform

---

## 1. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        JEE AEGIS Web Platform                           │
│              Next.js 16 (App Router) + TypeScript + Tailwind            │
│  ┌──────────────────────┐  ┌──────────────────────┐  ┌───────────────┐  │
│  │  AEGIS AI Assistant  │  │  Device Management   │  │  APK Portal & │  │
│  │  - Voice & Camera    │  │  - Ring / Torch      │  │  Security     │  │
│  │  - JAMB / WAEC       │  │  - Live Location Map │  │  Settings     │  │
│  │  - Accessibility     │  │  - Battery & Perms   │  └───────────────┘  │
│  │  - Phone Guidance    │  │  - Camera Assist     │                     │
│  └──────────┬───────────┘  └──────────┬───────────┘                     │
└─────────────┼─────────────────────────┼─────────────────────────────────┘
              │ Server-side API routes  │ HTTPS + JWT Bearer
              ▼                         ▼
┌─────────────────────────┐  ┌────────────────────────────────────────────┐
│   Google Gemini API     │  │        Python FastAPI Backend              │
│   - gemini-4-hydrogen   │  │  - Auth & JWT User Sessions                │
│   - gemini-3.5-flash-   │  │  - Per-Device Secret Auth (SHA-256)        │
│     lite (fallback)     │  │  - Command Queue (Expiry, Retry, Ack)      │
│   - Multimodal Vision   │  │  - Telemetry & Location Ingestion          │
│   - Function Calling    │  │  - Audit Logs (Immutable Trail)            │
└─────────────────────────┘  └──────────┬──────────────────┬──────────────┘
                                        │                  │
                              FCM Push  │                  │ HTTPS Poll / Ack
                              (Wakeup)  ▼                  ▼
                             ┌────────────────────────────────────────────┐
                             │   AEGIS Phone Connector (Android Kotlin)   │
                             │  - EncryptedSharedPreferences              │
                             │  - Granular Permission Onboarding          │
                             │  - AegisMessagingService (FCM)             │
                             │  - AegisForegroundService (Alarm/Torch/    │
                             │    Location/Visible Camera Assist)         │
                             └────────────────────────────────────────────┘
```

---

## 2. Database Schema (`backend/schema.sql`)

- **`users`**: `id` (UUID), `email` (unique), `full_name`, `password_hash`, `is_active`, `created_at`.
- **`devices`**: `id` (UUID), `user_id` (FK -> `users.id`), `device_name`, `manufacturer`, `model`, `android_version`, `app_version`, `fcm_token`, `device_secret_hash`, `is_revoked`, `last_seen_at`, `created_at`.
- **`device_telemetry`**: `id` (UUID), `device_id` (FK -> `devices.id`), `battery_level`, `is_charging`, `network_type`, `latitude`, `longitude`, `location_accuracy_m`, `location_timestamp`, `permissions_json` (location, background_location, camera, microphone, notifications, torch_available), `torch_on`, `alarm_active`, `camera_assist_active`, `recorded_at`.
- **`device_commands`**: `id` (UUID), `device_id` (FK -> `devices.id`), `user_id` (FK -> `users.id`), `command_type` (`RING_START`, `RING_STOP`, `TORCH_ON`, `TORCH_OFF`, `LOCATE_NOW`, `CAMERA_ASSIST_START`, `CAMERA_ASSIST_STOP`, `SYNC_STATUS`), `payload_json`, `status` (`pending`, `dispatched`, `acked`, `failed`, `expired`), `error_message`, `retry_count`, `expires_at`, `created_at`, `dispatched_at`, `acked_at`.
- **`audit_logs`**: `id` (UUID), `user_id`, `device_id`, `action`, `actor_type` (`user`, `device`, `system`), `ip_address`, `details_json`, `created_at`.

---

## 3. API Contracts (FastAPI `/api/v1`)

### Account Authentication
- `POST /api/v1/auth/register` — Register user, returns JWT + user profile.
- `POST /api/v1/auth/login` — Authenticate user, returns JWT + user profile.
- `GET /api/v1/auth/me` — Current authenticated user profile.

### Device Registration & Management (User JWT)
- `GET /api/v1/devices` — List user's connected devices with latest telemetry & online status.
- `POST /api/v1/devices/register` — Register a new Android device under user's account; returns `device_id` and one-time `device_secret`.
- `GET /api/v1/devices/{device_id}` — Detailed device status, latest location (freshness computed), permissions, recent commands.
- `DELETE /api/v1/devices/{device_id}` — Revoke & disconnect device (logs audit event, invalidates `device_secret`).
- `POST /api/v1/devices/{device_id}/commands` — Issue authenticated remote command with `ttl_seconds` (default 120s). Dispatches via FCM if configured and queues for pull.
- `GET /api/v1/devices/{device_id}/commands` — Command history for the device.
- `GET /api/v1/audit-logs` — Security audit trail for the user's account.

### Android Connector Endpoints (`X-Device-Id` + `X-Device-Secret`)
- `POST /api/v1/connector/heartbeat` — Update FCM token, battery, charging state, location, and granular permissions.
- `GET /api/v1/connector/commands/pending` — Fetch non-expired pending commands (marks expired ones automatically).
- `POST /api/v1/connector/commands/{command_id}/ack` — Acknowledge command execution (`acked` or `failed` + `error_message`).

---

## 4. Technical Limitations & Android Platform Realities

1. **Internet Requirement**: Remote commands require active Wi-Fi or cellular data on the target phone. Removing a SIM does not block communication if Wi-Fi is connected.
2. **Powered-Off State**: If the phone is powered off, no software or network command can activate its hardware.
3. **IMEI Limitation**: An IMEI alone cannot remotely ring, locate, or control a device; communication requires the authenticated AEGIS Phone Connector + FCM/HTTPS.
4. **Background & Camera Restrictions**: Android 10+ restricts background location and background camera access. Camera assistance requires explicit owner authorization, a foreground service (`foregroundServiceType="camera"`), and a persistent visible notification.
5. **Muting & Alarm Audio**: Remote Ringing uses `AudioAttributes.USAGE_ALARM` to bypass media/notification mute where Android system policy and Do Not Disturb permissions permit.
6. **Privilege Boundary**: Standard APK installation does not grant unrestricted Device Owner / Device Admin privileges.

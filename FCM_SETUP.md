# JEE AEGIS — Firebase Cloud Messaging (FCM) Setup

JEE AEGIS uses **Firebase Cloud Messaging (FCM)** high-priority data-only messages to wake up the native Android connector when remote commands (`RING_START`, `RING_STOP`, `TORCH_ON`, `TORCH_OFF`, `LOCATE_NOW`, `SYNC_STATUS`, `CAMERA_ASSIST_START`, `CAMERA_ASSIST_STOP`) are issued.

If FCM is not configured yet, the backend and Android connector automatically fall back to the authenticated HTTPS pull queue (`/api/v1/connector/commands/pending`).

---

## 1. Android App Configuration (`android/app/google-services.json`)

1. Open the [Firebase Console](https://console.firebase.google.com/) and create or select your project.
2. Register an Android app with package name:
   ```txt
   ng.jee.aegis.connector
   ```
3. Download `google-services.json` and place it at:
   ```txt
   android/app/google-services.json
   ```
4. **Safe Build Architecture**:
   - `android/app/google-services.json` is excluded in `.gitignore` so private Firebase keys are never committed to Git.
   - `android/app/build.gradle.kts` checks `if (file("google-services.json").exists())` before applying `com.google.gms.google-services`, so CI and local builds succeed even before `google-services.json` is supplied.

---

## 2. Backend Configuration (`backend/.env` / Render Environment)

Add your Firebase credentials to `backend/.env` (or Render environment variables):

```env
FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account","project_id":"..."}
# Or legacy FCM server key if used:
FCM_SERVER_KEY=your_fcm_server_key
```

---

## 3. Command TTL & Delivery Lifecycle

- **Flashlight (`TORCH_ON` / `TORCH_OFF`)**: `300` seconds (5 minutes)
- **Ring (`RING_START` / `RING_STOP`)**: `300` seconds (5 minutes)
- **Locate (`LOCATE_NOW`)**: `86400` seconds (24 hours)
- **Command Status Lifecycle**:
  `pending` → `sent` (FCM dispatched) → `delivered` (received by device) → `executing` → `executed` / `acked` (or `failed` / `expired`).

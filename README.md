# JEE AEGIS

**Intelligent AI Phone Companion & Secure Remote Android Device Management Platform**  
Company: **JEE** (formerly Venflow) • Product: **JEE AEGIS**

---

## 1. Project Overview & Problem Statement (Nigeria)

Across Nigeria, students, visually impaired individuals, and everyday smartphone users face three interconnected challenges:

1. **Exam & Practical Learning Gaps**: Students preparing for **JAMB UTME** and **WAEC SSCE**—especially in Mathematics, Physics, Chemistry, Biology, and English—often lack affordable, on-demand step-by-step tutoring that can read handwritten work, textbook diagrams, or lab setups.
2. **Everyday Digital & Accessibility Friction**: Users navigating unfamiliar apps, registration portals, error messages, or printed documents (including visually impaired users who need spoken scene and label reading) need real-time visual and voice guidance.
3. **Device Loss & Recovery**: Misplaced Android phones are difficult to locate or trigger safely without invasive or insecure third-party tools.

**JEE AEGIS** unifies a multimodal Gemini AI companion (**Study Space** and **Live Companion**) with a permission-scoped native Android connector (**AEGIS Phone Connector**) and a FastAPI security backend.

---

## 2. Solution & Main Features

### A. Study Space (Educational Workspace)
- **JAMB UTME & WAEC SSCE** preparation alongside STEM practical scenarios (Calculus, Ohm's Law & Breadboard checks, Python debugging).
- **Multimodal Input**: Camera/screen snapshots, voice recordings, PDF textbook/reference uploads, and text questions.
- **Step-by-Step Coaching**: Line-by-line transcription, rubric scoring, KaTeX math rendering, visual hint cards, and practice micro-drills.

### B. Live Companion (Interactive Everyday Assistant)
- **Desktop Screen Sharing (`getDisplayMedia`)**: Live preview with explicit `Screen Sharing Active` indicator, `Stop Sharing` control, and scaled JPEG frame sampling (`1024×576`) sent to Gemini so AEGIS can explain pages, error messages, and UI steps.
- **Optional Camera Assistance**: Explicit opt-in `getUserMedia` camera preview with visible active indicator and immediate `Stop Camera` control.
- **Voice Interaction**: Turn-based `MediaRecorder` microphone capture with `Listening`, `Processing`, and `AI Speaking` state badges, `Mute`/`Unmute` toggle, and browser `speechSynthesis` spoken responses.
- **Honest Visual Context**: If no screen or camera frame is attached, AEGIS explicitly tells the user rather than guessing.

### C. AEGIS Phone Connector (Native Android Kotlin App)
- **Granular Permission Onboarding**: Users individually grant or decline Location, Camera, Microphone, and Notifications.
- **Remote Recovery & Telemetry**:
  - `RING_START` / `RING_STOP` (uses `AudioAttributes.USAGE_ALARM` with persistent notification and Stop action)
  - `TORCH_ON` / `TORCH_OFF` (`CameraManager.setTorchMode`)
  - `LOCATE_NOW` (`FusedLocationProviderClient` with fresh vs. stale timestamp classification and OpenStreetMap display)
  - `SYNC_STATUS` (battery percentage, charging state, network type, permission matrix)
  - `CAMERA_ASSIST_START` / `CAMERA_ASSIST_STOP` (owner-authorized only, persistent foreground notification)
  - **Android `MediaProjection` Screen Sharing** (`ScreenShareService` with system permission prompt and persistent `Stop Sharing` notification)

---

## 3. Technology Stack & Architecture

- **Frontend**: Next.js `16.4.6` (App Router, Turbopack), React `19`, TypeScript, Tailwind CSS `4.3.3`, `lucide-react`, `katex`
- **Runtime AI**: `@google/genai` (`^3.6.1`) with modular provider abstraction (`lib/ai/provider.ts`), `gemini-3.5-flash` primary and `gemini-3.1-flash-lite` fallback (API key kept strictly server-side)
- **Backend**: Python `3.11`, FastAPI (`0.115.0`), SQLAlchemy (`2.0.35`), Pydantic v2 (`pydantic[email]`, `email-validator`), PyJWT, Firebase Admin SDK (`firebase-admin` HTTP v1), Uvicorn (`0.30.6`)
- **Database**: SQLite for local development (`backend/aegis.db`); PostgreSQL / Supabase schema (`backend/schema.sql`) with `users`, `user_preferences`, `devices`, `device_telemetry`, `device_commands`, and `audit_logs` tables, indexes, and transaction-scoped Row-Level Security (RLS) policies
- **Android (`ng.jee.aegis.connector` `v1.1.0`)**: Native Kotlin (`android/`, `compileSdk = 35`, `targetSdk = 35`), AndroidX Security Crypto (`EncryptedSharedPreferences`), OkHttp, WorkManager, Play Services Location, Camera2 Torch API, MediaPlayer Alarm Audio, MediaProjection Screen Capture, and Firebase Cloud Messaging
- **CI/CD & Hosting**: GitHub Actions (`.github/workflows/build-apk.yml`), Vercel (Next.js frontend: `https://jee-aegis-mv4i-roan.vercel.app`), Render (FastAPI backend: `https://jee-aegis.onrender.com`)

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for system diagrams and API contracts.

---

## 4. Installation, Setup & Run Instructions

### Prerequisites
- Node.js `20+` (verified on `v24.18.1`)
- Python `3.11+` (verified on `3.11.0`)
- JDK 17 + Android SDK 35 *(required only for local Android Gradle compilation; CI builds run automatically via GitHub Actions)*

### 1. Backend Setup & Run
```powershell
cd backend
pip install -r requirements.txt
copy .env.example .env
# Edit backend/.env to set JWT_SECRET and DATABASE_URL (PostgreSQL URI for persistent storage, or sqlite:///./aegis.db for local dev)
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

### 2. Frontend Setup & Run
```powershell
npm install
copy .env.example .env
# Edit .env to set GEMINI_API_KEY (and NEXT_PUBLIC_AEGIS_API_URL=http://localhost:8000 for local backend dev; defaults to https://jee-aegis.onrender.com)
npm run dev
```

### 3. Android APK Build
- **Via GitHub Actions (`.github/workflows/build-apk.yml`)**: Runs automatically on push to `main` touching `android/**` or `.github/workflows/build-apk.yml`, or manually via `workflow_dispatch` (with optional `publish_release = true` to update the `apk-latest` GitHub Release asset `jee-aegis.apk`).
- **Locally (when JDK 17 & Android SDK 35 are installed)**:
```powershell
cd android
.\gradlew assembleDebug
```

---

## 5. Environment Variables

### Frontend (`.env` — never commit)
- `GEMINI_API_KEY`: Google AI Studio API key (server-side only)
- `NEXT_PUBLIC_AEGIS_API_URL`: FastAPI backend base URL (defaults to `https://jee-aegis.onrender.com`)
- `AEGIS_AI_MODEL` *(optional)*: Primary Gemini model (default `gemini-3.5-flash`)
- `AEGIS_AI_FALLBACK_MODEL` *(optional)*: Fallback Gemini model (default `gemini-3.1-flash-lite`)

### Backend (`backend/.env` — never commit)
- `DATABASE_URL` (or `SUPABASE_DATABASE_URL` / `POSTGRES_URL`): PostgreSQL connection URI for persistent storage (falls back to `sqlite:///./aegis.db` for local development)
- `JWT_SECRET`: Strong random secret for signing user JWTs
- `JWT_EXPIRE_MINUTES`: Token lifetime in minutes (default `10080` / 7 days)
- `CORS_ORIGINS`: Comma-separated allowed frontend origins (always includes `https://jee-aegis-mv4i-roan.vercel.app` and `localhost:3000`)
- `DEVICE_ONLINE_THRESHOLD_SECONDS`: Online heartbeat threshold (default `90`)
- `FIREBASE_SERVICE_ACCOUNT_JSON` *(optional)*: Firebase Admin service account JSON string for FCM HTTP v1 push wakeup

---

## 6. Testing & Verification Instructions

```powershell
# Backend integration, security, command lifecycle & persistence tests (11 tests)
cd backend
python -m pytest -v

# Frontend TypeScript validation & production build
cd ..
npx tsc --noEmit
npm run build
```

Verified automated results on November 24, 2026:
- `pytest`: **11 / 11 passed** (account register/login/me, device registration & telemetry, command expiration & revocation, cross-account isolation + replay protection + all 8 commands, auth failures & DB health check, FCM token refresh & command TTLs, FCM HTTP v1 dispatch modes & payload verification, PostgreSQL RLS session context & cleanup, intermediate/terminal command status lifecycle, device re-registration deduplication & production CORS preflight, and logout → login → refresh → restart persistence).
- `npx tsc --noEmit`: **Passed** (`0` TypeScript errors).
- `npm run build`: **Passed** (Next.js `16.4.6` Turbopack production build).

---

## 7. Pre-Sprint Baseline vs. Hackathon Sprint Contributions (Nov 22–24, 2026)

### Features That Existed Before November 22, 2026
- **Git Commit `d8e4fa4083330722358bfb14cd03d619a0394444` (Nov 21, 2026)**: Initial `create-next-app` Next.js scaffold (`app/layout.tsx`, `app/page.tsx`, `app/globals.css`, `package.json`, `tsconfig.json`, `eslint.config.mjs`, `next.config.ts`).
- **Local Pre-Sprint Study Coach Prototype**: Early `SocraticLab` Study Coach components (`components/study-coach/*`, `lib/study-coach/*`, `lib/video/frame-capturer.ts`, `app/api/analyze-work/route.ts`, `app/api/sessions/route.ts`) existed in the local working tree prior to the November 22–24 JEE AEGIS sprint.

### Features Actually Built or Materially Improved During November 22–24, 2026
1. **Unified JEE AEGIS Dark-Navy & Violet Design System (Web & Android)**:
   - Synchronized the entire web platform (`AegisPlatformShell.tsx`, `AuthPanel.tsx`, `DevicesDashboard.tsx`, `DeviceMap.tsx`, `SecuritySettings.tsx`, `ApkPortal.tsx`, `StudySpaceWorkspace.tsx`, `StudyCoachWorkspace.tsx`, `SessionSummaryModal.tsx`, `KaTeXBlock.tsx`) with the Android application (`activity_main.xml`) using a shared dark-navy (`#070A18`, `#0B1024`, `#0F152D`, `#141B38`) and violet/indigo (`#6D28D9` / `#4F46E5`) visual hierarchy across desktop, tablet, and mobile viewports.
2. **FastAPI Security, Command Queue & Persistence Backend (`backend/`)**:
   - Implemented user registration/login (`/api/v1/auth/register`, `/api/v1/auth/login`, `/api/v1/auth/me`, `/api/v1/auth/refresh`), per-user persistent preferences (`user_preferences` table + `GET/PUT /api/v1/auth/preferences`), per-device secret registration (`/api/v1/devices/register`) with same-phone deduplication, device revocation, and audit logging (`/api/v1/audit-logs`).
   - Built the remote command queue (`/api/v1/devices/{id}/commands`, `/api/v1/connector/commands/pending`, `/api/v1/connector/commands/{id}/ack`) supporting intermediate (`delivered`, `retrieved`, `executing`) and terminal (`acked`, `executed`, `completed`, `failed`, `expired`) states, rapid duplicate command deduplication, command TTLs (`300s` for Torch/Ring/Camera Assist/Sync, `86400s` for Locate Now), and inline telemetry updates.
   - Added transaction-scoped PostgreSQL Row-Level Security (`app.current_user_id` automatically re-applied across transactions via SQLAlchemy `after_begin` hook), multi-variable PostgreSQL URL detection, `/health` persistence diagnostics, and Firebase Admin SDK HTTP v1 push wakeup (`backend/app/fcm.py`).
3. **Native Android Connector (`android/`, `ng.jee.aegis.connector` `v1.1.0`)**:
   - Built the native Kotlin connector with `EncryptedSharedPreferences`, hidden internal production backend configuration (`https://jee-aegis.onrender.com`), and granular runtime permission onboarding.
   - Hardened `AegisForegroundService` for Android 14/15 (`targetSdk = 35`) with permission-aware `foregroundServiceType` startup (`dataSync|location|mediaPlayback|camera`), a continuous 4-second HTTPS pull-queue polling loop, 28-second telemetry heartbeats, target `device_id` ownership verification, duplicate hardware execution prevention, Do Not Disturb compliance on `RING_START`, and explicit hardware failure reporting.
4. **Live Companion, APK Release Integration & Session Continuity**:
   - Built `LiveCompanionWorkspace.tsx` and `/api/companion/chat` with streaming NDJSON multimodal responses, iOS/Safari camera and screen-share compatibility, and client-side compressed screenshot uploads.
   - Connected `/api/apk/status` and `/api/apk/download` to the live GitHub Release (`apk-latest/jee-aegis.apk`) and fixed `.github/workflows/build-apk.yml` to use Android SDK Command-Line Tools (API 35) with explicit `firebase-enabled` vs. `non-firebase-fallback` build classification.
   - Implemented cold-start resilient JWT session restoration and database-backed workspace state continuity across logout, login, tab switching, and browser refresh.

---

## 8. AI Tools Disclosure

- **ChatGPT**: Used during development for product ideation, architecture planning, requirement refinement, prompt drafting, and debugging analysis.
- **Google Antigravity**: Used in the development environment for full-stack code implementation (Next.js frontend, FastAPI backend, native Android Kotlin connector, GitHub Actions APK workflow), cross-platform UI unification, security and data-persistence auditing, and automated test execution.
- **Google Gemini (`@google/genai`)**: Powers the runtime user-facing multimodal AI capabilities in **Study Space** (`/api/analyze-work`) and **Live Companion** (`/api/companion/chat`) using `gemini-3.5-flash` (primary) and `gemini-3.1-flash-lite` (fallback).

---

## 9. Security & Privacy

- `GEMINI_API_KEY`, `JWT_SECRET`, `DATABASE_URL`, `FIREBASE_SERVICE_ACCOUNT_JSON`, and `google-services.json` are kept strictly server-side / CI-scoped and excluded from Git via `.gitignore`.
- Passwords use PBKDF2-SHA256 (`120,000` iterations); devices authenticate with per-device SHA-256 hashed secrets stored in `EncryptedSharedPreferences` on Android.
- Owner-scoped queries and PostgreSQL RLS policies prevent cross-account device access; commands verify target `device_id` ownership, expire automatically, and reject duplicate/expired acknowledgements.
- Screen sharing, camera, and microphone require explicit browser or Android system permissions, display visible active indicators, respect Do Not Disturb, and can be stopped immediately by the user.

---

## 10. Deployment & Verification Status (Honest Assessment)

See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for deployment instructions across **Supabase**, **Render** (`render.yaml`), and **Vercel** (`vercel.json`).

### Verified vs. Pending Production/Hardware Verification
- **Automated Backend & Frontend Checks (Verified)**: All 11 backend `pytest` tests, TypeScript compiler validation (`npx tsc --noEmit`), and the Next.js `16.4.6` production build (`npm run build`) pass locally.
- **Render Production Database Persistence (Pending Post-Push `/health` Verification)**: The backend code supports persistent PostgreSQL (`DATABASE_URL` / `SUPABASE_DATABASE_URL` / `POSTGRES_URL`) and exposes `"engine"` and `"persistent"` on `GET /health`. However, persistent PostgreSQL in production is **not confirmed** until the updated backend is deployed to Render (`https://jee-aegis.onrender.com/health`) and verified to return `"engine": "postgresql"` and `"persistent": true`. If `DATABASE_URL` in Render is left unset or points to SQLite, Render will use container-local SQLite, which is ephemeral across container restarts.
- **Android APK (`v1.1.0`) CI Compilation & Physical Device Hardware Tests (Pending Post-Push)**: Because JDK 17 and Android SDK 35 are not installed on the local Windows development machine, the updated `v1.1.0` Android code (`4s` pull-queue polling, fixed `https://jee-aegis.onrender.com` URL, Android 14/15 foreground service fixes) must be compiled by `.github/workflows/build-apk.yml` after pushing to GitHub, and physical hardware execution (`TORCH_ON`, `TORCH_OFF`, `RING_START`, `RING_STOP`, `CAMERA_ASSIST_START`, `LOCATE_NOW`) must be verified on a physical Android phone.
- **Firebase Push Status**: The currently published `apk-latest` release asset was built in `debug-non-firebase-fallback` mode (HTTPS pull-queue only). Building a `firebase-enabled` APK requires `GOOGLE_SERVICES_JSON_BASE64` (or `GOOGLE_SERVICES_JSON`) to be configured in GitHub repository secrets when `.github/workflows/build-apk.yml` runs.

---

## 11. Hackathon Information

- **Event**: TCC Hackathon (November 22–24, 2026)
- **Organization**: JEE (formerly Venflow)
- **Product**: JEE AEGIS

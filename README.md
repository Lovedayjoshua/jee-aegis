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

- **Frontend**: Next.js `16.4.6` (App Router, Turbopack), TypeScript, Tailwind CSS `4.3.3`, `lucide-react`, `katex`
- **AI**: `@google/genai` (`^3.6.1`) with modular provider abstraction (`lib/ai/provider.ts`), `gemini-3.5-flash` primary and `gemini-3.1-flash-lite` fallback (API key kept strictly server-side)
- **Backend**: Python `3.11`, FastAPI (`0.115.0`), SQLAlchemy (`2.0.35`), Pydantic v2, PyJWT, Uvicorn (`0.30.6`)
- **Database**: SQLite for local development (`backend/aegis.db`); PostgreSQL / Supabase schema (`backend/schema.sql`) with foreign keys, indexes, and RLS policies
- **Android**: Native Kotlin (`android/`), AndroidX Security Crypto (`EncryptedSharedPreferences`), OkHttp, WorkManager, Play Services Location, Firebase Cloud Messaging

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for system diagrams and API contracts.

---

## 4. Installation & Setup

### Prerequisites
- Node.js `20+` (verified on `v24.18.1`)
- Python `3.11+` (verified on `3.11.0`)
- Android Studio / JDK 17 + Android SDK 35 *(only required to compile the Android APK)*

### Backend Setup
```powershell
cd backend
pip install -r requirements.txt
copy .env.example .env
# Edit backend/.env to set a strong JWT_SECRET (and DATABASE_URL for Postgres if desired)
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

### Frontend Setup
```powershell
npm install
copy .env.example .env
# Edit .env to set GEMINI_API_KEY and NEXT_PUBLIC_AEGIS_API_URL=http://localhost:8000
npm run dev
```

### Android APK Build (on a machine with JDK 17 & Android SDK 35)
```powershell
cd android
.\gradlew assembleDebug
copy app\build\outputs\apk\debug\app-debug.apk ..\public\downloads\jee-aegis.apk
```

---

## 5. Environment Variables

### Frontend (`.env` — never commit)
- `GEMINI_API_KEY`: Google AI Studio API key (server-side only)
- `NEXT_PUBLIC_AEGIS_API_URL`: FastAPI backend base URL (e.g. `http://localhost:8000` or Render URL)
- `AEGIS_AI_MODEL` *(optional)*: Primary Gemini model (default `gemini-3.5-flash`)
- `AEGIS_AI_FALLBACK_MODEL` *(optional)*: Fallback Gemini model (default `gemini-3.1-flash-lite`)

### Backend (`backend/.env` — never commit)
- `DATABASE_URL`: `sqlite:///./aegis.db` (local) or Supabase PostgreSQL URI
- `JWT_SECRET`: Strong random secret for signing user JWTs
- `JWT_EXPIRE_MINUTES`: Token lifetime in minutes (default `1440`)
- `CORS_ORIGINS`: Comma-separated allowed frontend origins
- `DEVICE_ONLINE_THRESHOLD_SECONDS`: Online heartbeat threshold (default `90`)
- `FCM_SERVER_KEY` *(optional)*: Firebase Cloud Messaging server key

---

## 6. Testing Instructions

```powershell
# Backend integration & security tests (5 tests)
cd backend
python -m pytest -v

# Frontend production build & TypeScript check
cd ..
npm run build
```

Verified local results:
- `pytest`: **5 passed** (auth, device registration & telemetry, command expiration & revocation, cross-account isolation + replay protection + all 8 commands, auth failures & DB health check).
- `npm run build`: **Passed** (Next.js 16.4.6 Turbopack + TypeScript).

---

## 7. Pre-Sprint Baseline vs. Hackathon Sprint Contributions (Nov 22–24, 2026)

### Pre-November 22, 2026 Baseline (Git Commit `d8e4fa4083330722358bfb14cd03d619a0394444`, Nov 21, 2026)
- Initial `create-next-app` Next.js scaffold (`app/layout.tsx`, `app/page.tsx`, `app/globals.css`, `package.json`, `tsconfig.json`, `eslint.config.mjs`, `next.config.ts`).
- Note: The `SocraticLab` Study Coach components (`components/study-coach/*`, `lib/study-coach/*`, `lib/video/frame-capturer.ts`, `app/api/analyze-work/route.ts`, `app/api/sessions/route.ts`) were present in the local working tree prior to the JEE AEGIS updates, though uncommitted in Git.

### Verified Nov 22–24, 2026 Hackathon Sprint Additions & Improvements
- **Python FastAPI Backend (`backend/`)**: Complete user auth, per-device secret registration, telemetry & location freshness tracking, expiring command queue, replay protection (`409`/`410`), sliding-window rate limiting, audit logging, and 5 `pytest` integration tests.
- **Database & Deployment Prep**: `backend/schema.sql` (with RLS policies), PostgreSQL URL normalization (`backend/app/database.py`), `render.yaml`, `vercel.json`, and `docs/DEPLOYMENT.md`.
- **Native Android Connector (`android/`)**: Kotlin connector app with `EncryptedSharedPreferences`, granular permission onboarding, `AegisForegroundService` (alarm, torch, GPS, visible camera assist), `AegisMessagingService` (FCM), `TelemetryWorker`, and `ScreenShareService` (`MediaProjection`).
- **JEE AEGIS Dashboard & Dual AI Experiences**: Dark navy/purple UI (`AegisPlatformShell.tsx`), **Study Space** (with JAMB/WAEC, Accessibility, and Phone Guide scenarios), **Live Companion** (`LiveCompanionWorkspace.tsx` + `/api/companion/chat` with `getDisplayMedia` screen sharing, camera, and voice), **Connected Devices** (`DevicesDashboard.tsx`, `DeviceMap.tsx`), **APK & Setup** (`/api/apk/status`, `/api/apk/download`), and modular AI provider fallback (`lib/ai/provider.ts`).

---

## 8. AI Tools Disclosure

- **Google Gemini (`@google/genai`)**: Powers runtime multimodal reasoning, JAMB/WAEC coaching, and Live Companion screen/camera/voice responses (`gemini-3.5-flash` / `gemini-3.1-flash-lite`).
- **Google Antigravity**: Used during development for architecture design, backend/frontend/Android implementation, security auditing, and integration testing.
- **ChatGPT**: *(Disclosed where applicable if used by the team for ideation or drafting outside this workspace.)*

---

## 9. Security & Privacy

- `GEMINI_API_KEY`, `JWT_SECRET`, and `DATABASE_URL` are kept strictly server-side and excluded from Git via `.gitignore`.
- Passwords use PBKDF2-SHA256 (`120,000` iterations); devices authenticate with per-device SHA-256 hashed secrets stored in `EncryptedSharedPreferences` on Android.
- Owner-scoped queries prevent cross-account device access; commands expire automatically and reject duplicate/expired acknowledgements.
- Screen sharing, camera, and microphone require explicit browser or Android system permissions, display visible active indicators, and can be stopped immediately by the user.

---

## 10. Deployment Instructions

See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for full step-by-step instructions for **Supabase** (PostgreSQL + `backend/schema.sql`), **Render** (`render.yaml`), and **Vercel** (`vercel.json`).

---

## 11. Known Limitations

- **Android APK Not Yet Compiled**: JDK 17 and Android SDK 35 are not installed on the current build host; `/api/apk/status` reports `available: false` and `/api/apk/download` returns `404` until a real APK is compiled and placed at `public/downloads/jee-aegis.apk`.
- **Hardware & Live DB Unverified**: Remote Android hardware actions (alarm, torch, GPS, `MediaProjection`) and live Supabase PostgreSQL / FCM push delivery have not yet been tested on a physical Android phone or live Postgres instance.
- **Voice Mode**: Voice interaction is currently turn-based (`MediaRecorder` + `speechSynthesis`), not full-duplex Gemini Live WebSocket streaming.
- **Browser Automation**: Automated Chrome DevTools UI clicking could not run on this host (`DevToolsActivePort` not enabled).

---

## 12. Future Roadmap

- Compile and sign `JEE-AEGIS.apk` for direct distribution.
- Upgrade Live Companion to full-duplex Gemini Live API WebSocket audio/video streaming.
- Verify live Supabase PostgreSQL and Firebase Cloud Messaging end-to-end on physical Android devices.

---

## 13. Hackathon Information

- **Event**: TCC Hackathon (November 22–24, 2026)
- **Organization**: JEE (formerly Venflow)
- **Product**: JEE AEGIS

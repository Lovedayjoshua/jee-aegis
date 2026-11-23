# JEE AEGIS — Production Deployment Guide (Supabase + Render + Vercel)

- **Official GitHub Repository**: `https://github.com/Lovedayjoshua/jee-aegis`
- **Local Branch**: `master` • **Remote**: `origin`

## 1. Supabase (PostgreSQL Database)
1. Create a new Supabase project.
2. Open **SQL Editor** and run [`backend/schema.sql`](../backend/schema.sql).
   - Verifies tables: `users`, `devices`, `device_telemetry`, `device_commands`, `audit_logs`.
   - Applies foreign keys, indexes, and Row Level Security (RLS) policies.
3. Copy the **Transaction/Session Pooler** or **Direct Connection** PostgreSQL URI (`postgresql://postgres:...@db.<ref>.supabase.co:5432/postgres`).

## 2. Render (FastAPI Backend)
1. Connect your GitHub repository to Render (or import `render.yaml`).
2. Settings:
   - **Root Directory**: `backend`
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
   - **Health Check Path**: `/health`
3. Environment Variables:
   - `DATABASE_URL` = your Supabase PostgreSQL URI
   - `JWT_SECRET` = strong random 64-char secret
   - `CORS_ORIGINS` = `https://your-vercel-domain.vercel.app`
   - `FCM_SERVER_KEY` = (optional) Firebase Cloud Messaging server key

## 3. Vercel (Next.js Frontend)
1. Import the GitHub repository in Vercel with **Root Directory**: `.` (repository root).
2. Environment Variables:
   - `GEMINI_API_KEY` = your Google AI Studio API key (server-side only)
   - `NEXT_PUBLIC_AEGIS_API_URL` = `https://your-render-backend.onrender.com`
   - `AEGIS_AI_MODEL` = `gemini-3.5-flash` (optional override)
   - `AEGIS_AI_FALLBACK_MODEL` = `gemini-3.1-flash-lite` (optional override)
3. Deploy, then copy your live `https://*.vercel.app` URL into Render's `CORS_ORIGINS`.

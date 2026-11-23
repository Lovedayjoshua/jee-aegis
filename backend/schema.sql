-- JEE AEGIS PostgreSQL / Supabase Reference Schema
-- Compatible with PostgreSQL 15+ and Supabase

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL,
    full_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_name TEXT NOT NULL,
    manufacturer TEXT DEFAULT '',
    model TEXT DEFAULT '',
    android_version TEXT DEFAULT '',
    app_version TEXT DEFAULT '1.0.0',
    fcm_token TEXT DEFAULT '',
    device_secret_hash TEXT NOT NULL,
    is_revoked BOOLEAN NOT NULL DEFAULT FALSE,
    last_seen_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_devices_user_id ON devices(user_id);

CREATE TABLE IF NOT EXISTS device_telemetry (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    battery_level INTEGER,
    is_charging BOOLEAN,
    network_type TEXT DEFAULT 'unknown',
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    location_accuracy_m DOUBLE PRECISION,
    location_timestamp TIMESTAMPTZ,
    permissions_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    torch_on BOOLEAN NOT NULL DEFAULT FALSE,
    alarm_active BOOLEAN NOT NULL DEFAULT FALSE,
    camera_assist_active BOOLEAN NOT NULL DEFAULT FALSE,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_telemetry_device_recorded
    ON device_telemetry(device_id, recorded_at DESC);

CREATE TABLE IF NOT EXISTS device_commands (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    command_type TEXT NOT NULL,
    payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT NOT NULL DEFAULT 'pending',
    error_message TEXT DEFAULT '',
    retry_count INTEGER NOT NULL DEFAULT 0,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    dispatched_at TIMESTAMPTZ,
    acked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_commands_device_status
    ON device_commands(device_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    device_id UUID REFERENCES devices(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    actor_type TEXT NOT NULL DEFAULT 'user',
    ip_address TEXT DEFAULT '',
    details_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_created
    ON audit_logs(user_id, created_at DESC);

-- Row Level Security (RLS) for Supabase / PostgreSQL deployments
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_telemetry ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Note: FastAPI uses its own JWT auth and enforces owner-scoping in application queries.
-- When connecting from a non-superuser Postgres role, set `SET LOCAL app.current_user_id = '<uuid>'`
-- or use Supabase `auth.uid()`. Direct PostgREST/anon access is blocked by default.
CREATE POLICY users_self_select ON users
    FOR SELECT USING (
        COALESCE(NULLIF(current_setting('app.current_user_id', true), '')::uuid, auth.uid()) = id
    );

CREATE POLICY devices_owner_all ON devices
    FOR ALL USING (
        COALESCE(NULLIF(current_setting('app.current_user_id', true), '')::uuid, auth.uid()) = user_id
    );

CREATE POLICY telemetry_owner_select ON device_telemetry
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM devices d
            WHERE d.id = device_id
              AND d.user_id = COALESCE(NULLIF(current_setting('app.current_user_id', true), '')::uuid, auth.uid())
        )
    );

CREATE POLICY commands_owner_all ON device_commands
    FOR ALL USING (
        COALESCE(NULLIF(current_setting('app.current_user_id', true), '')::uuid, auth.uid()) = user_id
    );

CREATE POLICY audit_owner_select ON audit_logs
    FOR SELECT USING (
        COALESCE(NULLIF(current_setting('app.current_user_id', true), '')::uuid, auth.uid()) = user_id
    );

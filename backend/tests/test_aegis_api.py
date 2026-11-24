import os
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

os.environ["DATABASE_URL"] = "sqlite:///./test_aegis.db"

from app.database import Base, engine, SessionLocal  # noqa: E402
from app.main import app  # noqa: E402
from app.models import DeviceCommand, utcnow_naive  # noqa: E402


@pytest.fixture(autouse=True)
def reset_db():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


def _register_and_login(client: TestClient, email="student@jee.ng"):
    res = client.post(
        "/api/v1/auth/register",
        json={
            "email": email,
            "full_name": "Adebayo Chinedu",
            "password": "StrongPassword123!",
        },
    )
    assert res.status_code == 201
    token = res.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_auth_register_login_and_me(client: TestClient):
    headers = _register_and_login(client)
    me = client.get("/api/v1/auth/me", headers=headers)
    assert me.status_code == 200
    assert me.json()["email"] == "student@jee.ng"

    login = client.post(
        "/api/v1/auth/login",
        json={"email": "student@jee.ng", "password": "StrongPassword123!"},
    )
    assert login.status_code == 200
    assert "access_token" in login.json()


def test_device_registration_telemetry_and_commands(client: TestClient):
    user_headers = _register_and_login(client)

    reg = client.post(
        "/api/v1/devices/register",
        headers=user_headers,
        json={
            "device_name": "Pixel 8 Pro",
            "manufacturer": "Google",
            "model": "Pixel 8 Pro",
            "android_version": "15",
            "app_version": "1.0.0",
        },
    )
    assert reg.status_code == 201
    reg_data = reg.json()
    device_id = reg_data["device_id"]
    device_secret = reg_data["device_secret"]

    device_headers = {
        "X-Device-Id": device_id,
        "X-Device-Secret": device_secret,
    }

    # Connector posts heartbeat with battery, location, and permissions
    hb = client.post(
        "/api/v1/connector/heartbeat",
        headers=device_headers,
        json={
            "battery_level": 84,
            "is_charging": False,
            "network_type": "wifi",
            "latitude": 6.5244,
            "longitude": 3.3792,
            "location_accuracy_m": 12.5,
            "permissions": {
                "location": True,
                "camera": True,
                "microphone": True,
                "notifications": True,
                "torch_available": True,
            },
            "torch_on": False,
            "alarm_active": False,
        },
    )
    assert hb.status_code == 200

    # User lists devices and sees online status + fresh location
    devices = client.get("/api/v1/devices", headers=user_headers)
    assert devices.status_code == 200
    items = devices.json()
    assert len(items) == 1
    assert items[0]["is_online"] is True
    assert items[0]["telemetry"]["battery_level"] == 84
    assert items[0]["telemetry"]["location_freshness"] == "fresh"

    # User issues RING_START command
    cmd_res = client.post(
        f"/api/v1/devices/{device_id}/commands",
        headers=user_headers,
        json={"command_type": "RING_START", "ttl_seconds": 120},
    )
    assert cmd_res.status_code == 201
    cmd_id = cmd_res.json()["id"]

    # Connector polls pending commands
    pending = client.get("/api/v1/connector/commands/pending", headers=device_headers)
    assert pending.status_code == 200
    assert len(pending.json()) == 1
    assert pending.json()[0]["id"] == cmd_id
    assert pending.json()[0]["command_type"] == "RING_START"

    # Connector acknowledges command
    ack = client.post(
        f"/api/v1/connector/commands/{cmd_id}/ack",
        headers=device_headers,
        json={"status": "acked"},
    )
    assert ack.status_code == 200
    assert ack.json()["status"] == "acked"

    # Audit logs contain registration, command issued, and command acked
    logs = client.get("/api/v1/audit-logs", headers=user_headers)
    assert logs.status_code == 200
    actions = [item["action"] for item in logs.json()]
    assert "DEVICE_REGISTERED" in actions
    assert "COMMAND_ISSUED:RING_START" in actions
    assert "COMMAND_ACKED:RING_START" in actions


def test_command_expiration_and_device_revocation(client: TestClient):
    user_headers = _register_and_login(client, email="owner@jee.ng")
    reg = client.post(
        "/api/v1/devices/register",
        headers=user_headers,
        json={"device_name": "Galaxy A55"},
    ).json()
    device_id = reg["device_id"]
    device_headers = {
        "X-Device-Id": device_id,
        "X-Device-Secret": reg["device_secret"],
    }

    cmd_res = client.post(
        f"/api/v1/devices/{device_id}/commands",
        headers=user_headers,
        json={"command_type": "TORCH_ON", "ttl_seconds": 30},
    )
    cmd_id = cmd_res.json()["id"]

    # Force command expiration in DB
    db = SessionLocal()
    try:
        cmd = db.query(DeviceCommand).filter(DeviceCommand.id == cmd_id).first()
        cmd.expires_at = utcnow_naive() - timedelta(seconds=10)
        db.commit()
    finally:
        db.close()

    pending = client.get("/api/v1/connector/commands/pending", headers=device_headers)
    assert pending.status_code == 200
    assert pending.json() == []

    history = client.get(f"/api/v1/devices/{device_id}/commands", headers=user_headers)
    assert history.json()[0]["status"] == "expired"

    # Revoke device and verify connector is blocked
    rev = client.delete(f"/api/v1/devices/{device_id}", headers=user_headers)
    assert rev.status_code == 200
    blocked = client.post("/api/v1/connector/heartbeat", headers=device_headers, json={})
    assert blocked.status_code == 401


def test_cross_account_isolation_replay_and_all_commands(client: TestClient):
    owner_headers = _register_and_login(client, email="alice@jee.ng")
    attacker_headers = _register_and_login(client, email="bob@jee.ng")

    reg = client.post(
        "/api/v1/devices/register",
        headers=owner_headers,
        json={"device_name": "Alice Phone"},
    ).json()
    device_id = reg["device_id"]
    device_headers = {
        "X-Device-Id": device_id,
        "X-Device-Secret": reg["device_secret"],
    }

    # Attacker cannot view, command, or revoke Alice's device
    assert client.get(f"/api/v1/devices/{device_id}", headers=attacker_headers).status_code == 404
    assert (
        client.post(
            f"/api/v1/devices/{device_id}/commands",
            headers=attacker_headers,
            json={"command_type": "RING_START"},
        ).status_code
        == 404
    )
    assert client.delete(f"/api/v1/devices/{device_id}", headers=attacker_headers).status_code == 404
    assert client.get("/api/v1/devices", headers=attacker_headers).json() == []

    # Test all 8 supported commands end-to-end
    all_commands = [
        "RING_START",
        "RING_STOP",
        "TORCH_ON",
        "TORCH_OFF",
        "LOCATE_NOW",
        "SYNC_STATUS",
        "CAMERA_ASSIST_START",
        "CAMERA_ASSIST_STOP",
    ]
    issued_ids = []
    for cmd_type in all_commands:
        res = client.post(
            f"/api/v1/devices/{device_id}/commands",
            headers=owner_headers,
            json={"command_type": cmd_type, "ttl_seconds": 120},
        )
        assert res.status_code == 201
        issued_ids.append(res.json()["id"])

    pending = client.get("/api/v1/connector/commands/pending", headers=device_headers)
    assert pending.status_code == 200
    assert len(pending.json()) == len(all_commands)

    for cid in issued_ids:
        ack = client.post(
            f"/api/v1/connector/commands/{cid}/ack",
            headers=device_headers,
            json={"status": "acked"},
        )
        assert ack.status_code == 200

    # Replay protection: re-acking an already finalized command returns 409
    replay = client.post(
        f"/api/v1/connector/commands/{issued_ids[0]}/ack",
        headers=device_headers,
        json={"status": "acked"},
    )
    assert replay.status_code == 409


def test_auth_failures_and_health_db_check(client: TestClient):
    health = client.get("/health")
    assert health.status_code == 200
    assert health.json()["database"] == "connected"

    # Unauthenticated access rejected
    assert client.get("/api/v1/auth/me").status_code == 401
    assert client.get("/api/v1/devices").status_code == 401

    # Invalid login rejected
    _register_and_login(client, email="valid@jee.ng")
    bad_login = client.post(
        "/api/v1/auth/login",
        json={"email": "valid@jee.ng", "password": "WrongPassword!"},
    )
    assert bad_login.status_code == 401

    # Invalid device secret rejected
    bad_hb = client.post(
        "/api/v1/connector/heartbeat",
        headers={"X-Device-Id": "nonexistent", "X-Device-Secret": "wrong"},
        json={},
    )
    assert bad_hb.status_code == 401


def test_fcm_token_refresh_deduplication_and_command_ttls(client: TestClient):
    user_headers = _register_and_login(client, email="remote@jee.ng")
    reg = client.post(
        "/api/v1/devices/register",
        headers=user_headers,
        json={"device_name": "Infinix Note 40"},
    ).json()
    device_id = reg["device_id"]
    device_headers = {
        "X-Device-Id": device_id,
        "X-Device-Secret": reg["device_secret"],
    }

    # 1. FCM token refresh endpoint
    tok_res = client.post(
        "/api/v1/connector/fcm-token",
        headers=device_headers,
        json={"fcm_token": "fcm_live_token_12345"},
    )
    assert tok_res.status_code == 200

    # 2. Rapid duplicate command deduplication + default 300s TTL for TORCH_ON
    c1 = client.post(
        f"/api/v1/devices/{device_id}/commands",
        headers=user_headers,
        json={"command_type": "TORCH_ON"},
    )
    c2 = client.post(
        f"/api/v1/devices/{device_id}/commands",
        headers=user_headers,
        json={"command_type": "TORCH_ON"},
    )
    assert c1.status_code == 201
    assert c2.status_code == 201
    assert c1.json()["id"] == c2.json()["id"]

    # 3. Default 86400s (24h) TTL for LOCATE_NOW
    loc_cmd = client.post(
        f"/api/v1/devices/{device_id}/commands",
        headers=user_headers,
        json={"command_type": "LOCATE_NOW"},
    )
    assert loc_cmd.status_code == 201

    # 4. Connector polling marks commands as 'delivered'
    pending = client.get("/api/v1/connector/commands/pending", headers=device_headers)
    assert pending.status_code == 200
    assert len(pending.json()) == 2
    assert all(item["status"] == "delivered" for item in pending.json())

    # 5. Connector acknowledges LOCATE_NOW with inline GPS telemetry
    ack = client.post(
        f"/api/v1/connector/commands/{loc_cmd.json()['id']}/ack",
        headers=device_headers,
        json={
            "status": "acked",
            "telemetry": {
                "battery_level": 91,
                "is_charging": True,
                "network_type": "wifi",
                "latitude": 9.0765,
                "longitude": 7.3986,
                "location_accuracy_m": 6.4,
                "torch_on": True,
            },
        },
    )
    assert ack.status_code == 200
    assert ack.json()["status"] == "acked"

    dev = client.get(f"/api/v1/devices/{device_id}", headers=user_headers).json()
    assert dev["telemetry"]["latitude"] == 9.0765
    assert dev["telemetry"]["torch_on"] is True
    assert dev["telemetry"]["location_freshness"] == "fresh"


def test_fcm_http_v1_dispatch_error_modes_and_payload(client: TestClient, monkeypatch):
    from datetime import timedelta as td
    from unittest.mock import MagicMock
    import firebase_admin
    from firebase_admin import exceptions as fb_exceptions, messaging
    from app import fcm
    from app.config import settings
    from app.models import Device

    fcm.reset_firebase_state_for_tests()

    user_headers = _register_and_login(client, email="fcmv1@jee.ng")
    reg = client.post(
        "/api/v1/devices/register",
        headers=user_headers,
        json={"device_name": "Pixel 9", "fcm_token": "valid_fcm_token_abc"},
    ).json()
    device_id = reg["device_id"]

    # 1. Missing credentials -> queue_only fallback
    monkeypatch.setattr(settings, "firebase_service_account_json", "")
    res_missing = fcm.dispatch_fcm_command(
        fcm_token="valid_fcm_token_abc",
        command_id="cmd-1",
        command_type="TORCH_ON",
        payload={},
        expires_at_iso="2026-11-24T01:00:00Z",
        ttl_seconds=300,
        device_id=device_id,
    )
    assert res_missing["dispatched"] is False
    assert res_missing["mode"] == "queue_only"
    assert res_missing["reason"] == "fcm_not_configured"

    # 2. Invalid credentials JSON -> invalid_credentials queue_fallback
    monkeypatch.setattr(settings, "firebase_service_account_json", "{not-valid-json")
    res_bad_cred = fcm.dispatch_fcm_command(
        fcm_token="valid_fcm_token_abc",
        command_id="cmd-2",
        command_type="TORCH_ON",
        payload={},
        expires_at_iso="2026-11-24T01:00:00Z",
        ttl_seconds=300,
        device_id=device_id,
    )
    assert res_bad_cred["dispatched"] is False
    assert res_bad_cred["mode"] == "queue_fallback"
    assert res_bad_cred["reason"] == "invalid_credentials"

    # 3. Valid credentials + singleton app reuse + data-only payload + TTL verification
    valid_sa_json = (
        '{"type":"service_account","project_id":"jee-aegis-prod",'
        '"client_email":"fcm@jee-aegis-prod.iam.gserviceaccount.com",'
        '"private_key":"-----BEGIN PRIVATE KEY-----\\nMII...\\n-----END PRIVATE KEY-----\\n"}'
    )
    monkeypatch.setattr(settings, "firebase_service_account_json", valid_sa_json)

    fake_app = MagicMock(spec=firebase_admin.App)
    init_calls = []

    def fake_cert(data):
        return data

    def fake_get_app(name):
        raise ValueError("not initialized")

    def fake_init_app(cred, options=None, name=None):
        init_calls.append((cred, options, name))
        return fake_app

    sent_messages = []

    def fake_send(msg, app=None):
        sent_messages.append((msg, app))
        return "projects/jee-aegis-prod/messages/msg-101"

    monkeypatch.setattr(fcm.credentials, "Certificate", fake_cert)
    monkeypatch.setattr(fcm.firebase_admin, "get_app", fake_get_app)
    monkeypatch.setattr(fcm.firebase_admin, "initialize_app", fake_init_app)
    monkeypatch.setattr(fcm.messaging, "send", fake_send)

    # Issue RING_START via API (300s TTL) and LOCATE_NOW (86400s TTL)
    ring_res = client.post(
        f"/api/v1/devices/{device_id}/commands",
        headers=user_headers,
        json={"command_type": "RING_START"},
    )
    assert ring_res.status_code == 201
    assert ring_res.json()["status"] == "sent"
    assert ring_res.json()["fcm_dispatched"] is True

    locate_res = client.post(
        f"/api/v1/devices/{device_id}/commands",
        headers=user_headers,
        json={"command_type": "LOCATE_NOW"},
    )
    assert locate_res.status_code == 201
    assert locate_res.json()["status"] == "sent"

    # Singleton Firebase app initialized only once across both dispatches
    assert len(init_calls) == 1
    assert init_calls[0][1] == {"projectId": "jee-aegis-prod"}
    assert len(sent_messages) == 2

    ring_msg, _ = sent_messages[0]
    locate_msg, _ = sent_messages[1]
    assert ring_msg.notification is None  # Strictly data-only
    assert ring_msg.data["command_type"] == "RING_START"
    assert ring_msg.data["device_id"] == device_id
    assert ring_msg.data["command_id"] == ring_res.json()["id"]
    assert ring_msg.android.priority == "high"
    assert ring_msg.android.ttl == td(seconds=300)
    assert locate_msg.android.ttl == td(seconds=86400)

    # 4. Network failure -> queue_fallback while preserving command in pull queue
    def fake_send_network_err(msg, app=None):
        raise fb_exceptions.UnavailableError("FCM endpoint temporarily unreachable")

    monkeypatch.setattr(fcm.messaging, "send", fake_send_network_err)
    torch_res = client.post(
        f"/api/v1/devices/{device_id}/commands",
        headers=user_headers,
        json={"command_type": "TORCH_OFF"},
    )
    assert torch_res.status_code == 201
    assert torch_res.json()["status"] == "pending"
    assert torch_res.json()["fcm_dispatched"] is False

    # 5. Unregistered / invalid FCM token -> clears device.fcm_token in DB
    def fake_send_unregistered(msg, app=None):
        raise messaging.UnregisteredError("Requested entity was not found (UNREGISTERED)")

    monkeypatch.setattr(fcm.messaging, "send", fake_send_unregistered)
    ring_stop_res = client.post(
        f"/api/v1/devices/{device_id}/commands",
        headers=user_headers,
        json={"command_type": "RING_STOP"},
    )
    assert ring_stop_res.status_code == 201
    assert ring_stop_res.json()["status"] == "pending"

    db = SessionLocal()
    try:
        dev_row = db.query(Device).filter(Device.id == device_id).first()
        assert dev_row.fcm_token == ""
    finally:
        db.close()
        fcm.reset_firebase_state_for_tests()


def test_postgres_rls_session_context_and_cleanup():
    from unittest.mock import MagicMock
    from app.database import get_db, set_rls_user_context

    # 1. Verify SQLite session records and cleans up rls_user_id on close
    gen = get_db()
    db = next(gen)
    set_rls_user_context(db, "11111111-2222-3333-4444-555555555555")
    assert db.info.get("rls_user_id") == "11111111-2222-3333-4444-555555555555"
    try:
        next(gen)
    except StopIteration:
        pass
    assert "rls_user_id" not in db.info

    # 2. Verify PostgreSQL dialect executes transaction-scoped set_config(..., true)
    mock_pg_session = MagicMock()
    mock_pg_session.info = {}
    mock_bind = MagicMock()
    mock_bind.dialect.name = "postgresql"
    mock_pg_session.get_bind.return_value = mock_bind

    set_rls_user_context(mock_pg_session, "aaaa1111-bbbb-2222-cccc-333333333333")
    assert mock_pg_session.execute.called
    sql_arg, params_arg = mock_pg_session.execute.call_args[0]
    assert "set_config('app.current_user_id', :uid, true)" in str(sql_arg)
    assert params_arg == {"uid": "aaaa1111-bbbb-2222-cccc-333333333333"}


def test_command_execution_lifecycle_intermediate_and_terminal_statuses(client: TestClient):
    user_headers = _register_and_login(client, email="lifecycle@jee.ng")
    reg = client.post(
        "/api/v1/devices/register",
        headers=user_headers,
        json={"device_name": "TECNO Camon 30"},
    ).json()
    device_id = reg["device_id"]
    device_headers = {
        "X-Device-Id": device_id,
        "X-Device-Secret": reg["device_secret"],
    }

    # 1. Queue TORCH_ON without FCM token (HTTPS pull-queue fallback)
    torch_cmd = client.post(
        f"/api/v1/devices/{device_id}/commands",
        headers=user_headers,
        json={"command_type": "TORCH_ON"},
    )
    assert torch_cmd.status_code == 201
    torch_id = torch_cmd.json()["id"]
    assert torch_cmd.json()["status"] == "pending"

    # 2. First poll marks command as 'delivered'; re-poll while non-terminal still returns it
    poll_1 = client.get("/api/v1/connector/commands/pending", headers=device_headers)
    assert poll_1.status_code == 200
    assert len(poll_1.json()) == 1
    assert poll_1.json()[0]["id"] == torch_id
    assert poll_1.json()[0]["status"] == "delivered"

    poll_2 = client.get("/api/v1/connector/commands/pending", headers=device_headers)
    assert poll_2.status_code == 200
    assert len(poll_2.json()) == 1
    assert poll_2.json()[0]["id"] == torch_id

    # 3. Intermediate transition to 'executing' succeeds and does not finalize command yet
    exec_res = client.post(
        f"/api/v1/connector/commands/{torch_id}/ack",
        headers=device_headers,
        json={"status": "executing"},
    )
    assert exec_res.status_code == 200
    assert exec_res.json()["status"] == "executing"
    assert exec_res.json()["acked_at"] is None

    # 4. Final hardware execution acknowledgement ('acked') with inline telemetry finalizes command
    ack_res = client.post(
        f"/api/v1/connector/commands/{torch_id}/ack",
        headers=device_headers,
        json={
            "status": "acked",
            "telemetry": {
                "battery_level": 77,
                "is_charging": False,
                "network_type": "wifi",
                "torch_on": True,
                "alarm_active": False,
            },
        },
    )
    assert ack_res.status_code == 200
    assert ack_res.json()["status"] == "acked"
    assert ack_res.json()["acked_at"] is not None

    # Command is now removed from pending queue
    poll_3 = client.get("/api/v1/connector/commands/pending", headers=device_headers)
    assert poll_3.status_code == 200
    assert poll_3.json() == []

    # 5. Hardware failure path: CAMERA_ASSIST_START -> executing -> failed with error_message
    cam_cmd = client.post(
        f"/api/v1/devices/{device_id}/commands",
        headers=user_headers,
        json={"command_type": "CAMERA_ASSIST_START"},
    )
    assert cam_cmd.status_code == 201
    cam_id = cam_cmd.json()["id"]

    fail_res = client.post(
        f"/api/v1/connector/commands/{cam_id}/ack",
        headers=device_headers,
        json={
            "status": "failed",
            "error_message": "CAMERA permission not granted on Android device",
        },
    )
    assert fail_res.status_code == 200
    assert fail_res.json()["status"] == "failed"
    assert fail_res.json()["error_message"] == "CAMERA permission not granted on Android device"
    assert fail_res.json()["acked_at"] is not None


def test_device_re_registration_deduplication_and_cors_preflight(client: TestClient):
    # 1. Verify production Vercel origin is allowed by CORS preflight
    cors_res = client.options(
        "/api/v1/auth/login",
        headers={
            "Origin": "https://jee-aegis-mv4i-roan.vercel.app",
            "Access-Control-Request-Method": "POST",
        },
    )
    assert cors_res.status_code == 200
    assert (
        cors_res.headers.get("access-control-allow-origin")
        == "https://jee-aegis-mv4i-roan.vercel.app"
    )

    # 2. Verify re-registering the same physical phone reuses device_id and rotates secret
    user_headers = _register_and_login(client, email="samephone@jee.ng")
    payload = {
        "device_name": "Samsung SM-A556E",
        "manufacturer": "Samsung",
        "model": "SM-A556E",
        "android_version": "14",
        "app_version": "1.1.0",
    }
    reg_1 = client.post("/api/v1/devices/register", headers=user_headers, json=payload).json()
    reg_2 = client.post("/api/v1/devices/register", headers=user_headers, json=payload).json()

    assert reg_1["device_id"] == reg_2["device_id"]
    assert reg_1["device_secret"] != reg_2["device_secret"]

    # Old secret is invalidated; new secret works
    old_headers = {"X-Device-Id": reg_1["device_id"], "X-Device-Secret": reg_1["device_secret"]}
    new_headers = {"X-Device-Id": reg_2["device_id"], "X-Device-Secret": reg_2["device_secret"]}
    assert client.get("/api/v1/connector/commands/pending", headers=old_headers).status_code == 401
    assert client.get("/api/v1/connector/commands/pending", headers=new_headers).status_code == 200

    # Dashboard device list contains exactly 1 active entry for this phone
    devices = client.get("/api/v1/devices", headers=user_headers).json()
    assert len(devices) == 1
    assert devices[0]["id"] == reg_2["device_id"]


def test_account_device_and_preferences_persistence_across_logout_login_and_refresh(
    client: TestClient,
):
    # 1. Register user and save workspace preferences + register an Android device + issue command
    auth_1 = client.post(
        "/api/v1/auth/register",
        json={
            "email": "persist@jee.ng",
            "full_name": "Chidinma Okafor",
            "password": "PersistentPassword123!",
        },
    )
    assert auth_1.status_code == 201
    token_1 = auth_1.json()["access_token"]
    user_id = auth_1.json()["user"]["id"]
    headers_1 = {"Authorization": f"Bearer {token_1}"}

    # Save user preferences (active tab, study state, companion messages)
    pref_save = client.put(
        "/api/v1/auth/preferences",
        headers=headers_1,
        json={
            "preferences": {
                "active_tab": "devices",
                "companion_state": {
                    "messages": [{"id": "m1", "role": "user", "content": "Help me locate my phone"}],
                    "ttsMuted": True,
                },
            }
        },
    )
    assert pref_save.status_code == 200
    assert pref_save.json()["preferences"]["active_tab"] == "devices"

    # Partial update merges without wiping existing keys
    pref_merge = client.put(
        "/api/v1/auth/preferences",
        headers=headers_1,
        json={"preferences": {"selected_device_id": "dev-1"}},
    )
    assert pref_merge.status_code == 200
    assert pref_merge.json()["preferences"]["active_tab"] == "devices"
    assert pref_merge.json()["preferences"]["selected_device_id"] == "dev-1"

    # Register Android device and issue a command
    dev_reg = client.post(
        "/api/v1/devices/register",
        headers=headers_1,
        json={
            "device_name": "Chidinma Pixel 8",
            "manufacturer": "Google",
            "model": "Pixel 8",
            "android_version": "15",
            "app_version": "1.1.0",
        },
    ).json()
    device_id = dev_reg["device_id"]

    cmd = client.post(
        f"/api/v1/devices/{device_id}/commands",
        headers=headers_1,
        json={"command_type": "TORCH_ON"},
    )
    assert cmd.status_code == 201
    cmd_id = cmd.json()["id"]

    # 2. Simulate Logout -> Login (new JWT token)
    login_res = client.post(
        "/api/v1/auth/login",
        json={"email": "persist@jee.ng", "password": "PersistentPassword123!"},
    )
    assert login_res.status_code == 200
    login_data = login_res.json()
    assert login_data["user"]["id"] == user_id
    assert login_data["user"]["preferences"]["active_tab"] == "devices"
    assert login_data["user"]["preferences"]["companion_state"]["ttsMuted"] is True

    headers_2 = {"Authorization": f"Bearer {login_data['access_token']}"}

    # 3. Simulate Browser Refresh (/api/v1/auth/me + /api/v1/auth/refresh + /api/v1/devices + commands)
    me_res = client.get("/api/v1/auth/me", headers=headers_2)
    assert me_res.status_code == 200
    assert me_res.json()["id"] == user_id
    assert me_res.json()["preferences"]["selected_device_id"] == "dev-1"

    refresh_res = client.post("/api/v1/auth/refresh", headers=headers_2)
    assert refresh_res.status_code == 200
    headers_3 = {"Authorization": f"Bearer {refresh_res.json()['access_token']}"}

    devices_after = client.get("/api/v1/devices", headers=headers_3).json()
    assert len(devices_after) == 1
    assert devices_after[0]["id"] == device_id
    assert devices_after[0]["device_name"] == "Chidinma Pixel 8"

    cmds_after = client.get(f"/api/v1/devices/{device_id}/commands", headers=headers_3).json()
    assert len(cmds_after) == 1
    assert cmds_after[0]["id"] == cmd_id
    assert cmds_after[0]["command_type"] == "TORCH_ON"

    # 4. Re-registering phone by passing existing device_id updates name and preserves command history
    re_reg = client.post(
        "/api/v1/devices/register",
        headers=headers_3,
        json={
            "device_id": device_id,
            "device_name": "Chidinma Pixel 8 (Renamed)",
            "manufacturer": "Google",
            "model": "Pixel 8",
            "android_version": "15",
            "app_version": "1.1.0",
        },
    ).json()
    assert re_reg["device_id"] == device_id
    cmds_still_preserved = client.get(
        f"/api/v1/devices/{device_id}/commands", headers=headers_3
    ).json()
    assert len(cmds_still_preserved) == 1
    assert cmds_still_preserved[0]["id"] == cmd_id




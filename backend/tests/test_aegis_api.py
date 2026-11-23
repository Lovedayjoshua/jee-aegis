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

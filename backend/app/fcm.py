import hashlib
import json
import logging
import threading
from datetime import timedelta
from typing import Any, Dict, Optional, Tuple

import firebase_admin
from firebase_admin import credentials, exceptions as fb_exceptions, messaging

from .config import settings

logger = logging.getLogger("aegis.fcm")

DEFAULT_COMMAND_TTL_SECONDS: Dict[str, int] = {
    "TORCH_ON": 300,
    "TORCH_OFF": 300,
    "RING_START": 300,
    "RING_STOP": 300,
    "LOCATE_NOW": 86400,
    "SYNC_STATUS": 300,
    "CAMERA_ASSIST_START": 300,
    "CAMERA_ASSIST_STOP": 300,
}

_firebase_lock = threading.Lock()
_firebase_app: Optional[firebase_admin.App] = None
_firebase_cred_hash: Optional[str] = None
_firebase_project_id: Optional[str] = None


def resolve_command_ttl(command_type: str, requested_ttl: int | None) -> int:
    if requested_ttl is not None:
        return max(15, min(86400, requested_ttl))
    return DEFAULT_COMMAND_TTL_SECONDS.get(command_type, 300)


def _parse_service_account_json(raw_value: str) -> Dict[str, Any]:
    cleaned = raw_value.strip()
    if not cleaned:
        raise ValueError("Empty FIREBASE_SERVICE_ACCOUNT_JSON")
    data = json.loads(cleaned)
    if not isinstance(data, dict):
        raise ValueError("FIREBASE_SERVICE_ACCOUNT_JSON must be a JSON object")
    required_fields = ("project_id", "client_email", "private_key")
    missing = [f for f in required_fields if not data.get(f)]
    if missing:
        raise ValueError(f"Service account JSON missing required fields: {', '.join(missing)}")
    return data


def _get_or_init_firebase_app(raw_json: str) -> Tuple[firebase_admin.App, str]:
    global _firebase_app, _firebase_cred_hash, _firebase_project_id

    digest = hashlib.sha256(raw_json.encode("utf-8")).hexdigest()
    with _firebase_lock:
        if _firebase_app is not None and _firebase_cred_hash == digest and _firebase_project_id:
            return _firebase_app, _firebase_project_id

        cert_dict = _parse_service_account_json(raw_json)
        project_id = str(cert_dict["project_id"])
        cred = credentials.Certificate(cert_dict)

        app_name = f"jee_aegis_fcm_{digest[:10]}"
        try:
            app = firebase_admin.get_app(app_name)
        except ValueError:
            app = firebase_admin.initialize_app(
                cred,
                options={"projectId": project_id},
                name=app_name,
            )

        _firebase_app = app
        _firebase_cred_hash = digest
        _firebase_project_id = project_id
        return app, project_id


def reset_firebase_state_for_tests() -> None:
    global _firebase_app, _firebase_cred_hash, _firebase_project_id
    with _firebase_lock:
        if _firebase_app is not None:
            try:
                firebase_admin.delete_app(_firebase_app)
            except Exception:
                pass
        _firebase_app = None
        _firebase_cred_hash = None
        _firebase_project_id = None


def _is_unregistered_or_invalid_token_error(exc: Exception) -> bool:
    if isinstance(exc, messaging.UnregisteredError):
        return True
    if isinstance(exc, messaging.SenderIdMismatchError):
        return True
    code = getattr(exc, "code", "") or ""
    msg = str(exc)
    return (
        code in ("UNREGISTERED", "INVALID_ARGUMENT", "NOT_FOUND")
        and any(
            token_hint in msg
            for token_hint in (
                "registration token",
                "NotRegistered",
                "UNREGISTERED",
                "Invalid registration",
                "not a valid FCM registration token",
            )
        )
    ) or "UNREGISTERED" in msg or "NotRegistered" in msg


def dispatch_fcm_command(
    fcm_token: str,
    command_id: str,
    command_type: str,
    payload: Dict[str, Any],
    expires_at_iso: str,
    ttl_seconds: int = 300,
    device_id: str = "",
) -> Dict[str, Any]:
    """
    Dispatches a high-priority Android data-only FCM HTTP v1 message using
    Firebase Admin SDK and FIREBASE_SERVICE_ACCOUNT_JSON.
    Never uses the deprecated legacy server-key endpoint.
    Preserves the pull-queue fallback when credentials or token are absent/unreachable.
    """
    if not fcm_token or not fcm_token.strip():
        return {"dispatched": False, "mode": "queue_only", "reason": "no_fcm_token"}

    raw_sa = (settings.firebase_service_account_json or "").strip()
    if not raw_sa:
        return {"dispatched": False, "mode": "queue_only", "reason": "fcm_not_configured"}

    try:
        app, project_id = _get_or_init_firebase_app(raw_sa)
    except Exception as exc:
        logger.warning("Firebase Admin initialization failed: %s", type(exc).__name__)
        return {
            "dispatched": False,
            "mode": "queue_fallback",
            "reason": "invalid_credentials",
        }

    clamped_ttl = max(15, min(86400, int(ttl_seconds)))
    data_payload: Dict[str, str] = {
        "command_id": str(command_id),
        "command_type": str(command_type),
        "device_id": str(device_id),
        "expires_at": str(expires_at_iso),
        "ttl_seconds": str(clamped_ttl),
        "payload": json.dumps(payload or {}),
    }

    message = messaging.Message(
        token=fcm_token.strip(),
        data=data_payload,
        android=messaging.AndroidConfig(
            priority="high",
            ttl=timedelta(seconds=clamped_ttl),
        ),
    )

    try:
        message_id = messaging.send(message, app=app)
        return {
            "dispatched": True,
            "mode": "fcm_v1",
            "project_id": project_id,
            "message_id": message_id,
            "ttl_seconds": clamped_ttl,
        }
    except Exception as exc:
        if _is_unregistered_or_invalid_token_error(exc):
            logger.warning("FCM token rejected by HTTP v1 for device %s", device_id or "unknown")
            return {
                "dispatched": False,
                "mode": "queue_fallback",
                "reason": "invalid_token",
                "invalid_token": True,
            }
        if isinstance(exc, (fb_exceptions.UnavailableError, fb_exceptions.DeadlineExceededError, TimeoutError, ConnectionError)):
            logger.warning("FCM HTTP v1 transient network/timeout error: %s", type(exc).__name__)
            return {
                "dispatched": False,
                "mode": "queue_fallback",
                "reason": "network_error",
            }
        logger.warning("FCM HTTP v1 dispatch failed (%s)", type(exc).__name__)
        return {
            "dispatched": False,
            "mode": "queue_fallback",
            "reason": "dispatch_error",
        }

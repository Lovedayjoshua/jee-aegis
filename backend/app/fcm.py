import json
import logging
from typing import Any, Dict

import httpx

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


def resolve_command_ttl(command_type: str, requested_ttl: int | None) -> int:
    if requested_ttl is not None:
        return max(15, min(86400, requested_ttl))
    return DEFAULT_COMMAND_TTL_SECONDS.get(command_type, 300)


def dispatch_fcm_command(
    fcm_token: str,
    command_id: str,
    command_type: str,
    payload: Dict[str, Any],
    expires_at_iso: str,
    ttl_seconds: int = 300,
) -> Dict[str, Any]:
    """
    Dispatches a high-priority data-only FCM message with command-specific TTL.
    Supports legacy server key or reports queue_only fallback when unconfigured.
    Detects invalid/unregistered tokens so the caller can clear stale tokens.
    """
    if not fcm_token:
        return {"dispatched": False, "mode": "queue_only", "reason": "no_fcm_token"}
    if not settings.fcm_server_key and not settings.firebase_service_account_json:
        return {"dispatched": False, "mode": "queue_only", "reason": "fcm_not_configured"}

    if not settings.fcm_server_key:
        # Service account JSON placeholder configured without legacy key; use pull queue cleanly
        return {"dispatched": False, "mode": "queue_only", "reason": "fcm_v1_delegated_to_queue"}

    clamped_ttl = max(15, min(86400, ttl_seconds))
    body = {
        "to": fcm_token,
        "priority": "high",
        "time_to_live": clamped_ttl,
        "data": {
            "command_id": command_id,
            "command_type": command_type,
            "expires_at": expires_at_iso,
            "ttl_seconds": str(clamped_ttl),
            "payload": json.dumps(payload or {}),
        },
    }
    headers = {
        "Authorization": f"key={settings.fcm_server_key}",
        "Content-Type": "application/json",
    }
    try:
        with httpx.Client(timeout=5.0) as client:
            resp = client.post("https://fcm.googleapis.com/fcm/send", json=body, headers=headers)
            raw_text = resp.text or ""
            invalid_token = (
                "NotRegistered" in raw_text
                or "InvalidRegistration" in raw_text
                or "UNREGISTERED" in raw_text
            )
            if resp.status_code == 200 and not invalid_token:
                return {"dispatched": True, "mode": "fcm", "ttl_seconds": clamped_ttl}
            logger.warning("FCM status %s (invalid_token=%s)", resp.status_code, invalid_token)
            return {
                "dispatched": False,
                "mode": "queue_fallback",
                "status": resp.status_code,
                "invalid_token": invalid_token,
            }
    except httpx.HTTPError as exc:
        logger.warning("FCM dispatch error: %s", exc)
        return {"dispatched": False, "mode": "queue_fallback", "reason": "network_error"}

import logging
from typing import Any, Dict

import httpx

from .config import settings

logger = logging.getLogger("aegis.fcm")


def dispatch_fcm_command(
    fcm_token: str,
    command_id: str,
    command_type: str,
    payload: Dict[str, Any],
    expires_at_iso: str,
) -> Dict[str, Any]:
    """
    Dispatches a high-priority data message to the Android connector via FCM.
    If FCM_SERVER_KEY or fcm_token is absent (e.g. local dev), the command remains
    in the authenticated pull queue without failing the API request.
    """
    if not fcm_token:
        return {"dispatched": False, "mode": "queue_only", "reason": "no_fcm_token"}
    if not settings.fcm_server_key:
        return {"dispatched": False, "mode": "queue_only", "reason": "fcm_not_configured"}

    body = {
        "to": fcm_token,
        "priority": "high",
        "data": {
            "command_id": command_id,
            "command_type": command_type,
            "expires_at": expires_at_iso,
            "payload": payload,
        },
    }
    headers = {
        "Authorization": f"key={settings.fcm_server_key}",
        "Content-Type": "application/json",
    }
    try:
        with httpx.Client(timeout=5.0) as client:
            resp = client.post("https://fcm.googleapis.com/fcm/send", json=body, headers=headers)
            if resp.status_code == 200:
                return {"dispatched": True, "mode": "fcm"}
            logger.warning("FCM returned status %s: %s", resp.status_code, resp.text)
            return {"dispatched": False, "mode": "queue_fallback", "status": resp.status_code}
    except httpx.HTTPError as exc:
        logger.warning("FCM dispatch failed: %s", exc)
        return {"dispatched": False, "mode": "queue_fallback", "reason": str(exc)}

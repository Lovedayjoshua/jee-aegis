from typing import List

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from .database import get_db
from .models import AuditLog, Device, DeviceCommand, DeviceTelemetry, utcnow_naive
from .routes_devices import _expire_stale_commands
from .schemas import (
    CommandResponse,
    ConnectorCommandAckRequest,
    ConnectorFcmTokenRequest,
    ConnectorHeartbeatRequest,
)
from .security import get_authenticated_device

router = APIRouter(prefix="/api/v1/connector", tags=["connector"])

TERMINAL_COMMAND_STATUSES = ("acked", "executed", "completed", "failed", "expired")


def _record_telemetry(
    db: Session,
    device: Device,
    payload: ConnectorHeartbeatRequest,
    now,
) -> None:
    if payload.fcm_token is not None:
        device.fcm_token = payload.fcm_token.strip()

    loc_ts = (
        payload.location_timestamp.replace(tzinfo=None)
        if payload.location_timestamp
        else (now if payload.latitude is not None and payload.longitude is not None else None)
    )

    telemetry = DeviceTelemetry(
        device_id=device.id,
        battery_level=payload.battery_level,
        is_charging=payload.is_charging,
        network_type=payload.network_type,
        latitude=payload.latitude,
        longitude=payload.longitude,
        location_accuracy_m=payload.location_accuracy_m,
        location_timestamp=loc_ts,
        permissions_json=payload.permissions,
        torch_on=payload.torch_on,
        alarm_active=payload.alarm_active,
        camera_assist_active=payload.camera_assist_active,
        recorded_at=now,
    )
    db.add(telemetry)


@router.post("/fcm-token", status_code=status.HTTP_200_OK)
def refresh_fcm_token(
    payload: ConnectorFcmTokenRequest,
    device: Device = Depends(get_authenticated_device),
    db: Session = Depends(get_db),
):
    now = utcnow_naive()
    device.last_seen_at = now
    device.fcm_token = payload.fcm_token.strip()
    db.commit()
    return {"status": "ok", "device_id": device.id}


@router.post("/heartbeat", status_code=status.HTTP_200_OK)
def connector_heartbeat(
    payload: ConnectorHeartbeatRequest,
    device: Device = Depends(get_authenticated_device),
    db: Session = Depends(get_db),
):
    now = utcnow_naive()
    device.last_seen_at = now
    _record_telemetry(db, device, payload, now)
    db.commit()
    return {"status": "ok", "device_id": device.id, "server_time": now.isoformat() + "Z"}


@router.get("/commands/pending", response_model=List[CommandResponse])
def get_pending_commands(
    device: Device = Depends(get_authenticated_device),
    db: Session = Depends(get_db),
):
    now = utcnow_naive()
    device.last_seen_at = now
    _expire_stale_commands(db, device.id)

    pending = (
        db.query(DeviceCommand)
        .filter(
            DeviceCommand.device_id == device.id,
            DeviceCommand.status.in_(
                ["pending", "sent", "dispatched", "retrieved", "delivered", "executing"]
            ),
            DeviceCommand.expires_at >= now,
        )
        .order_by(DeviceCommand.created_at.asc())
        .all()
    )

    for cmd in pending:
        if cmd.status in ("pending", "sent", "dispatched"):
            cmd.status = "delivered"
            if not cmd.dispatched_at:
                cmd.dispatched_at = now
        cmd.retry_count += 1

    db.commit()

    return [
        CommandResponse(
            id=c.id,
            device_id=c.device_id,
            command_type=c.command_type,
            payload=c.payload_json or {},
            status=c.status,
            error_message=c.error_message,
            retry_count=c.retry_count,
            expires_at=c.expires_at,
            created_at=c.created_at,
            dispatched_at=c.dispatched_at,
            acked_at=c.acked_at,
            fcm_dispatched=c.dispatched_at is not None,
        )
        for c in pending
    ]


@router.post("/commands/{command_id}/ack", response_model=CommandResponse)
def acknowledge_command(
    command_id: str,
    payload: ConnectorCommandAckRequest,
    request: Request,
    device: Device = Depends(get_authenticated_device),
    db: Session = Depends(get_db),
):
    cmd = (
        db.query(DeviceCommand)
        .filter(DeviceCommand.id == command_id, DeviceCommand.device_id == device.id)
        .first()
    )
    if not cmd:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Command not found.")

    now = utcnow_naive()
    if cmd.status in TERMINAL_COMMAND_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Command already finalized with status '{cmd.status}'.",
        )
    if cmd.expires_at < now:
        cmd.status = "expired"
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="Command expired before acknowledgement.",
        )

    device.last_seen_at = now
    cmd.status = payload.status
    cmd.error_message = payload.error_message
    if not cmd.dispatched_at:
        cmd.dispatched_at = now
    if payload.status in TERMINAL_COMMAND_STATUSES:
        cmd.acked_at = now

    if payload.telemetry is not None:
        _record_telemetry(db, device, payload.telemetry, now)

    if payload.status in TERMINAL_COMMAND_STATUSES:
        action_verb = (
            "ACKED"
            if payload.status in ("acked", "executed", "completed")
            else payload.status.upper()
        )
        db.add(
            AuditLog(
                user_id=device.user_id,
                device_id=device.id,
                action=f"COMMAND_{action_verb}:{cmd.command_type}",
                actor_type="device",
                ip_address=request.client.host if request.client else "",
                details_json={
                    "command_id": cmd.id,
                    "status": payload.status,
                    "error_message": payload.error_message,
                },
            )
        )

    db.commit()
    db.refresh(cmd)

    return CommandResponse(
        id=cmd.id,
        device_id=cmd.device_id,
        command_type=cmd.command_type,
        payload=cmd.payload_json or {},
        status=cmd.status,
        error_message=cmd.error_message,
        retry_count=cmd.retry_count,
        expires_at=cmd.expires_at,
        created_at=cmd.created_at,
        dispatched_at=cmd.dispatched_at,
        acked_at=cmd.acked_at,
        fcm_dispatched=cmd.dispatched_at is not None,
    )

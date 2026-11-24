from datetime import timedelta
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from .config import settings
from .database import get_db
from .fcm import dispatch_fcm_command, resolve_command_ttl
from .models import AuditLog, Device, DeviceCommand, DeviceTelemetry, User, utcnow_naive
from .rate_limit import limit_command_requests
from .schemas import (
    AuditLogItem,
    CommandCreateRequest,
    CommandResponse,
    DeviceRegisterRequest,
    DeviceRegisterResponse,
    DeviceSummary,
    DeviceUpdateRequest,
    TelemetrySnapshot,
)
from .security import generate_device_secret, get_current_user, hash_device_secret

router = APIRouter(prefix="/api/v1", tags=["devices"])


def _expire_stale_commands(db: Session, device_id: str) -> None:
    now = utcnow_naive()
    stale = (
        db.query(DeviceCommand)
        .filter(
            DeviceCommand.device_id == device_id,
            DeviceCommand.status.in_(["pending", "sent", "dispatched", "delivered", "executing"]),
            DeviceCommand.expires_at < now,
        )
        .all()
    )
    if stale:
        for cmd in stale:
            cmd.status = "expired"
        db.commit()


def _build_telemetry_snapshot(t: DeviceTelemetry | None) -> TelemetrySnapshot | None:
    if not t:
        return None

    now = utcnow_naive()
    freshness = "unavailable"
    if t.latitude is not None and t.longitude is not None:
        ts = t.location_timestamp or t.recorded_at
        age_seconds = (now - ts).total_seconds() if ts else 999999
        freshness = "fresh" if age_seconds <= settings.location_fresh_threshold_seconds else "stale"

    return TelemetrySnapshot(
        battery_level=t.battery_level,
        is_charging=t.is_charging,
        network_type=t.network_type,
        latitude=t.latitude,
        longitude=t.longitude,
        location_accuracy_m=t.location_accuracy_m,
        location_timestamp=t.location_timestamp,
        location_freshness=freshness,
        permissions=t.permissions_json or {},
        torch_on=t.torch_on,
        alarm_active=t.alarm_active,
        camera_assist_active=t.camera_assist_active,
        recorded_at=t.recorded_at,
    )


def _build_device_summary(db: Session, device: Device) -> DeviceSummary:
    latest = (
        db.query(DeviceTelemetry)
        .filter(DeviceTelemetry.device_id == device.id)
        .order_by(DeviceTelemetry.recorded_at.desc())
        .first()
    )
    now = utcnow_naive()
    is_online = bool(
        not device.is_revoked
        and device.last_seen_at
        and (now - device.last_seen_at).total_seconds() <= settings.device_online_threshold_seconds
    )
    return DeviceSummary(
        id=device.id,
        device_name=device.device_name,
        manufacturer=device.manufacturer,
        model=device.model,
        android_version=device.android_version,
        app_version=device.app_version,
        is_online=is_online,
        is_revoked=device.is_revoked,
        last_seen_at=device.last_seen_at,
        created_at=device.created_at,
        telemetry=_build_telemetry_snapshot(latest),
    )


def _get_owned_device(db: Session, user_id: str, device_id: str) -> Device:
    device = (
        db.query(Device)
        .filter(Device.id == device_id, Device.user_id == user_id)
        .first()
    )
    if not device:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not found.")
    return device


@router.get("/devices", response_model=List[DeviceSummary])
def list_devices(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    devices = (
        db.query(Device)
        .filter(Device.user_id == current_user.id)
        .order_by(Device.created_at.desc())
        .all()
    )
    return [_build_device_summary(db, d) for d in devices]


@router.post("/devices/register", response_model=DeviceRegisterResponse, status_code=status.HTTP_201_CREATED)
def register_device(
    payload: DeviceRegisterRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    now = utcnow_naive()
    raw_secret = generate_device_secret()
    clean_id = (payload.device_id or "").strip()
    clean_name = payload.device_name.strip()
    clean_mfg = payload.manufacturer.strip()
    clean_model = payload.model.strip()
    clean_android = payload.android_version.strip()
    clean_app_ver = payload.app_version.strip()
    clean_fcm = payload.fcm_token.strip()

    # 1. If the phone passed its previously assigned device_id for this user, reuse that exact record
    existing = None
    if clean_id:
        existing = (
            db.query(Device)
            .filter(Device.id == clean_id, Device.user_id == current_user.id)
            .first()
        )

    # 2. Otherwise reuse existing non-revoked device entry for the same user + phone identity
    if not existing:
        existing = (
            db.query(Device)
            .filter(
                Device.user_id == current_user.id,
                Device.device_name == clean_name,
                Device.manufacturer == clean_mfg,
                Device.model == clean_model,
                Device.is_revoked.is_(False),
            )
            .order_by(Device.created_at.desc())
            .first()
        )

    if existing:
        device = existing
        device.device_name = clean_name
        device.manufacturer = clean_mfg or device.manufacturer
        device.model = clean_model or device.model
        device.android_version = clean_android or device.android_version
        device.app_version = clean_app_ver or device.app_version
        if clean_fcm:
            device.fcm_token = clean_fcm
        device.is_revoked = False
        device.device_secret_hash = hash_device_secret(raw_secret)
        device.last_seen_at = now
        db.flush()
    else:
        device = Device(
            user_id=current_user.id,
            device_name=clean_name,
            manufacturer=clean_mfg,
            model=clean_model,
            android_version=clean_android,
            app_version=clean_app_ver,
            fcm_token=clean_fcm,
            device_secret_hash=hash_device_secret(raw_secret),
            last_seen_at=now,
        )
        db.add(device)
        db.flush()

    db.add(
        AuditLog(
            user_id=current_user.id,
            device_id=device.id,
            action="DEVICE_REGISTERED",
            actor_type="user",
            ip_address=request.client.host if request.client else "",
            details_json={"device_name": device.device_name, "model": device.model},
        )
    )
    db.commit()
    db.refresh(device)

    return DeviceRegisterResponse(
        device_id=device.id,
        device_secret=raw_secret,
        device_name=device.device_name,
        created_at=device.created_at,
    )


@router.get("/devices/{device_id}", response_model=DeviceSummary)
def get_device(
    device_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    device = _get_owned_device(db, current_user.id, device_id)
    return _build_device_summary(db, device)


@router.patch("/devices/{device_id}", response_model=DeviceSummary)
def update_device(
    device_id: str,
    payload: DeviceUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    device = _get_owned_device(db, current_user.id, device_id)
    device.device_name = payload.device_name.strip()
    db.commit()
    db.refresh(device)
    return _build_device_summary(db, device)


@router.delete("/devices/{device_id}", status_code=status.HTTP_200_OK)
def revoke_device(
    device_id: str,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    device = _get_owned_device(db, current_user.id, device_id)
    device.is_revoked = True
    device.fcm_token = ""

    db.add(
        AuditLog(
            user_id=current_user.id,
            device_id=device.id,
            action="DEVICE_REVOKED",
            actor_type="user",
            ip_address=request.client.host if request.client else "",
            details_json={"device_name": device.device_name},
        )
    )
    db.commit()
    return {"status": "revoked", "device_id": device.id}


@router.post(
    "/devices/{device_id}/commands",
    response_model=CommandResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(limit_command_requests)],
)
def issue_command(
    device_id: str,
    payload: CommandCreateRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    device = _get_owned_device(db, current_user.id, device_id)
    if device.is_revoked:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot send commands to a revoked device.",
        )

    _expire_stale_commands(db, device.id)

    now = utcnow_naive()
    ttl_seconds = resolve_command_ttl(payload.command_type, payload.ttl_seconds)

    # Deduplicate rapid duplicate commands of the same type already in-flight within the last 10s
    recent_duplicate = (
        db.query(DeviceCommand)
        .filter(
            DeviceCommand.device_id == device.id,
            DeviceCommand.command_type == payload.command_type,
            DeviceCommand.status.in_(["pending", "sent", "dispatched", "delivered", "executing"]),
            DeviceCommand.expires_at > now,
            DeviceCommand.created_at >= now - timedelta(seconds=10),
        )
        .order_by(DeviceCommand.created_at.desc())
        .first()
    )
    if recent_duplicate:
        return CommandResponse(
            id=recent_duplicate.id,
            device_id=recent_duplicate.device_id,
            command_type=recent_duplicate.command_type,
            payload=recent_duplicate.payload_json or {},
            status=recent_duplicate.status,
            error_message=recent_duplicate.error_message,
            retry_count=recent_duplicate.retry_count,
            expires_at=recent_duplicate.expires_at,
            created_at=recent_duplicate.created_at,
            dispatched_at=recent_duplicate.dispatched_at,
            acked_at=recent_duplicate.acked_at,
            fcm_dispatched=recent_duplicate.dispatched_at is not None,
        )

    expires_at = now + timedelta(seconds=ttl_seconds)

    cmd = DeviceCommand(
        device_id=device.id,
        user_id=current_user.id,
        command_type=payload.command_type,
        payload_json=payload.payload,
        status="pending",
        expires_at=expires_at,
    )
    db.add(cmd)
    db.flush()

    fcm_result = dispatch_fcm_command(
        fcm_token=device.fcm_token,
        command_id=cmd.id,
        command_type=cmd.command_type,
        payload=cmd.payload_json or {},
        expires_at_iso=expires_at.isoformat() + "Z",
        ttl_seconds=ttl_seconds,
        device_id=device.id,
    )
    if fcm_result.get("invalid_token"):
        device.fcm_token = ""
    if fcm_result.get("dispatched"):
        cmd.status = "sent"
        cmd.dispatched_at = now

    db.add(
        AuditLog(
            user_id=current_user.id,
            device_id=device.id,
            action=f"COMMAND_ISSUED:{cmd.command_type}",
            actor_type="user",
            ip_address=request.client.host if request.client else "",
            details_json={
                "command_id": cmd.id,
                "ttl_seconds": ttl_seconds,
                "fcm": fcm_result,
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
        fcm_dispatched=bool(fcm_result.get("dispatched")),
    )


@router.get("/devices/{device_id}/commands", response_model=List[CommandResponse])
def list_device_commands(
    device_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    device = _get_owned_device(db, current_user.id, device_id)
    _expire_stale_commands(db, device.id)

    commands = (
        db.query(DeviceCommand)
        .filter(DeviceCommand.device_id == device.id)
        .order_by(DeviceCommand.created_at.desc())
        .limit(50)
        .all()
    )
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
        for c in commands
    ]


@router.get("/audit-logs", response_model=List[AuditLogItem])
def list_audit_logs(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    logs = (
        db.query(AuditLog)
        .filter(AuditLog.user_id == current_user.id)
        .order_by(AuditLog.created_at.desc())
        .limit(100)
        .all()
    )
    return [
        AuditLogItem(
            id=log.id,
            device_id=log.device_id,
            action=log.action,
            actor_type=log.actor_type,
            ip_address=log.ip_address,
            details=log.details_json or {},
            created_at=log.created_at,
        )
        for log in logs
    ]

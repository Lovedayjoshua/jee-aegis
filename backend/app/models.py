import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    JSON,
    String,
    Text,
)
from sqlalchemy.orm import relationship

from .database import Base


def utcnow_naive() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def new_uuid() -> str:
    return str(uuid.uuid4())


class User(Base):
    __tablename__ = "users"

    id = Column(String(36), primary_key=True, default=new_uuid)
    email = Column(String(255), unique=True, index=True, nullable=False)
    full_name = Column(String(255), nullable=False)
    password_hash = Column(Text, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=utcnow_naive, nullable=False)

    devices = relationship("Device", back_populates="owner", cascade="all, delete-orphan")


class Device(Base):
    __tablename__ = "devices"

    id = Column(String(36), primary_key=True, default=new_uuid)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    device_name = Column(String(120), nullable=False)
    manufacturer = Column(String(120), default="", nullable=False)
    model = Column(String(120), default="", nullable=False)
    android_version = Column(String(64), default="", nullable=False)
    app_version = Column(String(32), default="1.0.0", nullable=False)
    fcm_token = Column(Text, default="", nullable=False)
    device_secret_hash = Column(String(128), nullable=False)
    is_revoked = Column(Boolean, default=False, nullable=False)
    last_seen_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=utcnow_naive, nullable=False)

    owner = relationship("User", back_populates="devices")
    telemetry = relationship(
        "DeviceTelemetry",
        back_populates="device",
        cascade="all, delete-orphan",
        order_by="desc(DeviceTelemetry.recorded_at)",
    )
    commands = relationship(
        "DeviceCommand",
        back_populates="device",
        cascade="all, delete-orphan",
        order_by="desc(DeviceCommand.created_at)",
    )


class DeviceTelemetry(Base):
    __tablename__ = "device_telemetry"

    id = Column(String(36), primary_key=True, default=new_uuid)
    device_id = Column(String(36), ForeignKey("devices.id", ondelete="CASCADE"), nullable=False, index=True)
    battery_level = Column(Integer, nullable=True)
    is_charging = Column(Boolean, nullable=True)
    network_type = Column(String(32), default="unknown", nullable=False)
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    location_accuracy_m = Column(Float, nullable=True)
    location_timestamp = Column(DateTime, nullable=True)
    permissions_json = Column(JSON, default=dict, nullable=False)
    torch_on = Column(Boolean, default=False, nullable=False)
    alarm_active = Column(Boolean, default=False, nullable=False)
    camera_assist_active = Column(Boolean, default=False, nullable=False)
    recorded_at = Column(DateTime, default=utcnow_naive, nullable=False, index=True)

    device = relationship("Device", back_populates="telemetry")


class DeviceCommand(Base):
    __tablename__ = "device_commands"

    id = Column(String(36), primary_key=True, default=new_uuid)
    device_id = Column(String(36), ForeignKey("devices.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    command_type = Column(String(64), nullable=False)
    payload_json = Column(JSON, default=dict, nullable=False)
    status = Column(String(32), default="pending", nullable=False, index=True)
    error_message = Column(Text, default="", nullable=False)
    retry_count = Column(Integer, default=0, nullable=False)
    expires_at = Column(DateTime, nullable=False)
    created_at = Column(DateTime, default=utcnow_naive, nullable=False)
    dispatched_at = Column(DateTime, nullable=True)
    acked_at = Column(DateTime, nullable=True)

    device = relationship("Device", back_populates="commands")


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(String(36), primary_key=True, default=new_uuid)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    device_id = Column(String(36), ForeignKey("devices.id", ondelete="SET NULL"), nullable=True)
    action = Column(String(120), nullable=False)
    actor_type = Column(String(32), default="user", nullable=False)
    ip_address = Column(String(64), default="", nullable=False)
    details_json = Column(JSON, default=dict, nullable=False)
    created_at = Column(DateTime, default=utcnow_naive, nullable=False, index=True)

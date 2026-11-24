from datetime import datetime
from typing import Any, Dict, Literal, Optional

from pydantic import BaseModel, EmailStr, Field

AllowedCommandType = Literal[
    "RING_START",
    "RING_STOP",
    "TORCH_ON",
    "TORCH_OFF",
    "LOCATE_NOW",
    "CAMERA_ASSIST_START",
    "CAMERA_ASSIST_STOP",
    "SYNC_STATUS",
]


class UserRegisterRequest(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=2, max_length=120)
    password: str = Field(min_length=8, max_length=128)


class UserLoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class UserPublic(BaseModel):
    id: str
    email: str
    full_name: str
    created_at: datetime
    preferences: Dict[str, Any] = Field(default_factory=dict)


class UserPreferencesUpdateRequest(BaseModel):
    preferences: Dict[str, Any] = Field(default_factory=dict)


class UserPreferencesResponse(BaseModel):
    user_id: str
    preferences: Dict[str, Any] = Field(default_factory=dict)
    updated_at: datetime


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserPublic


class DeviceRegisterRequest(BaseModel):
    device_id: Optional[str] = Field(default=None, max_length=64)
    device_name: str = Field(min_length=1, max_length=120)
    manufacturer: str = Field(default="", max_length=120)
    model: str = Field(default="", max_length=120)
    android_version: str = Field(default="", max_length=64)
    app_version: str = Field(default="1.0.0", max_length=32)
    fcm_token: str = Field(default="", max_length=512)


class DeviceUpdateRequest(BaseModel):
    device_name: str = Field(min_length=1, max_length=120)


class DeviceRegisterResponse(BaseModel):
    device_id: str
    device_secret: str
    device_name: str
    created_at: datetime


class TelemetrySnapshot(BaseModel):
    battery_level: Optional[int] = None
    is_charging: Optional[bool] = None
    network_type: str = "unknown"
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    location_accuracy_m: Optional[float] = None
    location_timestamp: Optional[datetime] = None
    location_freshness: Literal["fresh", "stale", "unavailable"] = "unavailable"
    permissions: Dict[str, Any] = Field(default_factory=dict)
    torch_on: bool = False
    alarm_active: bool = False
    camera_assist_active: bool = False
    recorded_at: Optional[datetime] = None


class DeviceSummary(BaseModel):
    id: str
    device_name: str
    manufacturer: str
    model: str
    android_version: str
    app_version: str
    is_online: bool
    is_revoked: bool
    last_seen_at: Optional[datetime] = None
    created_at: datetime
    telemetry: Optional[TelemetrySnapshot] = None


class CommandCreateRequest(BaseModel):
    command_type: AllowedCommandType
    payload: Dict[str, Any] = Field(default_factory=dict)
    ttl_seconds: Optional[int] = Field(default=None, ge=15, le=86400)


class CommandResponse(BaseModel):
    id: str
    device_id: str
    command_type: str
    payload: Dict[str, Any]
    status: str
    error_message: str
    retry_count: int
    expires_at: datetime
    created_at: datetime
    dispatched_at: Optional[datetime] = None
    acked_at: Optional[datetime] = None
    fcm_dispatched: bool = False


class ConnectorFcmTokenRequest(BaseModel):
    fcm_token: str = Field(min_length=1, max_length=512)


class ConnectorHeartbeatRequest(BaseModel):
    fcm_token: Optional[str] = Field(default=None, max_length=512)
    battery_level: Optional[int] = Field(default=None, ge=0, le=100)
    is_charging: Optional[bool] = None
    network_type: str = Field(default="unknown", max_length=32)
    latitude: Optional[float] = Field(default=None, ge=-90.0, le=90.0)
    longitude: Optional[float] = Field(default=None, ge=-180.0, le=180.0)
    location_accuracy_m: Optional[float] = Field(default=None, ge=0.0)
    location_timestamp: Optional[datetime] = None
    permissions: Dict[str, Any] = Field(default_factory=dict)
    torch_on: bool = False
    alarm_active: bool = False
    camera_assist_active: bool = False


class ConnectorCommandAckRequest(BaseModel):
    status: Literal[
        "retrieved",
        "delivered",
        "executing",
        "completed",
        "executed",
        "acked",
        "failed",
    ]
    error_message: str = Field(default="", max_length=500)
    telemetry: Optional[ConnectorHeartbeatRequest] = None


class AuditLogItem(BaseModel):
    id: str
    device_id: Optional[str] = None
    action: str
    actor_type: str
    ip_address: str
    details: Dict[str, Any]
    created_at: datetime

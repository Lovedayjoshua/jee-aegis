from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from .database import get_db, set_rls_user_context
from .models import AuditLog, User, UserPreference, utcnow_naive
from .rate_limit import limit_auth_requests
from .schemas import (
    AuthResponse,
    UserLoginRequest,
    UserPreferencesResponse,
    UserPreferencesUpdateRequest,
    UserPublic,
    UserRegisterRequest,
)
from .security import (
    create_access_token,
    get_current_user,
    hash_password,
    verify_password,
)

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


def _get_user_prefs_dict(db: Session, user: User) -> dict:
    pref = (
        user.preference
        or db.query(UserPreference).filter(UserPreference.user_id == user.id).first()
    )
    if not pref or not isinstance(pref.preferences_json, dict):
        return {}
    return dict(pref.preferences_json)


def _to_public(db: Session, user: User) -> UserPublic:
    return UserPublic(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        created_at=user.created_at,
        preferences=_get_user_prefs_dict(db, user),
    )


@router.post(
    "/register",
    response_model=AuthResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(limit_auth_requests)],
)
def register(payload: UserRegisterRequest, request: Request, db: Session = Depends(get_db)):
    normalized_email = payload.email.strip().lower()
    existing = db.query(User).filter(User.email == normalized_email).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this email already exists.",
        )

    user = User(
        email=normalized_email,
        full_name=payload.full_name.strip(),
        password_hash=hash_password(payload.password),
    )
    db.add(user)
    db.flush()
    set_rls_user_context(db, user.id)

    db.add(UserPreference(user_id=user.id, preferences_json={}))
    db.add(
        AuditLog(
            user_id=user.id,
            action="USER_REGISTERED",
            actor_type="user",
            ip_address=request.client.host if request.client else "",
            details_json={"email": normalized_email},
        )
    )
    db.commit()
    db.refresh(user)

    token = create_access_token(user.id, user.email)
    return AuthResponse(access_token=token, user=_to_public(db, user))


@router.post(
    "/login",
    response_model=AuthResponse,
    dependencies=[Depends(limit_auth_requests)],
)
def login(payload: UserLoginRequest, request: Request, db: Session = Depends(get_db)):
    normalized_email = payload.email.strip().lower()
    user = db.query(User).filter(User.email == normalized_email).first()
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password.",
        )
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is disabled.",
        )

    set_rls_user_context(db, user.id)
    db.add(
        AuditLog(
            user_id=user.id,
            action="USER_LOGIN",
            actor_type="user",
            ip_address=request.client.host if request.client else "",
            details_json={"email": normalized_email},
        )
    )
    db.commit()
    db.refresh(user)

    token = create_access_token(user.id, user.email)
    return AuthResponse(access_token=token, user=_to_public(db, user))


@router.get("/me", response_model=UserPublic)
def get_me(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return _to_public(db, current_user)


@router.post("/refresh", response_model=AuthResponse)
def refresh_session(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    token = create_access_token(current_user.id, current_user.email)
    return AuthResponse(access_token=token, user=_to_public(db, current_user))


@router.get("/preferences", response_model=UserPreferencesResponse)
def get_preferences(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    pref = (
        db.query(UserPreference)
        .filter(UserPreference.user_id == current_user.id)
        .first()
    )
    if not pref:
        now = utcnow_naive()
        pref = UserPreference(user_id=current_user.id, preferences_json={}, updated_at=now)
        db.add(pref)
        db.commit()
        db.refresh(pref)

    return UserPreferencesResponse(
        user_id=current_user.id,
        preferences=dict(pref.preferences_json or {}),
        updated_at=pref.updated_at,
    )


@router.put("/preferences", response_model=UserPreferencesResponse)
def update_preferences(
    payload: UserPreferencesUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    now = utcnow_naive()
    pref = (
        db.query(UserPreference)
        .filter(UserPreference.user_id == current_user.id)
        .first()
    )
    if not pref:
        pref = UserPreference(
            user_id=current_user.id,
            preferences_json=dict(payload.preferences or {}),
            updated_at=now,
        )
        db.add(pref)
    else:
        merged = dict(pref.preferences_json or {})
        merged.update(payload.preferences or {})
        pref.preferences_json = merged
        pref.updated_at = now

    db.commit()
    db.refresh(pref)

    return UserPreferencesResponse(
        user_id=current_user.id,
        preferences=dict(pref.preferences_json or {}),
        updated_at=pref.updated_at,
    )

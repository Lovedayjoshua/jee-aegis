from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from .database import get_db
from .models import AuditLog, User
from .rate_limit import limit_auth_requests
from .schemas import AuthResponse, UserLoginRequest, UserPublic, UserRegisterRequest
from .security import (
    create_access_token,
    get_current_user,
    hash_password,
    verify_password,
)

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


def _to_public(user: User) -> UserPublic:
    return UserPublic(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        created_at=user.created_at,
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
    return AuthResponse(access_token=token, user=_to_public(user))


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

    token = create_access_token(user.id, user.email)
    return AuthResponse(access_token=token, user=_to_public(user))


@router.get("/me", response_model=UserPublic)
def get_me(current_user: User = Depends(get_current_user)):
    return _to_public(current_user)

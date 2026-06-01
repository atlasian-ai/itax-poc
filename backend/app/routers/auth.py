from __future__ import annotations
from datetime import datetime, timedelta
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from jose import jwt
from app.config import settings

router = APIRouter(prefix="/auth", tags=["auth"])

_ALGORITHM = "HS256"
_TOKEN_EXPIRE_HOURS = 10


class LoginRequest(BaseModel):
    email: str
    password: str


class LoginResponse(BaseModel):
    token: str
    email: str


def create_token(email: str) -> str:
    expire = datetime.utcnow() + timedelta(hours=_TOKEN_EXPIRE_HOURS)
    return jwt.encode({"sub": email, "exp": expire}, settings.jwt_secret, algorithm=_ALGORITHM)


def decode_token(token: str) -> dict:
    return jwt.decode(token, settings.jwt_secret, algorithms=[_ALGORITHM])


@router.post("/login", response_model=LoginResponse)
def login(body: LoginRequest):
    if (
        body.email.lower().strip() != settings.admin_email.lower().strip()
        or body.password != settings.admin_password
    ):
        raise HTTPException(status_code=401, detail="이메일 또는 비밀번호가 올바르지 않습니다")
    return LoginResponse(token=create_token(body.email), email=body.email)


@router.get("/me")
def me():
    """Simple liveness check — actual token validation is done in middleware."""
    return {"email": settings.admin_email}

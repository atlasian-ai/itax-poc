from __future__ import annotations
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from jose import JWTError
from app.config import settings
from app.routers import forms, entries, companies, auth
from app.routers.auth import decode_token

app = FastAPI(title="Korean Tax PoC API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Auth middleware ───────────────────────────────────────────────────────────
_PUBLIC_PATHS = {"/auth/login", "/health", "/docs", "/openapi.json", "/redoc"}

@app.middleware("http")
async def require_auth(request: Request, call_next):
    if request.url.path in _PUBLIC_PATHS or request.method == "OPTIONS":
        return await call_next(request)
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return JSONResponse(status_code=401, content={"detail": "로그인이 필요합니다"})
    try:
        decode_token(auth_header.split(" ", 1)[1])
    except JWTError:
        return JSONResponse(status_code=401, content={"detail": "세션이 만료되었습니다. 다시 로그인해주세요."})
    return await call_next(request)

# ── Routers ───────────────────────────────────────────────────────────────────
app.include_router(auth.router)
app.include_router(forms.router)
app.include_router(entries.router)
app.include_router(companies.router)


@app.get("/health")
def health():
    import sys, app.services.claude_service as cs
    return {
        "status": "ok",
        "python": sys.executable,
        "claude_service": cs.__file__,
        "has_extract_field_objects": hasattr(cs, '_extract_field_objects'),
    }

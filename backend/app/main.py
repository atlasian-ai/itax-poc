from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.routers import forms, entries, companies

app = FastAPI(title="Korean Tax PoC API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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

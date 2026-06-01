from __future__ import annotations
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    anthropic_api_key: str
    supabase_url: str
    supabase_service_role_key: str
    cors_origins: str = "http://localhost:5173"
    # Auth — set these in .env or Azure secrets
    admin_email: str = "admin@itax.com"
    admin_password: str = "changeme"
    jwt_secret: str = "changeme-replace-with-a-long-random-string"

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",")]

    model_config = {"env_file": ".env"}


settings = Settings()

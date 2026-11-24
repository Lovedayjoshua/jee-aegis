from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(".env", "../.env"), extra="ignore")

    app_name: str = "JEE AEGIS Backend"
    database_url: str = "sqlite:///./aegis.db"
    supabase_database_url: str = ""
    supabase_db_url: str = ""
    postgres_url: str = ""
    postgresql_url: str = ""
    jwt_secret: str = "jee-aegis-dev-secret-change-in-production"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 10080
    cors_origins: str = (
        "https://jee-aegis-mv4i-roan.vercel.app,"
        "http://localhost:3000,"
        "http://127.0.0.1:3000"
    )
    device_online_threshold_seconds: int = 90
    location_fresh_threshold_seconds: int = 300
    fcm_server_key: str = ""
    firebase_service_account_json: str = ""

    @model_validator(mode="after")
    def resolve_persistent_database_url(self) -> "Settings":
        # Prefer any configured PostgreSQL/Supabase connection string over the default SQLite fallback
        pg_candidates = [
            self.database_url,
            self.supabase_database_url,
            self.supabase_db_url,
            self.postgres_url,
            self.postgresql_url,
        ]
        for candidate in pg_candidates:
            cleaned = (candidate or "").strip()
            if cleaned.startswith(("postgres://", "postgresql://", "postgresql+")):
                self.database_url = cleaned
                return self

        for candidate in pg_candidates:
            cleaned = (candidate or "").strip()
            if cleaned:
                self.database_url = cleaned
                return self

        self.database_url = "sqlite:///./aegis.db"
        return self


settings = Settings()

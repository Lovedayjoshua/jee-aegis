from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "JEE AEGIS Backend"
    database_url: str = "sqlite:///./aegis.db"
    jwt_secret: str = "jee-aegis-dev-secret-change-in-production"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 1440
    cors_origins: str = (
        "https://jee-aegis-mv4i-roan.vercel.app,"
        "http://localhost:3000,"
        "http://127.0.0.1:3000"
    )
    device_online_threshold_seconds: int = 90
    location_fresh_threshold_seconds: int = 300
    fcm_server_key: str = ""
    firebase_service_account_json: str = ""


settings = Settings()

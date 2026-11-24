from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.orm import Session

from .config import settings
from .database import Base, engine, get_db, is_sqlite
from .routes_auth import router as auth_router
from .routes_connector import router as connector_router
from .routes_devices import router as devices_router


@asynccontextmanager
async def lifespan(_app: FastAPI):
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(
    title=settings.app_name,
    version="1.0.0",
    description="JEE AEGIS Backend API — Account Auth, Device Management, Telemetry & Remote Commands",
    lifespan=lifespan,
)

REQUIRED_ORIGINS = [
    "https://jee-aegis-mv4i-roan.vercel.app",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]
configured_origins = [
    origin.strip().rstrip("/")
    for origin in settings.cors_origins.split(",")
    if origin.strip()
]
origins = list(dict.fromkeys([*REQUIRED_ORIGINS, *configured_origins]))

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_origin_regex=r"^https://jee-aegis[a-zA-Z0-9-]*\.vercel\.app$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(devices_router)
app.include_router(connector_router)


@app.get("/health")
def health_check(db: Session = Depends(get_db)):
    db.execute(text("SELECT 1"))
    return {
        "status": "ok",
        "service": "jee-aegis-backend",
        "database": "connected",
        "engine": "sqlite" if is_sqlite else "postgresql",
        "persistent": not is_sqlite,
    }

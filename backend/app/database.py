from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from .config import settings


def normalize_database_url(url: str) -> str:
    trimmed = url.strip()
    if trimmed.startswith("postgres://"):
        return "postgresql+psycopg2://" + trimmed[len("postgres://") :]
    if trimmed.startswith("postgresql://") and "+psycopg2" not in trimmed:
        return "postgresql+psycopg2://" + trimmed[len("postgresql://") :]
    return trimmed


db_url = normalize_database_url(settings.database_url)
is_sqlite = db_url.startswith("sqlite")
connect_args = {"check_same_thread": False} if is_sqlite else {}

engine = create_engine(
    db_url,
    connect_args=connect_args,
    pool_pre_ping=True,
    **({} if is_sqlite else {"pool_recycle": 300}),
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import settings


def normalize_database_url(url: str) -> str:
    trimmed = (url or "").strip()
    if not trimmed:
        return "sqlite:///./aegis.db"
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


def _apply_postgres_rls_setting(db: Session, clean_uid: str) -> None:
    bind = db.get_bind()
    dialect_name = getattr(getattr(bind, "dialect", None), "name", "")
    if dialect_name == "postgresql":
        db.execute(
            text("SELECT set_config('app.current_user_id', :uid, true)"),
            {"uid": clean_uid},
        )


@event.listens_for(SessionLocal, "after_begin")
def _reapply_rls_on_new_transaction(session: Session, _transaction, _connection) -> None:
    """
    When a request commits a transaction mid-flight (e.g., expiring stale commands or
    committing a row before refreshing it), PostgreSQL resets transaction-local
    `set_config(..., true)` settings. This hook automatically re-applies `app.current_user_id`
    whenever a new transaction begins on the same authenticated session.
    """
    uid = session.info.get("rls_user_id")
    if uid:
        _apply_postgres_rls_setting(session, uid)


def set_rls_user_context(db: Session, user_id: str) -> None:
    """
    Sets the transaction-scoped PostgreSQL `app.current_user_id` setting (`is_local = true`)
    from the verified authenticated user/device identity so PostgreSQL RLS policies
    enforce ownership isolation without leaking across pooled connections.
    Preserves SQLite development compatibility by recording `rls_user_id` in `db.info`.
    """
    clean_uid = str(user_id).strip()
    if not clean_uid:
        return
    db.info["rls_user_id"] = clean_uid
    _apply_postgres_rls_setting(db, clean_uid)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.info.pop("rls_user_id", None)
        db.close()

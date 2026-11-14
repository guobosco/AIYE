"""Non-destructive database startup; migrations are an explicit operation."""
import os
from sqlalchemy import inspect
try:
    from . import models
    from .database import engine, SessionLocal
except ImportError:
    import models
    from database import engine, SessionLocal


def initialize_database():
    models.Base.metadata.create_all(bind=engine)
    inspector = inspect(engine)
    missing = []
    for name, table in models.Base.metadata.tables.items():
        columns = {column["name"] for column in inspector.get_columns(name)}
        missing.extend(f"{name}.{column.name}" for column in table.columns
                       if column.name not in columns)
    if missing:
        raise RuntimeError(
            "Database schema is outdated; back up the database and run "
            "`python -m backend.migrate --apply`. Missing columns: " + ", ".join(missing)
        )
    if os.getenv("LULU_ENABLE_SEED_DATA", "false").lower() == "true":
        try:
            from .seed_data import ensure_seed_data
        except ImportError:
            from seed_data import ensure_seed_data
        with SessionLocal() as db:
            ensure_seed_data(db)

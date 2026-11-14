"""Explicit schema migration. Default invocation only reports differences."""
import argparse
import json
from pathlib import Path
from sqlalchemy import inspect
try:
    from . import models
    from .database import engine
    from .schema_sync import sync_sqlite_schema, DROP_TABLES, DROP_COLUMNS
except ImportError:
    import models
    from database import engine
    from schema_sync import sync_sqlite_schema, DROP_TABLES, DROP_COLUMNS


def schema_report(target_engine=engine):
    sqlite_path = target_engine.url.database
    if target_engine.url.get_backend_name() == "sqlite" and sqlite_path != ":memory:" \
            and sqlite_path and not Path(sqlite_path).exists():
        return {"missing_tables": sorted(models.Base.metadata.tables), "missing_columns": {},
                "legacy_tables": [], "legacy_columns": {}}
    inspector = inspect(target_engine)
    tables = set(inspector.get_table_names())
    missing_columns = {}
    legacy_columns = {}
    for name, table in models.Base.metadata.tables.items():
        if name not in tables:
            continue
        columns = {column["name"] for column in inspector.get_columns(name)}
        missing = sorted(set(table.columns.keys()) - columns)
        if missing:
            missing_columns[name] = missing
        stale = sorted(columns.intersection(DROP_COLUMNS.get(name, set())))
        if stale:
            legacy_columns[name] = stale
    return {
        "missing_tables": sorted(set(models.Base.metadata.tables) - tables),
        "missing_columns": missing_columns,
        "legacy_tables": sorted((tables & DROP_TABLES) - set(models.Base.metadata.tables)),
        "legacy_columns": legacy_columns,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Create tables and add missing columns")
    parser.add_argument("--allow-destructive", action="store_true",
                        help="Also remove legacy tables/columns; back up before using")
    args = parser.parse_args()
    if args.allow_destructive and not args.apply:
        parser.error("--allow-destructive requires --apply and a verified backup")
    report = schema_report()
    if args.apply:
        if engine.url.get_backend_name() != "sqlite" and report["missing_columns"]:
            parser.error("Existing non-SQLite columns require a database-specific migration")
        models.Base.metadata.create_all(bind=engine)
        statements = sync_sqlite_schema(engine, models.Base.metadata,
                                        allow_destructive=args.allow_destructive)
        report = {"before": report, "executed_statements": statements, "after": schema_report()}
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

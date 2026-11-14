from typing import Any

from sqlalchemy import inspect, text
from sqlalchemy.exc import OperationalError


JSON_LIST_DEFAULTS = {
    "users": {"tags", "favorite_service_ids", "favorite_experience_ids", "profile_image_urls"},
    "services": {
        "image_urls",
        "participant_ids",
        "service_declarations_extra",
        "service_feature_tags",
        "service_extra_fee_tags",
    },
    "experiences": {"image_urls", "tags", "detail_steps"},
}

DROP_COLUMNS = {
    "users": {
        "wechat_id",
        "ringtone_uri",
        "role",
        "status",
        "is_deleted",
    },
}

DROP_TABLES = {
    "asset_items",
    "asset_records",
    "countdown_items",
    "database_schema_docs",
    "friend_requests",
    "friendships",
    "focus_configs",
    "groups",
    "focus_records",
    "habit_records",
    "habits",
    "life_progress_configs",
    "memo_notes",
    "menstrual_configs",
    "menstrual_records",
    "quick_reminders",
    "recurring_reminders",
    "reminders",
    "salary_configs",
    "sports_records",
    "task_histories",
    "todo_items",
    "wish_tree_records",
}


def _quoted(name: str) -> str:
    return f'"{name}"'


def _default_sql_literal(table_name: str, column_name: str, column: Any = None):
    if column_name in JSON_LIST_DEFAULTS.get(table_name, set()):
        return "'[]'"
    if column is not None and column.default is not None:
        default_arg = getattr(column.default, "arg", None)
        if callable(default_arg):
            return None
        if isinstance(default_arg, bool):
            return "1" if default_arg else "0"
        if isinstance(default_arg, (int, float)):
            return str(default_arg)
        if isinstance(default_arg, str):
            return "'" + default_arg.replace("'", "''") + "'"
    return None


def _drop_legacy_columns(connection, table_name: str, remove_columns: set[str]):
    # Native DROP COLUMN preserves unrelated indexes/constraints, unlike table rebuilding.
    version = tuple(int(part) for part in connection.exec_driver_sql(
        "SELECT sqlite_version()"
    ).scalar().split("."))
    if version < (3, 35, 0):
        raise RuntimeError("Legacy column cleanup requires SQLite >= 3.35")
    statements = []
    for column_name in sorted(remove_columns):
        statement = f"ALTER TABLE {_quoted(table_name)} DROP COLUMN {_quoted(column_name)};"
        connection.execute(text(statement))
        statements.append(statement)
    return statements


def sync_sqlite_schema(engine, metadata, allow_destructive: bool = False):
    if engine.url.get_backend_name() != "sqlite":
        return []

    executed_statements = []
    with engine.begin() as connection:
        # Explicit BEGIN makes SQLite DDL rollback together if any migration fails.
        connection.exec_driver_sql("BEGIN IMMEDIATE")
        inspector = inspect(connection)
        if allow_destructive:
            for table_name in sorted(DROP_TABLES - set(metadata.tables)):
                if not inspector.has_table(table_name):
                    continue
                statement = f"DROP TABLE {_quoted(table_name)};"
                connection.execute(text(statement))
                executed_statements.append(statement)

        inspector = inspect(connection)
        for table_name, table in metadata.tables.items():
            if not inspector.has_table(table_name):
                continue

            db_columns = {column["name"] for column in inspector.get_columns(table_name)}
            for column in table.columns:
                if column.name in db_columns:
                    continue

                sql_type = engine.dialect.type_compiler.process(column.type)
                statement = (
                    f"ALTER TABLE {_quoted(table_name)} "
                    f"ADD COLUMN {_quoted(column.name)} {sql_type}"
                )
                default_sql = _default_sql_literal(table_name, column.name, column)
                if default_sql is not None:
                    statement = f"{statement} DEFAULT {default_sql}"
                statement = f"{statement};"

                try:
                    connection.execute(text(statement))
                except OperationalError as exc:
                    if "duplicate column name" not in str(exc).lower():
                        raise
                    db_columns.add(column.name)
                else:
                    executed_statements.append(statement)
                    db_columns.add(column.name)

        if allow_destructive:
            inspector = inspect(connection)
            for table_name, removable_columns in DROP_COLUMNS.items():
                if not inspector.has_table(table_name):
                    continue
                db_columns = {column["name"] for column in inspector.get_columns(table_name)}
                stale_columns = db_columns.intersection(removable_columns)
                if not stale_columns:
                    continue
                executed_statements.extend(
                    _drop_legacy_columns(connection, table_name, stale_columns)
                )
                inspector = inspect(connection)

        inspector = inspect(connection)
        for table_name, table in metadata.tables.items():
            if not inspector.has_table(table_name):
                continue

            existing_columns = {column["name"] for column in inspector.get_columns(table_name)}
            for column in table.columns:
                if column.name not in existing_columns:
                    continue
                default_sql = _default_sql_literal(table_name, column.name, column)
                if default_sql is None:
                    continue
                connection.execute(
                    text(
                        f'UPDATE {_quoted(table_name)} '
                        f'SET {_quoted(column.name)} = {default_sql} '
                        f'WHERE {_quoted(column.name)} IS NULL'
                    )
                )

    return executed_statements

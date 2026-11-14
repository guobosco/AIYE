"""Regression coverage for module extraction, migrations, and message retries."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import uuid
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import AsyncMock, patch

try:
    from . import test_account_security as suite
    from . import core, main, models, schema_sync, bootstrap
    from .scripts.repair_chat_media import repair_chat_media
except ImportError:
    import test_account_security as suite
    import core, main, models, schema_sync, bootstrap
    from scripts.repair_chat_media import repair_chat_media
from fastapi.routing import APIRoute, APIWebSocketRoute
from sqlalchemy import create_engine, inspect
from sqlalchemy.exc import OperationalError


class BackendOptimizationTests(unittest.TestCase):
    setUp = suite.AccountSecurityTests.setUp
    send = suite.AccountSecurityTests.send
    login = suite.AccountSecurityTests.login
    private_peer = suite.AccountSecurityTests.private_peer

    @classmethod
    def setUpClass(cls):
        suite.AccountSecurityTests.setUpClass()

    def conversation(self):
        result, headers = self.login()
        peer_id = self.private_peer()
        response = self.client.post("/chat/conversations/direct/" + peer_id, headers=headers)
        self.assertEqual(response.status_code, 200, response.text)
        return result["user"]["id"], peer_id, response.json()["conversation"]["id"], headers

    def test_route_addresses_and_methods_are_unchanged(self):
        routes = []
        for route in main.app.routes:
            if isinstance(route, APIRoute):
                routes.extend((route.path, method.lower()) for method in route.methods)
            elif isinstance(route, APIWebSocketRoute):
                routes.append((route.path, "websocket"))
        self.assertEqual(len(routes), 69)
        digest = hashlib.sha256(json.dumps(sorted(routes)).encode()).hexdigest()
        self.assertEqual(digest, "13a9ddf8ce5bfa3ad30dd721fb5f503e62094d42744b45e0fab9bc3db53383b1")

    def test_repeated_message_is_saved_and_published_once(self):
        owner, peer, conversation, headers = self.conversation()
        path = f"/chat/conversations/{conversation}/messages"
        body = {"content": "same request", "client_message_id": uuid.uuid4().hex}
        with patch.object(core.chat_hub, "publish_to_users", new_callable=AsyncMock) as publish:
            first = self.client.post(path, json=body, headers=headers)
            second = self.client.post(path, json=body, headers=headers)
        self.assertEqual(first.status_code, 200, first.text)
        self.assertEqual(second.json(), first.json())
        publish.assert_awaited_once()
        changed = self.client.post(path, json={**body, "content": "different"}, headers=headers)
        self.assertEqual(changed.status_code, 409)
        with core.SessionLocal() as db:
            self.assertEqual(db.query(models.ChatMessage).filter_by(conversation_id=conversation).count(), 1)
            self.assertEqual(db.query(models.ConversationMember).filter_by(
                conversation_id=conversation, user_id=peer).one().unread_count, 1)

    def test_concurrent_retries_and_distinct_messages_keep_unread_counts(self):
        owner, peer, conversation, headers = self.conversation()
        path = f"/chat/conversations/{conversation}/messages"
        body = {"content": "concurrent", "client_message_id": uuid.uuid4().hex}
        with patch.object(core.chat_hub, "publish_to_users", new_callable=AsyncMock) as publish:
            with ThreadPoolExecutor(max_workers=4) as pool:
                results = list(pool.map(lambda _: self.client.post(path, headers=headers, json=body), range(4)))
            for response in results:
                self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(len({response.json()["id"] for response in results}), 1)
            publish.assert_awaited_once()
            with ThreadPoolExecutor(max_workers=4) as pool:
                results = list(pool.map(lambda _: self.client.post(path, headers=headers, json={
                    "content": "distinct", "client_message_id": uuid.uuid4().hex,
                }), range(4)))
            for response in results:
                self.assertEqual(response.status_code, 200, response.text)
        with core.SessionLocal() as db:
            self.assertEqual(db.query(models.ChatMessage).filter_by(conversation_id=conversation).count(), 5)
            self.assertEqual(db.query(models.ConversationMember).filter_by(
                conversation_id=conversation, user_id=peer).one().unread_count, 5)
            timestamps = [item.created_at for item in db.query(models.ChatMessage).filter_by(
                conversation_id=conversation).all()]
            self.assertEqual(len(set(timestamps)), 5)

    def test_message_keys_are_sender_scoped_and_optional_for_old_clients(self):
        owner, peer, conversation, headers = self.conversation()
        path = f"/chat/conversations/{conversation}/messages"
        body = {"content": "same key", "client_message_id": "shared-key"}
        first = self.client.post(path, json=body, headers=headers)
        with core.SessionLocal() as db:
            tokens = suite.accounts.issue_session(db, db.get(models.User, peer))
        second = self.client.post(path, json=body, headers={
            "Authorization": "Bearer " + tokens["access_token"],
        })
        self.assertEqual(second.status_code, 200, second.text)
        self.assertNotEqual(first.json()["id"], second.json()["id"])
        legacy = [self.client.post(path, json={"content": "no key"}, headers=headers) for _ in range(2)]
        self.assertNotEqual(legacy[0].json()["id"], legacy[1].json()["id"])

    def test_legacy_random_message_id_is_reused_without_data_rewrite(self):
        owner, peer, conversation, headers = self.conversation()
        old_id = str(uuid.uuid4())
        body = {"content": "legacy", "client_message_id": "legacy-key"}
        with core.SessionLocal() as db:
            db.add(models.ChatMessage(id=old_id, sender_id=owner, conversation_id=conversation,
                                      **body, created_at=1, updated_at=1))
            db.commit()
        response = self.client.post(f"/chat/conversations/{conversation}/messages",
                                    json=body, headers=headers)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["id"], old_id)

    def test_saved_message_remains_successful_when_realtime_delivery_fails(self):
        owner, peer, conversation, headers = self.conversation()
        with patch.object(core.chat_hub, "publish_to_users", new_callable=AsyncMock,
                          side_effect=RuntimeError("redis unavailable")), self.assertLogs("aiye.backend"):
            response = self.client.post(f"/chat/conversations/{conversation}/messages",
                                        json={"content": "persisted"}, headers=headers)
        self.assertEqual(response.status_code, 200, response.text)
        fetched = self.client.get(f"/chat/conversations/{conversation}/messages", headers=headers)
        self.assertEqual(fetched.json()[0]["id"], response.json()["id"])

    def test_pagination_bounds_order_and_ownership(self):
        owner, peer, conversation, headers = self.conversation()
        with core.SessionLocal() as db:
            for number in range(3):
                db.add(models.Feedback(id=uuid.uuid4().hex, user_id=owner, content=str(number),
                                       created_at=number + 1, updated_at=number + 1))
            for _ in range(104):
                conversation_id = uuid.uuid4().hex
                db.add(models.Conversation(id=conversation_id, type="group", participant_ids=[owner]))
                db.add(models.ConversationMember(id=uuid.uuid4().hex, conversation_id=conversation_id,
                                                user_id=owner))
            db.commit()
        first_page = self.client.get("/chat/conversations", headers=headers).json()
        second_page = self.client.get("/chat/conversations?skip=100", headers=headers).json()
        self.assertEqual(len(first_page), 100)
        self.assertEqual(len(second_page), 5)
        self.assertEqual(len({item["conversation"]["id"] for item in first_page + second_page}), 105)
        response = self.client.get("/me/feedbacks?skip=1&limit=1", headers=headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()[0]["content"], "1")
        for path in ["/services/", "/experiences/", "/me/feedbacks", "/chat/conversations"]:
            for query in ["skip=-1", "limit=0", "limit=201"]:
                response = self.client.get(path + "?" + query, headers=headers)
                self.assertEqual(response.status_code, 422, response.text)
        self.assertEqual(self.client.get("/services/?user_id=" + peer, headers=headers).status_code, 403)
        self.assertEqual(self.client.get(f"/chat/conversations/{conversation}/messages?before=-1",
                                        headers=headers).status_code, 422)

    def test_read_marker_rejects_message_from_another_conversation(self):
        owner, peer, conversation, headers = self.conversation()
        other_peer = self.private_peer()
        other = self.client.post("/chat/conversations/direct/" + other_peer, headers=headers).json()
        other_id = other["conversation"]["id"]
        message = self.client.post(f"/chat/conversations/{other_id}/messages",
                                   json={"content": "other conversation"}, headers=headers).json()
        response = self.client.post(f"/chat/conversations/{conversation}/read", headers=headers,
                                    json={"message_id": message["id"]})
        self.assertEqual(response.status_code, 404)

    def test_database_error_is_redacted_and_transaction_is_rolled_back(self):
        result, headers = self.login()
        error = OperationalError("PRIVATE SQL", {"credential": "PRIVATE TOKEN"}, RuntimeError("PRIVATE PATH"))
        with patch("sqlalchemy.orm.Session.commit", side_effect=error), self.assertLogs("aiye.backend"):
            response = self.client.put("/users/" + result["user"]["id"], headers=headers,
                                       json={"name": "should roll back"})
        self.assertEqual(response.status_code, 500)
        self.assertNotIn("PRIVATE", response.text)
        with core.SessionLocal() as db:
            self.assertNotEqual(db.get(models.User, result["user"]["id"]).name, "should roll back")

    def test_media_repair_is_dry_run_and_only_fixes_verified_local_files(self):
        owner, peer, conversation, headers = self.conversation()
        with tempfile.TemporaryDirectory(prefix="aiye-media-repair-") as directory:
            folder = Path(directory) / "chat" / owner
            folder.mkdir(parents=True)
            (folder / "exists.txt").write_bytes(b"attachment")
            records = [
                (uuid.uuid4().hex, "static/chat/exists.txt"),
                (uuid.uuid4().hex, "static/chat/missing.txt"),
                (uuid.uuid4().hex, "https://example.com/static/chat/exists.txt"),
                (uuid.uuid4().hex, "static/chat/%2e%2e"),
            ]
            with core.SessionLocal() as db:
                for message_id, url in records:
                    db.add(models.ChatMessage(id=message_id, sender_id=owner,
                                              conversation_id=conversation, attachment_url=url))
                db.commit()
                report = repair_chat_media(db, directory)
                self.assertEqual(len(report["repairable"]), 1)
                self.assertEqual(report["applied"], 0)
                self.assertEqual(db.get(models.ChatMessage, records[0][0]).attachment_url, records[0][1])
                report = repair_chat_media(db, directory, apply=True)
                self.assertEqual(report["applied"], 1)
                self.assertEqual(db.get(models.ChatMessage, records[0][0]).attachment_url,
                                 f"static/chat/{owner}/exists.txt")
                for message_id, url in records[1:]:
                    self.assertEqual(db.get(models.ChatMessage, message_id).attachment_url, url)
                self.assertEqual(repair_chat_media(db, directory, apply=True)["applied"], 0)

    def test_import_has_no_database_or_media_side_effects(self):
        with tempfile.TemporaryDirectory(prefix="aiye-import-test-") as directory:
            env = os.environ.copy()
            path = Path(directory) / "not-created.db"
            media = Path(directory) / "not-created-media"
            env.update(LULU_DB_PATH=str(path), LULU_DATABASE_URL="sqlite:///" + str(path),
                       LULU_STATIC_DIR=str(media))
            subprocess.check_call([sys.executable, "-B", "-c", "import backend.main"], env=env)
            self.assertFalse(path.exists())
            self.assertFalse(media.exists())
            output = subprocess.check_output([sys.executable, "-B", "-m", "backend.migrate"],
                                              env=env, text=True)
            self.assertTrue(json.loads(output)["missing_tables"])
            self.assertFalse(path.exists())

    def test_migration_defaults_preserve_legacy_data_and_unique_indexes(self):
        with tempfile.TemporaryDirectory(prefix="aiye-migration-") as directory:
            target = create_engine("sqlite:///" + str(Path(directory) / "migration.db"))
            try:
                models.Base.metadata.create_all(target)
                with target.begin() as connection:
                    connection.exec_driver_sql("CREATE TABLE todo_items (id TEXT, content TEXT)")
                    connection.exec_driver_sql("INSERT INTO todo_items VALUES ('1', 'keep')")
                    connection.exec_driver_sql("ALTER TABLE users ADD COLUMN wechat_id TEXT")
                schema_sync.sync_sqlite_schema(target, models.Base.metadata)
                self.assertTrue(inspect(target).has_table("todo_items"))
                self.assertIn("wechat_id", {column["name"] for column in inspect(target).get_columns("users")})
                with patch.object(bootstrap, "engine", target):
                    bootstrap.initialize_database()
                self.assertTrue(inspect(target).has_table("todo_items"))
                schema_sync.sync_sqlite_schema(target, models.Base.metadata, allow_destructive=True)
                self.assertFalse(inspect(target).has_table("todo_items"))
                self.assertNotIn("wechat_id", {column["name"] for column in inspect(target).get_columns("users")})
                self.assertTrue(any(index["unique"] and "pei_pei_id" in index["column_names"]
                                    for index in inspect(target).get_indexes("users")))
            finally:
                target.dispose()

    def test_failed_destructive_migration_rolls_back_all_changes(self):
        with tempfile.TemporaryDirectory(prefix="aiye-migration-rollback-") as directory:
            target = create_engine("sqlite:///" + str(Path(directory) / "migration.db"))
            try:
                models.Base.metadata.create_all(target)
                with target.begin() as connection:
                    connection.exec_driver_sql("CREATE TABLE todo_items (id TEXT)")
                    connection.exec_driver_sql("ALTER TABLE users ADD COLUMN wechat_id TEXT")
                    connection.exec_driver_sql("CREATE INDEX old_wechat_index ON users(wechat_id)")
                with self.assertRaises(OperationalError):
                    schema_sync.sync_sqlite_schema(target, models.Base.metadata, allow_destructive=True)
                self.assertTrue(inspect(target).has_table("todo_items"))
                self.assertIn("wechat_id", {column["name"] for column in inspect(target).get_columns("users")})
            finally:
                target.dispose()


if __name__ == "__main__":
    unittest.main()

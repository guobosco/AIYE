"""Isolated account contract tests; never use the workspace business database."""

import os
import io
import json
import subprocess
import sys
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest.mock import AsyncMock, patch

_database = tempfile.TemporaryDirectory(prefix="aiye-account-tests-")
os.environ["LULU_DB_PATH"] = os.path.join(_database.name, "accounts.db")
os.environ["LULU_DATABASE_URL"] = "sqlite:///" + os.environ["LULU_DB_PATH"]
os.environ["LULU_STATIC_DIR"] = os.path.join(_database.name, "static")
os.environ["LULU_ENABLE_SEED_DATA"] = "false"
os.environ["LULU_ENV"] = "development"
os.environ["LULU_SECRET_KEY"] = "isolated-test-key-not-for-deployment"
os.environ["LULU_ENABLE_DEBUG_PHONE_CODES"] = "true"

from fastapi.testclient import TestClient
from fastapi import UploadFile
from sqlalchemy import event
try:
    from . import main, core, bootstrap, database, models, account_security as accounts
except ImportError:
    import main, core, bootstrap, database, models, account_security as accounts


class AccountSecurityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        bootstrap.initialize_database()
        os.makedirs(core.STATIC_DIR, exist_ok=True)

    def setUp(self):
        with core.SessionLocal() as db:
            db.query(models.AuthRateLimit).delete()
            db.commit()
        self.client = TestClient(main.app)
        self.phone = "199" + str(uuid.uuid4().int % 100000000).zfill(8)

    def send(self, number, scene, headers=None):
        response = self.client.post("/auth/phone/send-code", json={
            "phone_number": number, "scene": scene,
        }, headers=headers)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()["debug_code"]

    def login(self, number=None):
        number = number or self.phone
        code = self.send(number, "login")
        response = self.client.post("/auth/phone/login", json={
            "phone_number": number, "verify_code": code,
        })
        self.assertEqual(response.status_code, 200, response.text)
        result = response.json()
        return result, {"Authorization": "Bearer " + result["access_token"]}

    def test_profile_cannot_change_verified_identity_or_metrics(self):
        result, headers = self.login()
        user = result["user"]
        response = self.client.put("/users/" + user["id"], headers=headers, json={
            "name": "New name", "phone_number": "13800000000",
            "is_phone_verified": False, "identity_verified": True,
            "wechat_openid": "forged", "average_rating": 5,
            "review_count": 100, "created_at": 0,
        })
        self.assertEqual(response.status_code, 200, response.text)
        updated = response.json()
        self.assertEqual(updated["name"], "New name")
        self.assertEqual(updated["phone_number"], self.phone)
        self.assertTrue(updated["is_phone_verified"])
        self.assertFalse(updated["identity_verified"])
        self.assertNotEqual(updated["wechat_openid"], "forged")
        self.assertEqual(updated["review_count"], 0)

    def test_code_single_use_and_scene_separation(self):
        code = self.send(self.phone, "register")
        wrong_scene = self.client.post("/auth/phone/login", json={
            "phone_number": self.phone, "verify_code": code,
        })
        self.assertEqual(wrong_scene.status_code, 400)
        data = dict(id="client-chosen-id", phone_number=self.phone, password="safe+&password",
                    verify_code=code, identity_verified=True, review_count=99)
        response = self.client.post("/users/register", json=data)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertNotEqual(response.json()["id"], data["id"])
        self.assertFalse(response.json()["identity_verified"])
        self.assertEqual(response.json()["review_count"], 0)
        self.assertEqual(self.client.post("/users/register", json=data).status_code, 400)
        token = self.client.post("/auth/token", data={
            "username": self.phone, "password": data["password"],
        })
        self.assertEqual(token.status_code, 200, token.text)
        self.assertTrue(token.json()["refresh_token"])

    def test_code_failed_attempt_limit_and_cooldown(self):
        code = self.send(self.phone, "login")
        response = self.client.post("/auth/phone/send-code", json={
            "phone_number": self.phone, "scene": "login",
        })
        self.assertEqual(response.status_code, 429)
        wrong = "000000" if code != "000000" else "111111"
        for _ in range(5):
            self.assertEqual(self.client.post("/auth/phone/login", json={
                "phone_number": self.phone, "verify_code": wrong,
            }).status_code, 400)
        self.assertEqual(self.client.post("/auth/phone/login", json={
            "phone_number": self.phone, "verify_code": code,
        }).status_code, 400)

    def test_refresh_rotation_logout_and_replay(self):
        result, headers = self.login()
        response = self.client.post("/auth/refresh", json={"refresh_token": result["refresh_token"]})
        self.assertEqual(response.status_code, 200)
        rotated = response.json()
        self.assertNotEqual(rotated["refresh_token"], result["refresh_token"])
        self.assertEqual(self.client.get("/auth/me", headers=headers).status_code, 200)
        self.assertEqual(self.client.post("/auth/refresh", json={
            "refresh_token": result["refresh_token"],
        }).status_code, 401)
        self.assertEqual(self.client.get("/auth/me", headers=headers).status_code, 401)
        self.assertEqual(self.client.post("/auth/refresh", json={
            "refresh_token": rotated["refresh_token"],
        }).status_code, 401)

    def test_logout_all_revokes_multiple_devices(self):
        result, headers = self.login()
        with core.SessionLocal() as db:
            other = accounts.issue_session(db, db.get(models.User, result["user"]["id"]))
        response = self.client.post("/auth/logout-all", headers=headers)
        self.assertEqual(response.status_code, 200)
        for token in [result["access_token"], other["access_token"]]:
            self.assertEqual(self.client.get("/auth/me", headers={
                "Authorization": "Bearer " + token,
            }).status_code, 401)

    def test_legacy_unbounded_token_rejected(self):
        result, _ = self.login()
        legacy = core.create_access_token({"sub": result["user"]["id"]})
        response = self.client.get("/auth/me", headers={"Authorization": "Bearer " + legacy})
        self.assertEqual(response.status_code, 401)

    def test_wechat_debug_rejected_and_unbound_business_restricted(self):
        response = self.client.post("/auth/wechat/mobile/login", json={
            "code": "debug_wechat_anything", "state": "state", "platform": "android",
        })
        self.assertEqual(response.status_code, 400)
        with patch.object(core, "exchange_wechat_mobile_code", return_value={
            "openid": uuid.uuid4().hex, "unionid": None, "nickname": "",
        }):
            result = self.client.post("/auth/wechat/mobile/login", json={
                "code": "provider-verified-in-test", "state": "state", "platform": "android",
            })
        self.assertEqual(result.status_code, 200, result.text)
        session = result.json()
        headers = {"Authorization": "Bearer " + session["access_token"]}
        self.assertTrue(session["need_bind_phone"])
        self.assertEqual(self.client.get("/auth/me", headers=headers).status_code, 200)
        self.assertEqual(self.client.get("/chat/conversations", headers=headers).status_code, 403)
        code = self.send(self.phone, "bind_wechat_phone", headers)
        bound = self.client.post("/auth/wechat/bind-phone", headers=headers, json={
            "phone_number": self.phone, "verify_code": code,
        })
        self.assertEqual(bound.status_code, 200, bound.text)
        self.assertEqual(self.client.get("/chat/conversations", headers=headers).status_code, 200)

    def test_miniapp_provider_scope_and_account_reuse(self):
        openid = uuid.uuid4().hex
        with patch.object(accounts, "exchange_miniapp_code", return_value=("test-mini-app", {
            "openid": openid,
        })):
            responses = [self.client.post("/auth/wechat/miniapp/login", json={
                "code": "verified-provider-code",
            }) for _ in range(2)]
        for response in responses:
            self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(responses[0].json()["user"]["id"], responses[1].json()["user"]["id"])

    def test_one_key_uses_provider_phone_not_client_identity(self):
        with patch.object(accounts, "aliyun_rpc", return_value={
            "Code": "OK", "GetMobileResultDTO": {"Mobile": self.phone},
        }) as provider:
            result = self.client.post("/auth/phone/one-key/login", json={
                "access_token": "operator-sdk-token", "phone_number": "13800000000",
            })
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(result.json()["user"]["phone_number"], self.phone)
        self.assertTrue(result.json()["user"]["is_phone_verified"])
        self.assertEqual(provider.call_args.args[3], {"AccessToken": "operator-sdk-token"})

    def test_one_key_without_credentials_fails_closed(self):
        with patch.dict(os.environ, {"LULU_ALIYUN_ACCESS_KEY_ID": "",
                                     "LULU_ALIYUN_ACCESS_KEY_SECRET": ""}):
            result = self.client.post("/auth/phone/one-key/login", json={
                "access_token": "unverified-token",
            })
        self.assertEqual(result.status_code, 503)

    def test_websocket_closes_after_session_revocation(self):
        result, headers = self.login()
        with self.client.websocket_connect("/ws/chat?token=" + result["access_token"]) as ws:
            self.assertEqual(ws.receive_json()["type"], "connected")
            ws.send_json({"type": "ping"})
            self.assertEqual(ws.receive_json()["type"], "pong")
            self.assertEqual(self.client.post("/auth/logout", headers=headers).status_code, 200)
            ws.send_json({"type": "ping"})
            event = ws.receive()
            if event["type"] == "websocket.send":
                event = ws.receive()
            self.assertEqual(event["type"], "websocket.close")
            self.assertEqual(event["code"], 4401)

    def test_missing_sms_configuration_is_not_fake_success(self):
        with patch.dict(os.environ, {"LULU_ENABLE_DEBUG_PHONE_CODES": "false",
                                     "LULU_SMS_SIGN_NAME": "", "LULU_SMS_TEMPLATE_CODE": ""}):
            result = self.client.post("/auth/phone/send-code", json={
                "phone_number": self.phone, "scene": "login",
            })
        self.assertEqual(result.status_code, 503)
        self.assertNotIn("debug_code", result.json())

    def test_production_never_returns_debug_code(self):
        with patch.dict(os.environ, {"LULU_ENV": "production",
                                     "LULU_ENABLE_DEBUG_PHONE_CODES": "true",
                                     "LULU_SMS_SIGN_NAME": "test-sign",
                                     "LULU_SMS_TEMPLATE_CODE": "test-template"}), \
                patch.object(accounts, "aliyun_rpc", return_value={"Code": "OK"}):
            result = self.client.post("/auth/phone/send-code", json={
                "phone_number": self.phone, "scene": "login",
            })
        self.assertEqual(result.status_code, 200, result.text)
        self.assertIsNone(result.json()["debug_code"])

    def test_expired_code_rejected(self):
        code = self.send(self.phone, "login")
        key = accounts.digest(f"phone:{self.phone}:login:")
        with core.SessionLocal() as db:
            db.get(models.PhoneChallenge, key).expires_at = 0
            db.commit()
        result = self.client.post("/auth/phone/login", json={
            "phone_number": self.phone, "verify_code": code,
        })
        self.assertEqual(result.status_code, 400)

    def test_binding_challenge_is_account_scoped_and_no_account_overwrite(self):
        existing, _ = self.login()
        headers = []
        for _ in range(2):
            with patch.object(core, "exchange_wechat_mobile_code", return_value={
                "openid": uuid.uuid4().hex, "unionid": None, "nickname": "",
            }):
                result = self.client.post("/auth/wechat/mobile/login", json={
                    "code": "verified-code", "state": "state", "platform": "ios",
                })
                self.assertEqual(result.status_code, 200, result.text)
                headers.append({"Authorization": "Bearer " + result.json()["access_token"]})
        code = self.send(self.phone, "bind_wechat_phone", headers[0])
        payload = {"phone_number": self.phone, "verify_code": code}
        self.assertEqual(self.client.post("/auth/wechat/bind-phone", json=payload,
                                         headers=headers[1]).status_code, 400)
        self.assertEqual(self.client.post("/auth/wechat/bind-phone", json=payload,
                                         headers=headers[0]).status_code, 409)
        with core.SessionLocal() as db:
            identity = accounts.verified_identity(db, "phone", self.phone)
            self.assertEqual(identity.user_id, existing["user"]["id"])

    def private_peer(self):
        with core.SessionLocal() as db:
            user = models.User(
                id=uuid.uuid4().hex, name="Visible name", pei_pei_id=uuid.uuid4().hex,
                phone_number=self.phone, email=uuid.uuid4().hex + "@example.com",
                wechat_openid="private-openid", wechat_unionid="private-unionid",
                address_detail="Private address", address_recipient_name="Private recipient",
                address_phone_number="13800000000", memo="Private memo",
                favorite_service_ids=["private-favorite"], favorite_experience_ids=["private-experience"],
                height_cm=175, weight_kg=65.5, height_weight_private=True,
                created_at=accounts.millis(), updated_at=accounts.millis(),
                is_phone_verified=True,
            )
            db.add(user)
            db.commit()
            return user.id

    def assert_private_fields_hidden(self, user):
        self.assertEqual(user["phone_number"], "")
        self.assertIsNone(user["email"])
        self.assertIsNone(user["wechat_openid"])
        self.assertIsNone(user["wechat_unionid"])
        self.assertEqual(user["address_detail"], "")
        self.assertEqual(user["address_recipient_name"], "")
        self.assertEqual(user["address_phone_number"], "")
        self.assertEqual(user["memo"], "")
        self.assertEqual(user["favorite_service_ids"], [])
        self.assertEqual(user["favorite_experience_ids"], [])
        self.assertEqual(user["height_cm"], 0)
        self.assertEqual(user["weight_kg"], 0)

    def test_discovery_route_is_reachable_and_validated(self):
        result, headers = self.login()
        peer_id = self.private_peer()
        response = self.client.get("/users/discovery?limit=100", headers=headers)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertNotIn(result["user"]["id"], [user["id"] for user in response.json()])
        peer = next(user for user in response.json() if user["id"] == peer_id)
        self.assert_private_fields_hidden(peer)
        self.assertEqual(self.client.get("/users/discovery").status_code, 401)
        for limit in [0, 101]:
            self.assertEqual(self.client.get("/users/discovery?limit=" + str(limit),
                                             headers=headers).status_code, 422)

    def test_public_profile_hides_private_fields_but_self_keeps_them(self):
        peer_id = self.private_peer()
        public = self.client.get("/users/" + peer_id)
        self.assertEqual(public.status_code, 200, public.text)
        self.assertEqual(public.json()["name"], "Visible name")
        self.assert_private_fields_hidden(public.json())
        with core.SessionLocal() as db:
            tokens = accounts.issue_session(db, db.get(models.User, peer_id))
        own = self.client.get("/users/" + peer_id, headers={
            "Authorization": "Bearer " + tokens["access_token"],
        })
        self.assertEqual(own.json()["phone_number"], self.phone)
        self.assertEqual(own.json()["address_detail"], "Private address")
        self.assertEqual(own.json()["height_cm"], 175)
        self.assertEqual(own.json()["favorite_service_ids"], ["private-favorite"])
        with core.SessionLocal() as db:
            self.assertEqual(db.get(models.User, peer_id).wechat_openid, "private-openid")

    def test_contact_matching_preserves_only_supplied_phone(self):
        _, headers = self.login()
        peer_id = self.private_peer()
        response = self.client.post("/users/match_contacts", headers=headers, json={
            "phone_numbers": [self.phone],
        })
        self.assertEqual(response.status_code, 200, response.text)
        peer = next(user for user in response.json() if user["id"] == peer_id)
        self.assertEqual(peer["phone_number"], self.phone)
        self.assertEqual(peer["address_detail"], "")
        self.assertIsNone(peer["wechat_openid"])
        searched = self.client.get("/users/search", params={"query": self.phone}, headers=headers)
        self.assertEqual(searched.status_code, 200, searched.text)
        self.assertEqual(searched.json()["phone_number"], self.phone)
        with core.SessionLocal() as db:
            handle = db.get(models.User, peer_id).pei_pei_id
        by_handle = self.client.get("/users/search", params={"query": handle}, headers=headers)
        self.assertEqual(by_handle.status_code, 200)
        self.assertEqual(by_handle.json()["phone_number"], "")

    def test_chat_upload_url_matches_storage_and_download(self):
        result, headers = self.login()
        for path in ["/chat/upload", "/media/upload?biz=chat"]:
            content = b"chat attachment bytes"
            response = self.client.post(path, headers=headers, files={
                "file": ("attachment.txt", content, "text/plain"),
            })
            self.assertEqual(response.status_code, 200, response.text)
            uploaded = response.json()
            self.assertTrue(uploaded["object_key"].startswith("chat/" + result["user"]["id"] + "/"))
            downloaded = self.client.get("/" + uploaded["url"])
            self.assertEqual(downloaded.status_code, 200, downloaded.text)
            self.assertEqual(downloaded.content, content)

    def test_all_media_businesses_and_legacy_endpoints_download(self):
        _, headers = self.login()
        content = b"test-image-bytes"
        for path in [
            "/upload/avatar", "/service/upload", "/experience/upload",
            "/media/upload?biz=avatar", "/media/upload?biz=service",
            "/media/upload?biz=experience",
        ]:
            response = self.client.post(path, headers=headers, files={
                "file": ("picture.png", content, "image/png"),
            })
            self.assertEqual(response.status_code, 200, response.text)
            downloaded = self.client.get("/" + response.json()["url"])
            self.assertEqual(downloaded.status_code, 200)
            self.assertEqual(downloaded.content, content)
        self.assertEqual(self.client.post("/media/upload?biz=invalid", headers=headers,
                                         files={"file": ("x.txt", b"x", "text/plain")}).status_code, 422)
        self.assertEqual(self.client.post("/upload/avatar", headers=headers,
                                         files={"file": ("x.txt", b"x", "text/plain")}).status_code, 400)

    def test_upload_rejects_empty_oversize_and_cleans_partial_files(self):
        _, headers = self.login()
        before = set(Path(core.STATIC_DIR).rglob("*.*"))
        with patch.object(core, "MAX_UPLOAD_SIZE_BYTES", 4):
            for data, status in [(b"", 400), (b"12345", 413)]:
                response = self.client.post("/chat/upload", headers=headers, files={
                    "file": ("file.txt", data, "text/plain"),
                })
                self.assertEqual(response.status_code, status, response.text)
        self.assertEqual(set(Path(core.STATIC_DIR).rglob("*.*")), before)
        path = os.path.join(_database.name, "broken-upload.bin")
        class BrokenFile:
            def read(self, size):
                raise OSError("simulated read failure")
        upload = UploadFile(file=BrokenFile(), filename="broken.bin")
        with self.assertRaises(OSError):
            core._save_upload_file_with_limit(upload, path, 4)
        self.assertFalse(os.path.exists(path))

    def test_upload_filename_cannot_create_path_components(self):
        for filename in ["photo.png/../../evil", "photo.html\\evil", "photo." + "a" * 100]:
            upload = UploadFile(file=io.BytesIO(b"x"), filename=filename)
            generated = core._build_upload_filename("safe-user", upload)
            self.assertEqual(os.path.basename(generated), generated)
            self.assertNotIn("\\", generated)
            self.assertTrue(generated.endswith(".bin"))

    def test_admin_without_credentials_fails_closed(self):
        with patch.object(core, "ADMIN_TOKEN", ""), patch.object(core, "ADMIN_PASSWORD", ""):
            response = self.client.get("/admin/api/overview")
        self.assertEqual(response.status_code, 503)

    def test_lifespan_starts_and_closes_realtime_hub(self):
        with patch.object(core.chat_hub, "startup", new_callable=AsyncMock) as startup, \
                patch.object(core.chat_hub, "shutdown", new_callable=AsyncMock) as shutdown:
            with TestClient(main.app) as client:
                self.assertEqual(client.get("/healthz").status_code, 200)
                startup.assert_awaited_once()
                shutdown.assert_not_awaited()
            shutdown.assert_awaited_once()

    def test_admin_token_password_and_expiry_contract(self):
        with patch.object(core, "ADMIN_TOKEN", "configured-admin-token"), \
                patch.object(core, "ADMIN_PASSWORD", "configured-password"):
            self.assertEqual(self.client.get("/admin/api/users").status_code, 403)
            self.assertEqual(self.client.get("/admin/api/users", headers={
                "X-Admin-Token": "configured-admin-token",
            }).status_code, 200)
            login = self.client.post("/admin/api/auth/login", json={
                "username": core.ADMIN_USERNAME, "password": "configured-password",
            })
            self.assertEqual(login.status_code, 200, login.text)
            self.assertEqual(self.client.get("/admin/api/users", headers={
                "X-Admin-Token": login.json()["token"],
            }).status_code, 200)
            unbounded = core.jwt.encode({"sub": "admin", "scope": "admin"},
                                        core.SECRET_KEY, algorithm=core.ALGORITHM)
            self.assertEqual(self.client.get("/admin/api/users", headers={
                "X-Admin-Token": unbounded,
            }).status_code, 403)
            result, _ = self.login()
            self.assertEqual(self.client.get("/admin/api/users", headers={
                "X-Admin-Token": result["access_token"],
            }).status_code, 403)

    def test_conversation_reuse_privacy_and_constant_query_count(self):
        result, headers = self.login()
        owner_id = result["user"]["id"]
        peer_id = self.private_peer()
        first = self.client.post("/chat/conversations/direct/" + peer_id, headers=headers)
        second = self.client.post("/chat/conversations/direct/" + peer_id, headers=headers)
        self.assertEqual(first.status_code, 200, first.text)
        self.assertEqual(first.json()["conversation"]["id"], second.json()["conversation"]["id"])
        self.assert_private_fields_hidden(first.json()["peer"])
        self.assertEqual(self.client.post("/chat/conversations/direct/" + owner_id,
                                         headers=headers).status_code, 400)
        with core.SessionLocal() as db:
            for _ in range(12):
                conversation_id = uuid.uuid4().hex
                db.add(models.Conversation(id=conversation_id, type="direct",
                                          participant_ids=[owner_id, peer_id]))
                db.add(models.ConversationMember(id=uuid.uuid4().hex,
                                                conversation_id=conversation_id, user_id=owner_id))
            db.commit()
        statements = []
        def capture(conn, cursor, statement, parameters, context, executemany):
            if statement.lstrip().upper().startswith("SELECT"):
                statements.append(statement)
        event.listen(database.engine, "before_cursor_execute", capture)
        try:
            response = self.client.get("/chat/conversations", headers=headers)
        finally:
            event.remove(database.engine, "before_cursor_execute", capture)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(len(response.json()), 13)
        self.assertLessEqual(len(statements), 7, statements)
        for item in response.json():
            self.assert_private_fields_hidden(item["peer"])

    def test_production_import_does_not_seed_and_direct_start_has_chat_routes(self):
        environment = os.environ.copy()
        environment["LULU_ENV"] = "production"
        environment["LULU_DB_PATH"] = os.path.join(_database.name, "production.db")
        environment["LULU_DATABASE_URL"] = "sqlite:///" + environment["LULU_DB_PATH"]
        environment.pop("LULU_ENABLE_SEED_DATA", None)
        source = (
            "import json,runpy; from unittest.mock import patch; "
            "from fastapi.testclient import TestClient; "
            "mock=patch('uvicorn.run'); run=mock.start(); "
            "namespace=runpy.run_module('backend.main',run_name='__main__'); "
            "app=run.call_args.args[0]; "
            "client=TestClient(app); client.__enter__(); "
            "db=namespace['core'].SessionLocal(); "
            "print(json.dumps({'users':db.query(namespace['core'].models.User).count(),"
            "'paths':[r.path for r in app.routes]})); db.close(); "
            "client.__exit__(None,None,None); mock.stop()"
        )
        output = subprocess.check_output(
            [sys.executable, "-B", "-c", source], env=environment,
            cwd=Path(__file__).resolve().parents[1], text=True,
        )
        result = json.loads(output)
        self.assertEqual(result["users"], 0)
        self.assertIn("/chat/upload", result["paths"])
        self.assertIn("/ws/chat", result["paths"])
        self.assertIn("/auth/refresh", result["paths"])


if __name__ == "__main__":
    unittest.main()

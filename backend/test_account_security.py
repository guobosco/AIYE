"""Isolated account contract tests; never use the workspace business database."""

import os
import tempfile
import unittest
import uuid
from unittest.mock import patch

_database = tempfile.TemporaryDirectory(prefix="aiye-account-tests-")
os.environ["LULU_DB_PATH"] = os.path.join(_database.name, "accounts.db")
os.environ["LULU_ENV"] = "development"
os.environ["LULU_SECRET_KEY"] = "isolated-test-key-not-for-deployment"
os.environ["LULU_ENABLE_DEBUG_PHONE_CODES"] = "true"

from fastapi.testclient import TestClient
try:
    from . import main, models, account_security as accounts
except ImportError:
    import main, models, account_security as accounts


class AccountSecurityTests(unittest.TestCase):
    def setUp(self):
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
        with main.SessionLocal() as db:
            other = accounts.issue_session(db, db.get(models.User, result["user"]["id"]))
        response = self.client.post("/auth/logout-all", headers=headers)
        self.assertEqual(response.status_code, 200)
        for token in [result["access_token"], other["access_token"]]:
            self.assertEqual(self.client.get("/auth/me", headers={
                "Authorization": "Bearer " + token,
            }).status_code, 401)

    def test_legacy_unbounded_token_rejected(self):
        result, _ = self.login()
        legacy = main.create_access_token({"sub": result["user"]["id"]})
        response = self.client.get("/auth/me", headers={"Authorization": "Bearer " + legacy})
        self.assertEqual(response.status_code, 401)

    def test_wechat_debug_rejected_and_unbound_business_restricted(self):
        response = self.client.post("/auth/wechat/mobile/login", json={
            "code": "debug_wechat_anything", "state": "state", "platform": "android",
        })
        self.assertEqual(response.status_code, 400)
        with patch.object(main, "exchange_wechat_mobile_code", return_value={
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
        with main.SessionLocal() as db:
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
            with patch.object(main, "exchange_wechat_mobile_code", return_value={
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
        with main.SessionLocal() as db:
            identity = accounts.verified_identity(db, "phone", self.phone)
            self.assertEqual(identity.user_id, existing["user"]["id"])


if __name__ == "__main__":
    unittest.main()

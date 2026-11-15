"""Consultation contracts on the account suite's isolated temporary database."""
import unittest
import uuid
from datetime import datetime
from unittest.mock import patch
from . import test_account_security as suite
from . import core, models, account_security as accounts, consultation_service


class ConsultationTests(unittest.TestCase):
    send = suite.AccountSecurityTests.send
    login = suite.AccountSecurityTests.login

    def setUp(self):
        suite.AccountSecurityTests.setUp(self)
        clock = patch.object(consultation_service, "booking_now", return_value=datetime(
            2026, 11, 15, 10, 0, tzinfo=consultation_service.BOOKING_TIMEZONE,
        ))
        clock.start()
        self.addCleanup(clock.stop)

    @classmethod
    def setUpClass(cls):
        suite.AccountSecurityTests.setUpClass()

    def ready(self):
        auth, headers = self.login("198" + str(uuid.uuid4().int % 100000000).zfill(8))
        response = self.client.put(f"/users/{auth['user']['id']}", headers=headers, json={
            "name": "Consultation test", "gender": "女", "region": "海南",
            "photo_url": "/static/test-avatar.jpg",
        })
        self.assertEqual(response.status_code, 200, response.text)
        return auth, headers

    def context(self, kind="service"):
        host, host_headers = self.ready()
        guest, guest_headers = self.ready()
        item_id = uuid.uuid4().hex
        with core.SessionLocal() as db:
            model = models.Service if kind == "service" else models.Experience
            owner = {"creator_id": host["user"]["id"]} if kind == "service" else {"host_id": host["user"]["id"]}
            db.add(model(id=item_id, title="海边咨询", location="海南三亚", category="户外",
                         review_status="approved", is_deleted=False, is_draft=False,
                         created_at=1, updated_at=1, **owner))
            db.commit()
        response = self.client.post("/chat/conversations/direct/" + host["user"]["id"], headers=guest_headers)
        self.assertEqual(response.status_code, 200, response.text)
        conversation = response.json()["conversation"]["id"]
        body = {"content": "咨询测试", "client_message_id": uuid.uuid4().hex,
                "extra": {"consultation": "true", f"{kind}_id": item_id,
                          "inquiry_date": "2026-12-01 10:00", "guest_count": "2"}}
        return host, host_headers, guest, guest_headers, item_id, conversation, body

    def test_message_and_inquiry_are_atomic_and_idempotent(self):
        host, hh, guest, gh, item, conversation, body = self.context()
        path = f"/chat/conversations/{conversation}/messages"
        first = self.client.post(path, headers=gh, json=body)
        self.assertEqual(first.status_code, 200, first.text)
        self.assertEqual(self.client.post(path, headers=gh, json=body).json(), first.json())
        records = self.client.get("/me/inquiries", headers=gh).json()
        record = next(value for value in records if value["id"] == first.json()["id"])
        self.assertEqual(record["host_id"], host["user"]["id"])
        self.assertEqual(record["details"]["guest_count"], 2)
        with core.SessionLocal() as db:
            self.assertEqual(db.query(models.Inquiry).filter_by(conversation_id=conversation).count(), 1)
            self.assertEqual(db.query(models.ChatMessage).filter_by(conversation_id=conversation).count(), 1)
            self.assertEqual(db.query(models.InboxNotice).filter_by(conversation_id=conversation).count(), 1)
        changed = {**body, "extra": {**body["extra"], "guest_count": "3"}}
        self.assertEqual(self.client.post(path, headers=gh, json=changed).status_code, 409)

    def test_invalid_host_and_calendar_roll_back_message(self):
        host, hh, guest, gh, item, conversation, body = self.context()
        path = f"/chat/conversations/{conversation}/messages"
        with core.SessionLocal() as db:
            db.add(models.CalendarClosure(id=f"{item}:2026-12-01", service_id=item,
                                         day="2026-12-01", all_day=False, start="09:00", end="12:00"))
            db.commit()
        self.assertEqual(self.client.post(path, headers=gh, json=body).status_code, 409)
        invalid = {**body, "extra": {**body["extra"], "inquiry_date": "2026-02-30"}}
        self.assertEqual(self.client.post(path, headers=gh, json=invalid).status_code, 422)
        with core.SessionLocal() as db:
            self.assertEqual(db.query(models.ChatMessage).filter_by(conversation_id=conversation).count(), 0)
            self.assertEqual(db.query(models.Inquiry).filter_by(conversation_id=conversation).count(), 0)
            self.assertEqual(db.query(models.ConversationMember).filter_by(
                conversation_id=conversation, user_id=host["user"]["id"]).one().unread_count, 0)
        fake = {**body, "extra": {**body["extra"], "service_id": uuid.uuid4().hex}}
        self.assertEqual(self.client.post(path, headers=gh, json=fake).status_code, 409)

    def test_inquiry_owner_status_and_version(self):
        host, hh, guest, gh, item, conversation, body = self.context("experience")
        result = self.client.post(f"/chat/conversations/{conversation}/messages", headers=gh, json=body)
        self.assertEqual(result.status_code, 200, result.text)
        path = "/me/inquiries/" + result.json()["id"]
        outsider, oh = self.ready()
        self.assertNotIn(result.json()["id"], [v["id"] for v in self.client.get("/me/inquiries", headers=oh).json()])
        self.assertEqual(self.client.put(path, headers=oh, json={"status": "closed", "version": 1}).status_code, 404)
        self.assertEqual(self.client.put(path, headers=gh, json={"status": "replied", "version": 1}).status_code, 403)
        self.assertEqual(self.client.put(path, headers=hh, json={"status": "replied", "version": 1}).json()["version"], 2)
        self.assertEqual(self.client.put(path, headers=gh, json={"status": "closed", "version": 1}).status_code, 409)
        self.assertEqual(self.client.put(path, headers=gh, json={"status": "closed", "version": 2}).json()["status"], "closed")
        self.assertEqual(self.client.put(path, headers=gh, json={"status": "closed", "version": 2}).status_code, 409)
        repeated = self.client.put(path, headers=gh, json={"status": "closed", "version": 3})
        self.assertEqual(repeated.status_code, 200)
        self.assertEqual(repeated.json()["version"], 3)
        self.assertEqual(self.client.put(path, headers=hh, json={"status": "replied", "version": 3}).status_code, 409)

    def test_service_time_rules_reject_bypass_and_keep_message_atomic(self):
        host, hh, guest, gh, item, conversation, body = self.context()
        with core.SessionLocal() as db:
            service = db.get(models.Service, item)
            service.booking_lead_hours = 2.5
            service.booking_future_open_days = 7
            service.booking_time_ranges_json = '[{"start":"09:00","end":"13:00"},{"start":"18:00","end":"24:00"}]'
            db.commit()
        path = f"/chat/conversations/{conversation}/messages"
        for day, status in [
            ("2026-11-15 12:29", 409), ("2026-11-14 18:00", 409),
            ("2026-11-22 09:00", 409), ("2026-11-16 13:00", 409),
            ("2026-11-16 08:59", 409), ("2026-11-16", 422),
            ("2026-11-16 24:00", 422), ("2026-11-16 18:99", 422),
            ("2026-11-16 garbage", 422), ("2026-11-16 18:00 extra", 422),
        ]:
            with self.subTest(day=day):
                payload = {**body, "extra": {**body["extra"], "inquiry_date": day}}
                result = self.client.post(path, headers=gh, json=payload)
                self.assertEqual(result.status_code, status, result.text)
        with core.SessionLocal() as db:
            self.assertEqual(db.query(models.ChatMessage).filter_by(conversation_id=conversation).count(), 0)
            self.assertEqual(db.query(models.Inquiry).filter_by(conversation_id=conversation).count(), 0)
            self.assertEqual(db.query(models.ConversationMember).filter_by(
                conversation_id=conversation, user_id=host["user"]["id"]).one().unread_count, 0)
        for day in ["2026-11-15 12:30", "2026-11-21 23:30", "2026年11月16日 18:00"]:
            payload = {**body, "client_message_id": uuid.uuid4().hex,
                       "extra": {**body["extra"], "inquiry_date": day}}
            result = self.client.post(path, headers=gh, json=payload)
            self.assertEqual(result.status_code, 200, result.text)

    def test_bad_host_time_rules_fail_closed_but_undated_consultation_remains_allowed(self):
        host, hh, guest, gh, item, conversation, body = self.context()
        path = f"/chat/conversations/{conversation}/messages"
        for raw in ['invalid', '{}', '[{"start":"09:00","end":"09:00"}]', '[null]']:
            with core.SessionLocal() as db:
                db.get(models.Service, item).booking_time_ranges_json = raw
                db.commit()
            result = self.client.post(path, headers=gh, json=body)
            self.assertEqual(result.status_code, 409, result.text)
        body["extra"]["inquiry_date"] = ""
        result = self.client.post(path, headers=gh, json=body)
        self.assertEqual(result.status_code, 200, result.text)
        row = next(v for v in self.client.get("/me/inquiries", headers=gh).json() if v["id"] == result.json()["id"])
        self.assertEqual(row["details"]["inquiry_date"], "")

    def test_private_lists_are_paged_stably_and_owner_scoped(self):
        auth, headers = self.ready()
        outsider, oh = self.ready()
        now = core.current_millis()
        with core.SessionLocal() as db:
            for index in range(205):
                peer = f"paged-peer-{uuid.uuid4().hex}"
                db.add(models.User(id=peer, name="分页测试"))
                db.add(models.UserBlock(id=uuid.uuid4().hex, user_id=auth["user"]["id"],
                                        peer_id=peer, created_at=now))
                db.add(models.AuthSession(id=uuid.uuid4().hex, user_id=auth["user"]["id"],
                                          refresh_hash=uuid.uuid4().hex, created_at=now,
                                          expires_at=now + 3600000, revoked_at=0))
            db.commit()
        for path, key, total in [("/auth/sessions", "id", 206), ("/me/blocks", "peer_id", 205)]:
            with self.subTest(path=path):
                pages = [self.client.get(path, headers=headers, params={"skip": skip, "limit": 100}).json()
                         for skip in (0, 100, 200)]
                ids = [row[key] for page in pages for row in page]
                self.assertEqual([len(page) for page in pages], [100, 100, total - 200])
                self.assertEqual(len(set(ids)), total)
                self.assertEqual(len(self.client.get(path, headers=headers).json()), 100)
                self.assertEqual(self.client.get(path, headers=headers, params={"limit": 100}).json(), pages[0])
                self.assertTrue(set(ids).isdisjoint(row[key] for row in self.client.get(path, headers=oh).json()))
                self.assertEqual(self.client.get(path, headers=headers, params={"skip": -1}).status_code, 422)
                self.assertEqual(self.client.get(path, headers=headers, params={"limit": 201}).status_code, 422)
                self.assertEqual(self.client.get(path).status_code, 401)

    def test_bidirectional_block_preserves_history_and_filters_catalog(self):
        host, hh, guest, gh, item, conversation, body = self.context()
        path = f"/chat/conversations/{conversation}/messages"
        self.assertEqual(self.client.post(path, headers=gh, json=body).status_code, 200)
        block_path = "/me/blocks/" + host["user"]["id"]
        for _ in range(2):
            self.assertEqual(self.client.put(block_path, headers=gh).status_code, 200)
        for headers in [gh, hh]:
            self.assertEqual(self.client.post(path, headers=headers, json={
                "content": "blocked", "client_message_id": uuid.uuid4().hex,
            }).status_code, 403)
            self.assertEqual(self.client.get(path, headers=headers).status_code, 200)
        self.assertNotIn(item, [v["id"] for v in self.client.get("/catalog/search", headers=gh).json()])
        self.assertNotIn(item, [v["id"] for v in self.client.get("/services/discovery", headers=gh).json()])
        self.assertIn(item, [v["id"] for v in self.client.get("/catalog/search").json()])
        self.assertEqual(self.client.delete(block_path, headers=gh).status_code, 200)
        self.assertEqual(self.client.post(path, headers=gh, json={
            "content": "unblocked", "client_message_id": uuid.uuid4().hex,
        }).status_code, 200)

    def test_notice_preference_and_read_owner(self):
        host, hh, guest, gh, item, conversation, body = self.context()
        pref = self.client.put("/me/reminders", headers=hh, json={"enabled": False}).json()
        self.assertFalse(pref["remote_push_enabled"])
        self.client.post(f"/chat/conversations/{conversation}/messages", headers=gh, json=body)
        with core.SessionLocal() as db:
            self.assertEqual(db.query(models.InboxNotice).filter_by(conversation_id=conversation).count(), 0)
        self.client.put("/me/reminders", headers=hh, json={"enabled": True})
        body["client_message_id"] = uuid.uuid4().hex
        self.client.post(f"/chat/conversations/{conversation}/messages", headers=gh, json=body)
        notice = next(v for v in self.client.get("/me/notices", headers=hh).json() if v["conversation_id"] == conversation)
        path = f"/me/notices/{notice['id']}/read"
        self.assertEqual(self.client.post(path, headers=gh).status_code, 404)
        self.assertEqual(self.client.post(path, headers=hh).status_code, 200)

    def test_report_permissions_and_processing_record(self):
        host, hh, guest, gh, item, conversation, body = self.context()
        result = self.client.post(f"/chat/conversations/{conversation}/messages", headers=gh, json=body).json()
        outsider, oh = self.ready()
        payload = {"kind": "message", "target_id": result["id"], "reason": "不当信息"}
        self.assertEqual(self.client.post("/reports", headers=oh, json=payload).status_code, 403)
        report = self.client.post("/reports", headers=gh, json=payload)
        self.assertEqual(report.status_code, 200, report.text)
        self.assertEqual(report.json()["category"], "report_message")
        self.assertIn(report.json()["id"], [v["id"] for v in self.client.get("/me/feedbacks", headers=gh).json()])
        self.assertNotIn(report.json()["id"], [v["id"] for v in self.client.get("/me/feedbacks", headers=oh).json()])

    def test_phone_change_scene_owner_and_session_revocation(self):
        auth, headers = self.ready()
        old = auth["user"]["phone_number"]
        new = "197" + str(uuid.uuid4().int % 100000000).zfill(8)
        old_code = self.send(old, "change_phone_old", headers)
        new_code = self.send(new, "change_phone_new", headers)
        with core.SessionLocal() as db:
            other = accounts.issue_session(db, db.get(models.User, auth["user"]["id"]))
        response = self.client.post("/auth/phone/change", headers=headers, json={
            "phone_number": new, "old_code": old_code, "new_code": new_code,
        })
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["phone_number"], new)
        for token in [auth["access_token"], other["access_token"]]:
            self.assertEqual(self.client.get("/auth/me", headers={"Authorization": "Bearer " + token}).status_code, 401)
        self.assertEqual(self.client.post("/auth/refresh", json={"refresh_token": other["refresh_token"]}).status_code, 401)
        self.assertEqual(self.client.post("/auth/phone/send-code", json={
            "phone_number": new, "scene": "close_account",
        }).status_code, 401)

    def test_account_closure_anonymizes_and_downlists(self):
        host, hh, guest, gh, item, conversation, body = self.context()
        self.client.post(f"/chat/conversations/{conversation}/messages", headers=gh, json=body)
        self.client.post("/feedbacks", headers=hh, json={"content": "测试", "contact": "private"})
        code = self.send(host["user"]["phone_number"], "close_account", hh)
        response = self.client.post("/auth/account/close", headers=hh, json={
            "verify_code": code, "confirmation": "注销账号",
        })
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.client.get("/auth/me", headers=hh).status_code, 401)
        self.assertEqual(self.client.get(f"/services/{item}").status_code, 404)
        self.assertEqual(self.client.post("/chat/conversations/direct/" + host["user"]["id"], headers=gh).status_code, 404)
        with core.SessionLocal() as db:
            user = db.get(models.User, host["user"]["id"])
            self.assertEqual(user.name, "已注销用户")
            self.assertIsNone(user.phone_number)
            self.assertEqual(user.photo_url, "")
            self.assertEqual(db.query(models.AuthIdentity).filter_by(user_id=user.id).count(), 0)
            feedback = db.query(models.Feedback).filter_by(user_id=user.id).one()
            self.assertEqual(feedback.contact, "")
            self.assertEqual(feedback.phone_number, "")

    def test_failed_phone_change_does_not_consume_old_code(self):
        auth, headers = self.ready()
        new = "197" + str(uuid.uuid4().int % 100000000).zfill(8)
        old_code = self.send(auth["user"]["phone_number"], "change_phone_old", headers)
        new_code = self.send(new, "change_phone_new", headers)
        payload = {"phone_number": new, "old_code": old_code, "new_code": "000000" if new_code != "000000" else "111111"}
        self.assertEqual(self.client.post("/auth/phone/change", headers=headers, json=payload).status_code, 400)
        self.assertEqual(self.client.get("/auth/me", headers=headers).json()["phone_number"], auth["user"]["phone_number"])
        payload["new_code"] = new_code
        self.assertEqual(self.client.post("/auth/phone/change", headers=headers, json=payload).status_code, 200)

    def test_search_filters_and_pagination(self):
        host, hh, guest, gh, item, conversation, body = self.context()
        matching = self.client.get("/catalog/search", params={"q": "海边", "city": "三亚", "category": "户外"}).json()
        self.assertIn(item, [value["id"] for value in matching])
        self.assertNotIn(item, [value["id"] for value in self.client.get("/catalog/search", params={"city": "北京"}).json()])
        first = self.client.get("/catalog/search", params={"limit": 1}).json()
        second = self.client.get("/catalog/search", params={"skip": 1, "limit": 1}).json()
        self.assertEqual(len(first), 1)
        self.assertTrue(set(value["id"] for value in first).isdisjoint(value["id"] for value in second))

    def test_new_login_generates_an_account_notice(self):
        auth, headers = self.ready()
        with core.SessionLocal() as db:
            accounts.issue_session(db, db.get(models.User, auth["user"]["id"]))
        records = self.client.get("/me/notices", headers=headers).json()
        self.assertTrue(any(record["kind"] == "account" and not record["conversation_id"] for record in records))


if __name__ == "__main__":
    unittest.main()

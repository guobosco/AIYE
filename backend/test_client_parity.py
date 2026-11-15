"""Parity contracts using the account suite's temporary database only."""
import uuid
import unittest
from fastapi import HTTPException
from . import test_account_security
from . import core, models


class ClientParityTests(test_account_security.AccountSecurityTests):
    def item(self, kind="services", draft=False):
        auth, headers = self.login()
        item_id = str(uuid.uuid4())
        owner = "creator_id" if kind == "services" else "host_id"
        payload = {
            "id": item_id, owner: auth["user"]["id"], "title": "Parity draft",
            "created_at": 1, "updated_at": 1, "is_draft": draft,
        }
        result = self.client.post(f"/{kind}/", headers=headers, json=payload)
        self.assertEqual(result.status_code, 200, result.text)
        return item_id, payload, headers

    def test_experience_draft_publish_cancel_restore_hide(self):
        item_id, payload, headers = self.item("experiences", True)
        path = f"/experiences/{item_id}"
        self.assertEqual(self.client.get(path).status_code, 404)
        result = self.client.get(path, headers=headers).json()
        self.assertTrue(result["is_draft"])
        self.assertEqual(result["review_status"], "draft")
        payload["is_draft"] = False
        result = self.client.put(path, headers=headers, json=payload)
        self.assertEqual(result.json()["review_status"], "pending_review")
        self.assertEqual(self.client.delete(path + "/record", headers=headers).status_code, 409)
        self.assertTrue(self.client.delete(path, headers=headers).json()["is_deleted"])
        self.assertIn(item_id, [v["id"] for v in self.client.get("/experiences/", headers=headers).json()])
        self.assertEqual(self.client.delete(path + "/record", headers=headers).status_code, 200)
        self.assertNotIn(item_id, [v["id"] for v in self.client.get("/experiences/", headers=headers).json()])
        payload["is_deleted"] = False
        result = self.client.put(path, headers=headers, json=payload)
        self.assertEqual(result.status_code, 200)
        self.assertFalse(result.json()["is_deleted"])
        self.assertIn(item_id, [v["id"] for v in self.client.get("/experiences/", headers=headers).json()])

    def test_calendar_persistence_versions_and_visibility(self):
        item_id, _, headers = self.item()
        path = f"/services/{item_id}/calendar"
        self.assertEqual(self.client.get(path).status_code, 404)
        self.assertEqual(self.client.get(path, headers=headers).json(), {"days": {}})
        result = self.client.put(path + "/2026-12-01", headers=headers,
                               json={"allDay": False, "start": "09:00", "end": "12:00"})
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(result.json()["version"], 1)
        self.assertEqual(self.client.put(path + "/2026-12-01", headers=headers,
                                       json={"allDay": True}).status_code, 409)
        self.assertEqual(self.client.put(path + "/2026-02-30", headers=headers,
                                       json={}).status_code, 422)
        self.assertEqual(self.client.put(path + "/2026-12-02", headers=headers,
                                       json={"allDay": False, "start": "22:00", "end": "08:00"}).status_code, 422)
        result = self.client.put(path + "/2026-12-01", headers=headers,
                                json={"version": 1, "active": False})
        self.assertEqual(result.json()["version"], 2)
        self.assertFalse(self.client.get(path, headers=headers).json()["days"]["2026-12-01"]["active"])
        with core.SessionLocal() as db:
            db.get(models.Service, item_id).review_status = "approved"
            db.commit()
        self.assertEqual(self.client.get(path).status_code, 200)

    def test_non_owner_cannot_change_calendar_or_hide(self):
        item_id, _, headers = self.item(draft=True)
        _, other = self.login("198" + str(uuid.uuid4().int % 100000000).zfill(8))
        self.assertEqual(self.client.put(f"/services/{item_id}/calendar/2026-12-01",
                                       headers=other, json={}).status_code, 403)
        self.assertEqual(self.client.delete(f"/services/{item_id}/record", headers=other).status_code, 403)
        self.assertEqual(self.client.delete(f"/services/{item_id}/record", headers=headers).status_code, 200)

    def test_calendar_midnight_boundary_and_tombstone_conflict(self):
        item_id, _, headers = self.item()
        path = f"/services/{item_id}/calendar/2026-12-03"
        result = self.client.put(path, headers=headers,
                                json={"allDay": False, "start": "23:00", "end": "24:00"})
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(result.json()["end"], "24:00")
        self.assertEqual(self.client.put(path, headers=headers,
                                        json={"version": 1, "active": False}).status_code, 200)
        self.assertEqual(self.client.put(path, headers=headers,
                                        json={"version": 1, "active": True}).status_code, 409)
        self.assertFalse(self.client.get(f"/services/{item_id}/calendar", headers=headers)
                         .json()["days"]["2026-12-03"]["active"])

    def test_service_cancel_hide_restore_remains_owner_scoped(self):
        item_id, payload, headers = self.item()
        path = f"/services/{item_id}"
        self.assertEqual(self.client.delete(path + "/record", headers=headers).status_code, 409)
        self.assertEqual(self.client.delete(path, headers=headers).status_code, 200)
        self.assertEqual(self.client.delete(path + "/record", headers=headers).status_code, 200)
        self.assertNotIn(item_id, [v["id"] for v in self.client.get("/services/", headers=headers).json()])
        payload["is_deleted"] = False
        result = self.client.put(path, headers=headers, json=payload)
        self.assertEqual(result.json()["review_status"], "pending_review")
        self.assertIn(item_id, [v["id"] for v in self.client.get("/services/", headers=headers).json()])
        self.assertEqual(self.client.get(path).status_code, 404)

    def test_experience_draft_excluded_from_review_and_discovery(self):
        item_id, _, _ = self.item("experiences", True)
        self.assertNotIn(item_id, [v["id"] for v in self.client.get("/experiences/discovery").json()])
        with core.SessionLocal() as db:
            item = db.get(models.Experience, item_id)
            self.assertNotIn(item_id, [v["id"] for v in core.build_review_queue(db)])
            with self.assertRaises(HTTPException) as caught:
                core.apply_admin_experience_update(item, core.AdminExperienceUpdatePayload(review_status="approved"))
            self.assertEqual(caught.exception.status_code, 409)
            self.assertTrue(item.is_draft)


if __name__ == "__main__":
    unittest.main()

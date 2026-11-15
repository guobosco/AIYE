"""Shared consultation rules; writes participate in the caller's transaction."""
import uuid
import re
from datetime import date
from fastapi import HTTPException
from sqlalchemy import or_, and_
try:
    from . import models
except ImportError:
    import models


def ensure_ready(user):
    if not user.is_phone_verified or not all(
        (getattr(user, field) or "").strip() for field in ("name", "gender", "region", "photo_url")
    ):
        raise HTTPException(403, "Complete verified phone and required profile fields first")


def ensure_contact_allowed(db, user_id, peer_id):
    if db.get(models.AccountClosure, peer_id):
        raise HTTPException(404, "Account unavailable")
    blocked = db.query(models.UserBlock.id).filter(or_(
        and_(models.UserBlock.user_id == user_id, models.UserBlock.peer_id == peer_id),
        and_(models.UserBlock.user_id == peer_id, models.UserBlock.peer_id == user_id),
    )).first()
    if blocked:
        raise HTTPException(403, "Contact is blocked")


def hidden_hosts(db, viewer=None):
    ids = {row[0] for row in db.query(models.AccountClosure.user_id).all()}
    if viewer:
        ids.update(row[0] for row in db.query(models.UserBlock.peer_id).filter_by(user_id=viewer.id))
    return ids


def notice(db, user_id, event_id, kind, title, conversation_id, now):
    pref = db.get(models.ReminderPreference, user_id)
    if pref and not pref.enabled:
        return
    notice_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"notice:{user_id}:{event_id}"))
    if db.get(models.InboxNotice, notice_id) is None:
        db.add(models.InboxNotice(
            id=notice_id, user_id=user_id, kind=kind, title=title[:200],
            conversation_id=conversation_id, created_at=now,
        ))


def capture_inquiry(db, user, conversation, message):
    extra = message.extra or {}
    # Sharing a card alone is not an inquiry.
    marker = extra.get("consultation")
    if marker not in (True, "true", "1") and not extra.get("inquiry_date"):
        return
    kind = "experience" if extra.get("experience_id") else "service"
    item_id = extra.get(f"{kind}_id")
    if not item_id:
        raise HTTPException(422, "Inquiry requires a service or experience")
    ensure_ready(user)
    item = db.get(models.Experience if kind == "experience" else models.Service, str(item_id))
    if item is None or item.is_deleted or item.is_draft or item.review_status != "approved":
        raise HTTPException(409, "This item is unavailable for consultation")
    host_id = item.host_id if kind == "experience" else item.creator_id
    if host_id == user.id or host_id not in (conversation.participant_ids or []):
        raise HTTPException(403, "Inquiry must be sent to the item's host")
    ensure_contact_allowed(db, user.id, host_id)
    # Clients retain localized display dates; normalize the calendar portion.
    raw_day = str(extra.get("inquiry_date") or "").strip()
    if raw_day:
        match = re.match(r"^(\d{4})[-年](\d{1,2})[-月](\d{1,2})(?:日)?(?:$|\s)", raw_day)
        if not match:
            raise HTTPException(422, "Invalid inquiry date")
        try:
            day = date(*map(int, match.groups())).isoformat()
        except ValueError:
            raise HTTPException(422, "Invalid inquiry date")
        clock_match = re.search(r"\s(\d{2}:\d{2})$", raw_day)
        clock = clock_match.group(1) if clock_match else ""
        if clock:
            hour, minute = map(int, clock.split(":"))
            if hour > 23 or minute > 59:
                raise HTTPException(422, "Invalid inquiry time")
        if kind == "service":
            closure = db.get(models.CalendarClosure, f"{item.id}:{day}")
            if closure and closure.active and closure.all_day:
                raise HTTPException(409, "This date is closed; choose another date")
            if clock:
                if closure and closure.active and closure.start <= clock < closure.end:
                    raise HTTPException(409, "This time is closed; choose another time")
        if clock:
            day = f"{day} {clock}"
    else:
        day = ""
    try:
        guests = int(extra.get("guest_count") or 1)
        if guests < 1 or guests > 1000:
            raise ValueError()
    except (ValueError, TypeError):
        raise HTTPException(422, "Invalid guest count")
    details = {key: extra[key] for key in (
        "inquiry_date", "guest_count", "selected_option", "location", "price_text", "price_basis_text"
    ) if key in extra}
    details.update(inquiry_date=day, guest_count=guests)
    db.add(models.Inquiry(
        id=message.id, user_id=user.id, host_id=host_id, conversation_id=conversation.id,
        kind=kind, item_id=item.id, title=item.title, details=details, status="pending",
        version=1, created_at=message.created_at, updated_at=message.created_at,
    ))

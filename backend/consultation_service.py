"""Shared consultation rules; writes participate in the caller's transaction."""
import uuid
import re
import json
from datetime import datetime, timedelta, timezone
from fastapi import HTTPException
from sqlalchemy import or_, and_
try:
    from . import models
except ImportError:
    import models


# The current catalog uses China-local wall times in all three clients.
BOOKING_TIMEZONE = timezone(timedelta(hours=8))


def booking_now():
    return datetime.now(BOOKING_TIMEZONE)


def clock_minutes(value, allow_day_end=False):
    if not isinstance(value, str) or not re.fullmatch(r"\d{2}:\d{2}", value):
        return None
    if allow_day_end and value == "24:00":
        return 1440
    hour, minute = map(int, value.split(":"))
    return hour * 60 + minute if hour <= 23 and minute <= 59 else None


def normalize_inquiry_date(raw, service=None):
    if not raw:
        return ""
    match = re.fullmatch(
        r"(\d{4})-(\d{2})-(\d{2})(?: (\d{2}:\d{2}))?"
        r"|(\d{4})年(\d{1,2})月(\d{1,2})日(?: (\d{2}:\d{2}))?", raw,
    )
    if not match:
        raise HTTPException(422, "Invalid inquiry date")
    year, month, day, clock = match.groups()[:4] if match.group(1) else match.groups()[4:]
    minute = clock_minutes(clock) if clock else 0
    if minute is None:
        raise HTTPException(422, "Invalid inquiry time")
    try:
        selected = datetime(int(year), int(month), int(day), minute // 60, minute % 60,
                            tzinfo=BOOKING_TIMEZONE)
    except ValueError:
        raise HTTPException(422, "Invalid inquiry date")
    if service is not None:
        if not clock:
            raise HTTPException(422, "Choose a time for the service inquiry")
        now = booking_now()
        lead = max(0.0, min(float(service.booking_lead_hours or 0), 168.0))
        days = service.booking_future_open_days or 30
        days = 30 if days < 7 else min(days, 180)
        if selected < now + timedelta(hours=lead):
            raise HTTPException(409, "This time is too soon; choose a later time")
        if not 0 <= (selected.date() - now.date()).days < days:
            raise HTTPException(409, "This date is outside the open booking window")
        raw_ranges = (service.booking_time_ranges_json or "").strip()
        try:
            ranges = json.loads(raw_ranges) if raw_ranges else []
            if not isinstance(ranges, list):
                raise ValueError()
            parsed = []
            for row in ranges:
                start = clock_minutes(row.get("start")) if isinstance(row, dict) else None
                end = clock_minutes(row.get("end"), allow_day_end=True) if isinstance(row, dict) else None
                if start is None or end is None or start >= end:
                    raise ValueError()
                parsed.append((start, end))
        except (ValueError, TypeError):
            raise HTTPException(409, "The host must update the service time rules")
        if parsed and not any(start <= minute < end for start, end in parsed):
            raise HTTPException(409, "This time is outside the service hours")
    return selected.strftime("%Y-%m-%d") + (f" {clock}" if clock else "")


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
    raw_day = str(extra.get("inquiry_date") or "").strip()
    day = normalize_inquiry_date(raw_day, item if kind == "service" else None)
    if day and kind == "service":
        closure = db.get(models.CalendarClosure, f"{item.id}:{day[:10]}")
        if closure and closure.active and closure.all_day:
            raise HTTPException(409, "This date is closed; choose another date")
        if closure and closure.active and closure.start <= day[11:] < closure.end:
            raise HTTPException(409, "This time is closed; choose another time")
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

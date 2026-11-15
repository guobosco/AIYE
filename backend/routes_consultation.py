"""Consultation records, inbox, account self-service, and moderation."""
import uuid
import json
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_, desc, update
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
try:
    from . import core
    from .core import models, schemas, accounts
    from .consultation_service import notice, hidden_hosts
    from .errors import commit_and_refresh
except ImportError:
    import core
    from core import models, schemas, accounts
    from consultation_service import notice, hidden_hosts
    from errors import commit_and_refresh

router = APIRouter()

@router.get("/catalog/search")
def search_catalog(kind: str = Query("service", pattern="^(service|experience)$"),
                   q: str = Query("", max_length=100), city: str = Query("", max_length=100),
                   category: str = Query("", max_length=100), skip: int = Query(0, ge=0),
                   limit: int = Query(30, ge=1, le=100), db: Session = Depends(core.get_db),
                   viewer=Depends(core.get_optional_current_user)):
    model = models.Service if kind == "service" else models.Experience
    owner = model.creator_id if kind == "service" else model.host_id
    query = db.query(model).filter(model.is_deleted == False, model.is_draft == False,
                                   model.review_status == "approved")
    hidden = hidden_hosts(db, viewer)
    if hidden:
        query = query.filter(owner.notin_(hidden))
    if q.strip():
        query = query.filter(or_(model.title.contains(q.strip(), autoescape=True),
                                  model.description.contains(q.strip(), autoescape=True)))
    if city.strip():
        query = query.filter(model.location.contains(city.strip(), autoescape=True))
    if category.strip():
        query = query.filter(model.category == category.strip())
    if kind == "service":
        query = query.order_by(desc(model.sort_priority), desc(model.is_important))
    items = query.order_by(desc(model.updated_at), desc(model.id)).offset(skip).limit(limit).all()
    return [{"id": item.id, "kind": kind, "title": item.title, "location": item.location,
             "category": item.category, "price_text": item.price_text,
             "cover_image_url": item.cover_image_url,
             "host_id": item.creator_id if kind == "service" else item.host_id}
            for item in items]


@router.get("/me/inquiries", response_model=list[schemas.Inquiry])
def inquiries(role: str = Query("all", pattern="^(all|sent|received)$"),
              skip: int = Query(0, ge=0), limit: int = Query(100, ge=1, le=200),
              db: Session = Depends(core.get_db), user=Depends(core.get_current_user)):
    query = db.query(models.Inquiry)
    condition = (models.Inquiry.user_id == user.id if role == "sent" else
                 models.Inquiry.host_id == user.id if role == "received" else
                 or_(models.Inquiry.user_id == user.id, models.Inquiry.host_id == user.id))
    return query.filter(condition).order_by(desc(models.Inquiry.updated_at),
                                            desc(models.Inquiry.id)).offset(skip).limit(limit).all()


@router.put("/me/inquiries/{item_id}", response_model=schemas.Inquiry)
def change_inquiry(item_id: str, payload: schemas.InquiryUpdate,
                   db: Session = Depends(core.get_db), user=Depends(core.get_current_user)):
    item = db.get(models.Inquiry, item_id)
    if not item or user.id not in {item.user_id, item.host_id}:
        raise HTTPException(404, "Inquiry not found")
    if payload.status == "replied" and user.id != item.host_id:
        raise HTTPException(403, "Only the host can mark an inquiry replied")
    if item.version != payload.version:
        raise HTTPException(409, "Inquiry changed; refresh before retrying")
    if item.status == "closed":
        if payload.status == "closed":
            return item
        raise HTTPException(409, "Closed inquiries cannot be reopened")
    now = core.current_millis()
    changed = db.execute(update(models.Inquiry).where(
        models.Inquiry.id == item_id, models.Inquiry.version == payload.version,
        models.Inquiry.status != "closed",
    ).values(status=payload.status, version=payload.version + 1, updated_at=now)).rowcount
    if changed != 1:
        raise HTTPException(409, "Inquiry changed; refresh before retrying")
    peer = item.host_id if user.id == item.user_id else item.user_id
    notice(db, peer, f"{item.id}:{payload.version + 1}", "inquiry",
           "问询已结束" if payload.status == "closed" else "主理人已回复问询",
           item.conversation_id, now)
    db.commit()
    db.refresh(item)
    return item


@router.get("/me/notices", response_model=list[schemas.Notice])
def notices(skip: int = Query(0, ge=0), limit: int = Query(100, ge=1, le=200),
            db: Session = Depends(core.get_db), user=Depends(core.get_current_user)):
    return db.query(models.InboxNotice).filter_by(user_id=user.id).order_by(
        desc(models.InboxNotice.created_at), desc(models.InboxNotice.id)
    ).offset(skip).limit(limit).all()


@router.post("/me/notices/{notice_id}/read")
def read_notice(notice_id: str, db: Session = Depends(core.get_db), user=Depends(core.get_current_user)):
    item = db.get(models.InboxNotice, notice_id)
    if not item or item.user_id != user.id:
        raise HTTPException(404, "Notice not found")
    item.is_read = True
    db.commit()
    return {"success": True}


@router.get("/me/reminders")
def reminders(db: Session = Depends(core.get_db), user=Depends(core.get_current_user)):
    item = db.get(models.ReminderPreference, user.id)
    return {"enabled": item.enabled if item else True, "remote_push_enabled": False}


@router.put("/me/reminders")
def update_reminders(payload: schemas.ReminderUpdate, db: Session = Depends(core.get_db),
                     user=Depends(core.get_current_user)):
    item = db.get(models.ReminderPreference, user.id)
    if not item:
        item = models.ReminderPreference(user_id=user.id)
        db.add(item)
    item.enabled = payload.enabled
    db.commit()
    return {"enabled": item.enabled, "remote_push_enabled": False}


@router.put("/me/push-registrations/{registration_id}")
def register_push(registration_id: str, payload: schemas.PushRegistrationRequest,
                  db: Session = Depends(core.get_db), user=Depends(core.get_current_user)):
    if len(registration_id) > 128:
        raise HTTPException(422, "Registration ID too long")
    item = db.get(models.PushRegistration, registration_id)
    if item and item.user_id != user.id:
        raise HTTPException(409, "Registration belongs to another account")
    if not item:
        item = models.PushRegistration(id=registration_id, user_id=user.id)
        db.add(item)
    item.channel, item.token, item.updated_at = payload.channel, payload.token, core.current_millis()
    db.commit()
    return {"registered": True, "remote_push_enabled": False}


@router.get("/me/blocks")
def blocks(skip: int = Query(0, ge=0), limit: int = Query(100, ge=1, le=200),
           db: Session = Depends(core.get_db), user=Depends(core.get_current_user)):
    return [{"peer_id": item.peer_id, "created_at": item.created_at}
            for item in db.query(models.UserBlock).filter_by(user_id=user.id).order_by(
                desc(models.UserBlock.created_at), desc(models.UserBlock.peer_id)
            ).offset(skip).limit(limit).all()]


@router.put("/me/blocks/{peer_id}")
def block(peer_id: str, db: Session = Depends(core.get_db), user=Depends(core.get_current_user)):
    if peer_id == user.id or not db.get(models.User, peer_id):
        raise HTTPException(400, "Invalid account to block")
    key = str(uuid.uuid5(uuid.NAMESPACE_URL, f"block:{user.id}:{peer_id}"))
    if not db.get(models.UserBlock, key):
        db.add(models.UserBlock(id=key, user_id=user.id, peer_id=peer_id, created_at=core.current_millis()))
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            if not db.get(models.UserBlock, key):
                raise
    return {"blocked": True}


@router.delete("/me/blocks/{peer_id}")
def unblock(peer_id: str, db: Session = Depends(core.get_db), user=Depends(core.get_current_user)):
    db.query(models.UserBlock).filter_by(user_id=user.id, peer_id=peer_id).delete()
    db.commit()
    return {"blocked": False}


@router.post("/reports", response_model=schemas.Feedback)
def report(payload: schemas.ReportRequest, db: Session = Depends(core.get_db),
           user=Depends(core.get_current_user)):
    target_model = {"user": models.User, "service": models.Service,
                    "experience": models.Experience, "message": models.ChatMessage}[payload.kind]
    target = db.get(target_model, payload.target_id)
    if target is None:
        raise HTTPException(404, "Report target not found")
    if payload.kind == "message":
        core.ensure_conversation_member(target.conversation_id, user, db)
    elif payload.kind in {"service", "experience"}:
        can_view = core.can_view_service if payload.kind == "service" else core.can_view_experience
        if not can_view(target, user):
            raise HTTPException(404, "Report target not found")
    accounts.rate_limit(db, f"reports:{user.id}", 10, 3600)
    now = core.current_millis()
    item = models.Feedback(
        id=str(uuid.uuid4()), user_id=user.id, user_name=user.name,
        source="consultation", category=f"report_{payload.kind}",
        content=json.dumps({"target_id": payload.target_id, "reason": payload.reason}, ensure_ascii=False),
        status="pending", created_at=now, updated_at=now,
    )
    db.add(item)
    commit_and_refresh(db, item)
    return item


@router.get("/auth/sessions")
def sessions(skip: int = Query(0, ge=0), limit: int = Query(100, ge=1, le=200),
             token: str = Depends(core.oauth2_scheme), db: Session = Depends(core.get_db)):
    current, user = accounts.resolve_session(db, token)
    return [{"id": item.id, "created_at": item.created_at, "expires_at": item.expires_at,
             "is_current": item.id == current.id} for item in db.query(models.AuthSession).filter(
        models.AuthSession.user_id == user.id, models.AuthSession.revoked_at == 0,
        models.AuthSession.expires_at > core.current_millis(),
    ).order_by(desc(models.AuthSession.created_at), desc(models.AuthSession.id)).offset(skip).limit(limit).all()]


@router.delete("/auth/sessions/{session_id}")
def revoke_session(session_id: str, token: str = Depends(core.oauth2_scheme),
                   db: Session = Depends(core.get_db)):
    _, user = accounts.resolve_session(db, token)
    item = db.get(models.AuthSession, session_id)
    if not item or item.user_id != user.id:
        raise HTTPException(404, "Session not found")
    item.revoked_at = core.current_millis()
    db.commit()
    return {"success": True}


@router.post("/auth/phone/change", response_model=schemas.User)
def change_phone(payload: schemas.PhoneChangeRequest, db: Session = Depends(core.get_db),
                 user=Depends(core.get_current_user)):
    number = accounts.phone(payload.phone_number)
    if not user.is_phone_verified or not user.phone_number or number == user.phone_number:
        raise HTTPException(400, "Verified old phone and a different new phone are required")
    if db.query(models.User).filter(models.User.phone_number == number, models.User.id != user.id).first():
        raise HTTPException(409, "Phone already belongs to another account")
    accounts.consume_code(db, user.phone_number, "change_phone_old", user.id, payload.old_code)
    accounts.consume_code(db, number, "change_phone_new", user.id, payload.new_code)
    db.query(models.AuthIdentity).filter_by(user_id=user.id, provider="phone").delete()
    accounts.bind_identity(db, user, "phone", number)
    user.phone_number, user.phone_bound_at, user.updated_at = number, core.current_millis(), core.current_millis()
    db.query(models.AuthSession).filter_by(user_id=user.id, revoked_at=0).update(
        {"revoked_at": core.current_millis()}, synchronize_session=False)
    db.query(models.PushRegistration).filter_by(user_id=user.id).delete()
    db.query(models.PhoneChallenge).filter_by(user_id=user.id).delete()
    commit_and_refresh(db, user)
    return user


@router.post("/auth/account/close")
def close_account(payload: schemas.AccountCloseRequest, db: Session = Depends(core.get_db),
                  user=Depends(core.get_current_user)):
    if not user.is_phone_verified or not user.phone_number:
        raise HTTPException(403, "Verify your phone before closing the account")
    accounts.consume_code(db, user.phone_number, "close_account", user.id, payload.verify_code)
    now = core.current_millis()
    db.add(models.AccountClosure(user_id=user.id, created_at=now))
    db.query(models.AuthSession).filter_by(user_id=user.id).update({"revoked_at": now}, synchronize_session=False)
    db.query(models.AuthIdentity).filter_by(user_id=user.id).delete()
    db.query(models.PushRegistration).filter_by(user_id=user.id).delete()
    db.query(models.PhoneChallenge).filter_by(user_id=user.id).delete()
    db.query(models.Service).filter_by(creator_id=user.id).update(
        {"is_deleted": True, "record_hidden": True}, synchronize_session=False)
    db.query(models.Experience).filter_by(host_id=user.id).update(
        {"is_deleted": True, "record_hidden": True}, synchronize_session=False)
    for field in accounts.PROFILE_FIELDS:
        if field in {"is_profile_completed", "height_weight_private"}:
            setattr(user, field, False)
        elif field in {"height_cm", "weight_kg"}:
            setattr(user, field, 0)
        elif field in {"tags", "profile_image_urls", "spoken_languages"}:
            setattr(user, field, [])
        elif field not in {"id", "pei_pei_id"}:
            setattr(user, field, "")
    user.name, user.email, user.phone_number, user.hashed_password = "已注销用户", None, None, None
    user.wechat_unionid, user.wechat_openid, user.is_phone_verified = None, None, False
    user.identity_verified, user.wechat_platform = False, ""
    user.phone_bound_at, user.last_login_at = 0, 0
    user.favorite_service_ids, user.favorite_experience_ids, user.updated_at = [], [], now
    db.query(models.Feedback).filter_by(user_id=user.id).update(
        {"user_name": "已注销用户", "phone_number": "", "contact": ""}, synchronize_session=False)
    db.query(models.WishlistGroup).filter_by(user_id=user.id).delete()
    db.query(models.InboxNotice).filter_by(user_id=user.id).delete()
    db.query(models.ReminderPreference).filter_by(user_id=user.id).delete()
    db.query(models.Inquiry).filter_by(user_id=user.id).update({"details": {}}, synchronize_session=False)
    db.commit()
    return {"closed": True}

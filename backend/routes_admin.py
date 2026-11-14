from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from sqlalchemy import or_, desc, func
from typing import Dict, List
from datetime import date, datetime, timedelta
import os
import json
try:
    from . import core
    from .errors import commit_and_refresh
    from .core import models, schemas
except ImportError:
    import core
    from errors import commit_and_refresh
    from core import models, schemas

router = APIRouter()

@router.get("/admin")
@router.get("/admin/")
def admin_page():
    if not os.path.isfile(core.ADMIN_INDEX_PATH):
        raise HTTPException(status_code=404, detail="Admin page not found")
    return FileResponse(core.ADMIN_INDEX_PATH)


@router.get("/admin/api/config")
def admin_config():
    return {
        "requires_token": bool(core.ADMIN_TOKEN),
        "password_login_enabled": bool(core.ADMIN_PASSWORD),
        "default_username": core.ADMIN_USERNAME,
        "display_name": core.ADMIN_DISPLAY_NAME,
        "session_expire_hours": core.ADMIN_SESSION_EXPIRE_HOURS,
    }


@router.post("/admin/api/auth/login", response_model=schemas.AdminLoginResponse)
def admin_login(payload: schemas.AdminLoginRequest):
    username = (payload.username or "").strip() or core.ADMIN_USERNAME
    password = payload.password or ""
    if not core.verify_admin_credentials(username, password):
        raise HTTPException(status_code=401, detail="账号或密码错误")
    token = core.create_admin_access_token(core.ADMIN_DISPLAY_NAME, role="super_admin")
    return schemas.AdminLoginResponse(
        token=token,
        display_name=core.ADMIN_DISPLAY_NAME,
        role="super_admin",
        expires_in_seconds=core.ADMIN_SESSION_EXPIRE_HOURS * 3600,
    )


@router.get("/admin/api/overview")
def admin_overview(
    _: None = Depends(core.require_admin_access),
    db: Session = Depends(core.get_db),
):
    today = date.today()
    today_start_ms = int(datetime.combine(today, datetime.min.time()).timestamp() * 1000)
    seven_days_start_ms = int(datetime.combine(today - timedelta(days=6), datetime.min.time()).timestamp() * 1000)

    total_users = db.query(func.count(models.User.id)).scalar() or 0
    total_services = db.query(func.count(models.Service.id)).scalar() or 0
    total_experiences = db.query(func.count(models.Experience.id)).scalar() or 0

    phone_verified_users = db.query(func.count(models.User.id)).filter(models.User.is_phone_verified == True).scalar() or 0
    profile_completed_users = db.query(func.count(models.User.id)).filter(models.User.is_profile_completed == True).scalar() or 0
    identity_verified_users = db.query(func.count(models.User.id)).filter(models.User.identity_verified == True).scalar() or 0
    new_users_today = db.query(func.count(models.User.id)).filter(models.User.created_at >= today_start_ms).scalar() or 0
    new_users_last_7_days = db.query(func.count(models.User.id)).filter(models.User.created_at >= seven_days_start_ms).scalar() or 0

    active_services = db.query(func.count(models.Service.id)).filter(
        models.Service.is_deleted == False,
        models.Service.is_draft == False
    ).scalar() or 0
    draft_services = db.query(func.count(models.Service.id)).filter(
        models.Service.is_deleted == False,
        models.Service.is_draft == True
    ).scalar() or 0
    deleted_services = db.query(func.count(models.Service.id)).filter(models.Service.is_deleted == True).scalar() or 0
    square_services = db.query(func.count(models.Service.id)).filter(
        models.Service.is_deleted == False,
        models.Service.sync_to_square == True
    ).scalar() or 0
    prioritized_services = db.query(func.count(models.Service.id)).filter(
        models.Service.is_deleted == False,
        models.Service.sort_priority > 0
    ).scalar() or 0
    pending_service_reviews = db.query(func.count(models.Service.id)).filter(
        models.Service.review_status == "pending_review",
        models.Service.is_deleted == False,
    ).scalar() or 0
    approved_services = db.query(func.count(models.Service.id)).filter(
        models.Service.review_status == "approved",
        models.Service.is_deleted == False,
    ).scalar() or 0
    rejected_services = db.query(func.count(models.Service.id)).filter(
        models.Service.review_status == "rejected",
        models.Service.is_deleted == False,
    ).scalar() or 0
    active_experiences = db.query(func.count(models.Experience.id)).filter(models.Experience.is_deleted == False).scalar() or 0
    deleted_experiences = db.query(func.count(models.Experience.id)).filter(models.Experience.is_deleted == True).scalar() or 0
    pending_experience_reviews = db.query(func.count(models.Experience.id)).filter(
        models.Experience.review_status == "pending_review",
        models.Experience.is_deleted == False,
    ).scalar() or 0
    approved_experiences = db.query(func.count(models.Experience.id)).filter(
        models.Experience.review_status == "approved",
        models.Experience.is_deleted == False,
    ).scalar() or 0
    rejected_experiences = db.query(func.count(models.Experience.id)).filter(
        models.Experience.review_status == "rejected",
        models.Experience.is_deleted == False,
    ).scalar() or 0
    pending_feedbacks = db.query(func.count(models.Feedback.id)).filter(
        models.Feedback.status == "pending"
    ).scalar() or 0
    processing_feedbacks = db.query(func.count(models.Feedback.id)).filter(
        models.Feedback.status == "processing"
    ).scalar() or 0

    provider_stats: Dict[str, int] = {}
    for (provider,) in db.query(models.User.login_provider).all():
        key = (provider or "password").strip() or "password"
        provider_stats[key] = provider_stats.get(key, 0) + 1

    recent_users = db.query(models.User).order_by(
        desc(models.User.created_at),
        desc(models.User.updated_at)
    ).limit(8).all()

    def percent(value: int, total: int) -> float:
        if total <= 0:
            return 0.0
        return round((value / total) * 100, 1)

    return {
        "metrics": {
            "total_users": int(total_users),
            "new_users_today": int(new_users_today),
            "new_users_last_7_days": int(new_users_last_7_days),
            "phone_verified_users": int(phone_verified_users),
            "profile_completed_users": int(profile_completed_users),
            "identity_verified_users": int(identity_verified_users),
            "phone_verified_rate": percent(int(phone_verified_users), int(total_users)),
            "profile_completed_rate": percent(int(profile_completed_users), int(total_users)),
            "identity_verified_rate": percent(int(identity_verified_users), int(total_users)),
            "total_services": int(total_services),
            "active_services": int(active_services),
            "draft_services": int(draft_services),
            "deleted_services": int(deleted_services),
            "square_services": int(square_services),
            "prioritized_services": int(prioritized_services),
            "pending_service_reviews": int(pending_service_reviews),
            "approved_services": int(approved_services),
            "rejected_services": int(rejected_services),
            "total_experiences": int(total_experiences),
            "active_experiences": int(active_experiences),
            "deleted_experiences": int(deleted_experiences),
            "pending_experience_reviews": int(pending_experience_reviews),
            "approved_experiences": int(approved_experiences),
            "rejected_experiences": int(rejected_experiences),
            "pending_feedbacks": int(pending_feedbacks),
            "processing_feedbacks": int(processing_feedbacks),
        },
        "registration_series": core.build_registration_series(db, days=14),
        "provider_distribution": [
            {"provider": provider, "count": count}
            for provider, count in sorted(provider_stats.items(), key=lambda item: (-item[1], item[0]))
        ],
        "recent_registrations": [core.serialize_admin_user(db, item) for item in recent_users],
        "review_queue": core.build_review_queue(db, limit=8),
    }


@router.get("/admin/api/review-queue")
def admin_review_queue(
    limit: int = Query(20, ge=1, le=100),
    _: None = Depends(core.require_admin_access),
    db: Session = Depends(core.get_db),
):
    return {
        "items": core.build_review_queue(db, limit=limit),
    }


@router.post("/admin/api/reviews/batch")
def admin_batch_review(
    payload: core.AdminReviewBatchPayload,
    admin_identity: Dict[str, str] = Depends(core.require_admin_access),
    db: Session = Depends(core.get_db),
):
    review_status = (payload.review_status or "").strip()
    if review_status not in {"approved", "rejected"}:
        raise HTTPException(status_code=400, detail="Unsupported review status")
    items = payload.items or []
    if not items:
        raise HTTPException(status_code=400, detail="No review items provided")
    note = (payload.review_note or "").strip()
    if review_status == "rejected" and not note:
        raise HTTPException(status_code=400, detail="Review note is required when rejecting")

    processed: List[Dict[str, str]] = []
    actor = admin_identity.get("actor") or core.ADMIN_DISPLAY_NAME
    for row in items:
        biz_type = (row.biz_type or "").strip()
        item_id = (row.item_id or "").strip()
        if biz_type == "service":
            item = db.query(models.Service).filter(models.Service.id == item_id).first()
            if item is None:
                continue
            core.apply_admin_service_update(item, core.AdminServiceUpdatePayload(
                review_status=review_status,
                review_note=note or ("审核通过" if review_status == "approved" else ""),
            ))
            core.append_admin_operation_log(
                db,
                actor,
                f"batch_{review_status}",
                "service",
                item.id,
                f"{actor}批量{'通过' if review_status == 'approved' else '驳回'}了服务《{item.title or item.id}》",
                note,
            )
            processed.append({"biz_type": "service", "item_id": item.id})
        elif biz_type == "experience":
            item = db.query(models.Experience).filter(models.Experience.id == item_id).first()
            if item is None:
                continue
            core.apply_admin_experience_update(item, core.AdminExperienceUpdatePayload(
                review_status=review_status,
                review_note=note or ("审核通过" if review_status == "approved" else ""),
            ))
            core.append_admin_operation_log(
                db,
                actor,
                f"batch_{review_status}",
                "experience",
                item.id,
                f"{actor}批量{'通过' if review_status == 'approved' else '驳回'}了体验《{item.title or item.id}》",
                note,
            )
            processed.append({"biz_type": "experience", "item_id": item.id})
    commit_and_refresh(db)
    return {
        "processed_count": len(processed),
        "items": processed,
    }


@router.get("/admin/api/users")
def admin_list_users(
    q: str = Query("", description="按昵称、ID、手机号搜索"),
    provider: str = Query("all"),
    verification: str = Query("all"),
    page: int = Query(1, ge=1),
    page_size: int = Query(12, ge=1, le=core.MAX_ADMIN_PAGE_SIZE),
    _: None = Depends(core.require_admin_access),
    db: Session = Depends(core.get_db),
):
    query = db.query(models.User)
    keyword = q.strip()
    if keyword:
        like = f"%{keyword}%"
        query = query.filter(or_(
            models.User.id.like(like),
            models.User.pei_pei_id.like(like),
            models.User.name.like(like),
            models.User.phone_number.like(like),
        ))
    if provider != "all":
        query = query.filter(models.User.login_provider == provider)
    if verification == "phone_verified":
        query = query.filter(models.User.is_phone_verified == True)
    elif verification == "profile_completed":
        query = query.filter(models.User.is_profile_completed == True)
    elif verification == "identity_verified":
        query = query.filter(models.User.identity_verified == True)
    elif verification == "pending_phone":
        query = query.filter(models.User.is_phone_verified == False)
    elif verification == "pending_profile":
        query = query.filter(models.User.is_profile_completed == False)

    total = query.count()
    items = query.order_by(
        desc(models.User.created_at),
        desc(models.User.updated_at)
    ).offset((page - 1) * page_size).limit(page_size).all()
    return {
        "items": [core.serialize_admin_user(db, item) for item in items],
        "total": int(total),
        "page": page,
        "page_size": page_size,
    }


@router.patch("/admin/api/users/{user_id}")
def admin_update_user(
    user_id: str,
    payload: core.AdminUserUpdatePayload,
    admin_identity: Dict[str, str] = Depends(core.require_admin_access),
    db: Session = Depends(core.get_db),
):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    core.apply_admin_user_update(user, payload)
    actor = admin_identity.get("actor") or core.ADMIN_DISPLAY_NAME
    core.append_admin_operation_log(
        db,
        actor,
        "update_user",
        "user",
        user.id,
        f"{actor}更新了用户 {user.name or user.id} 的后台状态",
        json.dumps(payload.model_dump(exclude_none=True), ensure_ascii=False),
    )
    commit_and_refresh(db, user)
    return core.serialize_admin_user(db, user)


@router.get("/admin/api/services")
def admin_list_services(
    q: str = Query("", description="按标题、ID、地点搜索"),
    status: str = Query("all"),
    category: str = Query("all"),
    page: int = Query(1, ge=1),
    page_size: int = Query(12, ge=1, le=core.MAX_ADMIN_PAGE_SIZE),
    _: None = Depends(core.require_admin_access),
    db: Session = Depends(core.get_db),
):
    query = db.query(models.Service)
    keyword = q.strip()
    if keyword:
        like = f"%{keyword}%"
        query = query.filter(or_(
            models.Service.id.like(like),
            models.Service.title.like(like),
            models.Service.category.like(like),
            models.Service.location.like(like),
        ))
    if status == "active":
        query = query.filter(
            models.Service.is_deleted == False,
            models.Service.is_draft == False,
            models.Service.review_status == "approved",
        )
    elif status == "draft":
        query = query.filter(models.Service.is_deleted == False, models.Service.is_draft == True)
    elif status == "deleted":
        query = query.filter(models.Service.is_deleted == True)
    elif status == "square":
        query = query.filter(models.Service.is_deleted == False, models.Service.sync_to_square == True)
    elif status == "important":
        query = query.filter(models.Service.is_deleted == False, models.Service.is_important == True)
    elif status == "prioritized":
        query = query.filter(models.Service.is_deleted == False, models.Service.sort_priority > 0)
    elif status == "pending_review":
        query = query.filter(models.Service.review_status == "pending_review", models.Service.is_deleted == False)
    elif status == "approved":
        query = query.filter(models.Service.review_status == "approved", models.Service.is_deleted == False)
    elif status == "rejected":
        query = query.filter(models.Service.review_status == "rejected", models.Service.is_deleted == False)
    if category != "all":
        query = query.filter(models.Service.category == category)

    total = query.count()
    items = query.order_by(
        desc(models.Service.sort_priority),
        desc(models.Service.is_important),
        desc(models.Service.updated_at),
        desc(models.Service.created_at)
    ).offset((page - 1) * page_size).limit(page_size).all()
    return {
        "items": [core.serialize_admin_service(db, item) for item in items],
        "total": int(total),
        "page": page,
        "page_size": page_size,
    }


@router.get("/admin/api/services/{service_id}")
def admin_get_service_detail(
    service_id: str,
    _: Dict[str, str] = Depends(core.require_admin_access),
    db: Session = Depends(core.get_db),
):
    item = db.query(models.Service).filter(models.Service.id == service_id).first()
    if item is None:
        raise HTTPException(status_code=404, detail="Service not found")
    return core.serialize_admin_service(db, item)


@router.patch("/admin/api/services/{service_id}")
def admin_update_service(
    service_id: str,
    payload: core.AdminServiceUpdatePayload,
    admin_identity: Dict[str, str] = Depends(core.require_admin_access),
    db: Session = Depends(core.get_db),
):
    item = db.query(models.Service).filter(models.Service.id == service_id).first()
    if item is None:
        raise HTTPException(status_code=404, detail="Service not found")
    core.apply_admin_service_update(item, payload)
    actor = admin_identity.get("actor") or core.ADMIN_DISPLAY_NAME
    core.append_admin_operation_log(
        db,
        actor,
        "update_service",
        "service",
        item.id,
        f"{actor}更新了服务《{item.title or item.id}》",
        json.dumps(payload.model_dump(exclude_none=True), ensure_ascii=False),
    )
    commit_and_refresh(db, item)
    return core.serialize_admin_service(db, item)


@router.get("/admin/api/experiences")
def admin_list_experiences(
    q: str = Query("", description="按标题、ID、地点搜索"),
    status: str = Query("all"),
    category: str = Query("all"),
    page: int = Query(1, ge=1),
    page_size: int = Query(12, ge=1, le=core.MAX_ADMIN_PAGE_SIZE),
    _: None = Depends(core.require_admin_access),
    db: Session = Depends(core.get_db),
):
    query = db.query(models.Experience)
    keyword = q.strip()
    if keyword:
        like = f"%{keyword}%"
        query = query.filter(or_(
            models.Experience.id.like(like),
            models.Experience.title.like(like),
            models.Experience.category.like(like),
            models.Experience.location.like(like),
        ))
    if status == "active":
        query = query.filter(models.Experience.is_deleted == False, models.Experience.review_status == "approved")
    elif status == "deleted":
        query = query.filter(models.Experience.is_deleted == True)
    elif status == "pending_review":
        query = query.filter(models.Experience.review_status == "pending_review", models.Experience.is_deleted == False)
    elif status == "approved":
        query = query.filter(models.Experience.review_status == "approved", models.Experience.is_deleted == False)
    elif status == "rejected":
        query = query.filter(models.Experience.review_status == "rejected", models.Experience.is_deleted == False)
    if category != "all":
        query = query.filter(models.Experience.category == category)

    total = query.count()
    items = query.order_by(
        desc(models.Experience.updated_at),
        desc(models.Experience.created_at)
    ).offset((page - 1) * page_size).limit(page_size).all()
    return {
        "items": [core.serialize_admin_experience(db, item) for item in items],
        "total": int(total),
        "page": page,
        "page_size": page_size,
    }


@router.get("/admin/api/experiences/{experience_id}")
def admin_get_experience_detail(
    experience_id: str,
    _: Dict[str, str] = Depends(core.require_admin_access),
    db: Session = Depends(core.get_db),
):
    item = db.query(models.Experience).filter(models.Experience.id == experience_id).first()
    if item is None:
        raise HTTPException(status_code=404, detail="Experience not found")
    return core.serialize_admin_experience(db, item)


@router.patch("/admin/api/experiences/{experience_id}")
def admin_update_experience(
    experience_id: str,
    payload: core.AdminExperienceUpdatePayload,
    admin_identity: Dict[str, str] = Depends(core.require_admin_access),
    db: Session = Depends(core.get_db),
):
    item = db.query(models.Experience).filter(models.Experience.id == experience_id).first()
    if item is None:
        raise HTTPException(status_code=404, detail="Experience not found")
    core.apply_admin_experience_update(item, payload)
    actor = admin_identity.get("actor") or core.ADMIN_DISPLAY_NAME
    core.append_admin_operation_log(
        db,
        actor,
        "update_experience",
        "experience",
        item.id,
        f"{actor}更新了体验《{item.title or item.id}》",
        json.dumps(payload.model_dump(exclude_none=True), ensure_ascii=False),
    )
    commit_and_refresh(db, item)
    return core.serialize_admin_experience(db, item)


@router.get("/admin/api/feedbacks")
def admin_list_feedbacks(
    q: str = Query("", description="按内容、用户、联系方式搜索"),
    status: str = Query("all"),
    category: str = Query("all"),
    page: int = Query(1, ge=1),
    page_size: int = Query(12, ge=1, le=core.MAX_ADMIN_PAGE_SIZE),
    _: None = Depends(core.require_admin_access),
    db: Session = Depends(core.get_db),
):
    query = db.query(models.Feedback)
    keyword = q.strip()
    if keyword:
        like = f"%{keyword}%"
        query = query.filter(or_(
            models.Feedback.content.like(like),
            models.Feedback.user_name.like(like),
            models.Feedback.phone_number.like(like),
            models.Feedback.contact.like(like),
            models.Feedback.id.like(like),
        ))
    if status != "all":
        query = query.filter(models.Feedback.status == status)
    if category != "all":
        query = query.filter(models.Feedback.category == category)

    total = query.count()
    items = query.order_by(
        desc(models.Feedback.created_at),
        desc(models.Feedback.updated_at)
    ).offset((page - 1) * page_size).limit(page_size).all()
    return {
        "items": [core.serialize_admin_feedback(item) for item in items],
        "total": int(total),
        "page": page,
        "page_size": page_size,
    }


@router.patch("/admin/api/feedbacks/{feedback_id}")
def admin_update_feedback(
    feedback_id: str,
    payload: core.AdminFeedbackUpdatePayload,
    admin_identity: Dict[str, str] = Depends(core.require_admin_access),
    db: Session = Depends(core.get_db),
):
    item = db.query(models.Feedback).filter(models.Feedback.id == feedback_id).first()
    if item is None:
        raise HTTPException(status_code=404, detail="Feedback not found")
    core.apply_admin_feedback_update(item, payload)
    actor = admin_identity.get("actor") or core.ADMIN_DISPLAY_NAME
    core.append_admin_operation_log(
        db,
        actor,
        "update_feedback",
        "feedback",
        item.id,
        f"{actor}更新了反馈 {item.id} 的处理状态",
        json.dumps(payload.model_dump(exclude_none=True), ensure_ascii=False),
    )
    commit_and_refresh(db, item)
    return core.serialize_admin_feedback(item)


@router.get("/admin/api/operation-logs")
def admin_list_operation_logs(
    page: int = Query(1, ge=1),
    page_size: int = Query(12, ge=1, le=core.MAX_ADMIN_PAGE_SIZE),
    _: Dict[str, str] = Depends(core.require_admin_access),
    db: Session = Depends(core.get_db),
):
    query = db.query(models.AdminOperationLog)
    total = query.count()
    items = query.order_by(desc(models.AdminOperationLog.created_at)).offset((page - 1) * page_size).limit(page_size).all()
    return {
        "items": [core.serialize_admin_operation_log(item) for item in items],
        "total": int(total),
        "page": page,
        "page_size": page_size,
    }

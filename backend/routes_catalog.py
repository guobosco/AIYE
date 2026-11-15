from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import desc
from typing import List, Optional
import time
from datetime import date
from sqlalchemy.exc import IntegrityError
try:
    from . import core
    from .errors import commit_and_refresh
    from .experience_rating import compute_experience_rating_for_host
    from .core import models, schemas
    from .consultation_service import hidden_hosts
except ImportError:
    import core
    from errors import commit_and_refresh
    from experience_rating import compute_experience_rating_for_host
    from core import models, schemas
    from consultation_service import hidden_hosts

router = APIRouter()

@router.post("/services/", response_model=schemas.Service)
def create_service(
    service: schemas.ServiceCreate,
    db: Session = Depends(core.get_db),
    current_user: models.User = Depends(core.get_current_user)
):
    core.ensure_field_matches_current_user(current_user, service.creator_id, "creator_id")
    db_item = models.Service(**service.model_dump())
    db_item.sort_priority = 0
    core.apply_owner_service_review_state(db_item)
    db.add(db_item)
    commit_and_refresh(db, db_item)
    return db_item


@router.put("/services/{service_id}", response_model=schemas.Service)
def update_service(
    service_id: str,
    service: schemas.ServiceCreate,
    db: Session = Depends(core.get_db),
    current_user: models.User = Depends(core.get_current_user)
):
    db_item = db.query(models.Service).filter(
        models.Service.id == service_id
    ).first()
    if db_item is None:
        raise HTTPException(status_code=404, detail="Service not found")
    core.ensure_record_owner(db_item, current_user, "creator_id")
    core.ensure_field_matches_current_user(current_user, service.creator_id, "creator_id")
    update_data = service.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        if key in {"id", "creator_id", "created_at", "sort_priority"}:
            continue
        setattr(db_item, key, value)
    db_item.record_hidden = False
    core.apply_owner_service_review_state(db_item)
    db_item.updated_at = int(time.time() * 1000)

    commit_and_refresh(db, db_item)
    return db_item


@router.get("/services/", response_model=List[schemas.Service])
def read_services(
    user_id: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=200),
    db: Session = Depends(core.get_db),
    current_user: models.User = Depends(core.get_current_user)
):
    owner_id = core.ensure_optional_self_access(current_user, user_id)
    query = db.query(models.Service).filter(
        models.Service.creator_id == owner_id, models.Service.record_hidden == False
    )
    return query.order_by(desc(models.Service.updated_at), desc(models.Service.created_at)).offset(skip).limit(limit).all()


@router.get("/services/discovery", response_model=List[schemas.Service])
def list_square_discovery_services(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=200),
    updated_after: Optional[int] = Query(None, ge=0),
    db: Session = Depends(core.get_db),
    viewer=Depends(core.get_optional_current_user),
):
    """
    广场发现：全站未删除的服务（按更新时间倒序）。
    与客户端「发现」瀑布流一致；是否仅展示「同步到广场」可由后续产品开关再收紧。
    不强制登录：客户端冷启动本地 demo 用户尚未拿 token 时也能拉首屏；本接口不按用户过滤。
    必须声明在 /services/{service_id} 之前，避免 path 将 discovery 解析为 id。
    """
    query = db.query(models.Service).filter(
        models.Service.is_deleted == False,
        models.Service.is_draft == False,
        models.Service.review_status == "approved",
    )
    hidden = hidden_hosts(db, viewer)
    if hidden:
        query = query.filter(models.Service.creator_id.notin_(hidden))
    if updated_after is not None:
        query = query.filter(models.Service.updated_at > updated_after)
    items = (
        query.order_by(
            desc(models.Service.sort_priority),
            desc(models.Service.is_important),
            desc(models.Service.updated_at),
            desc(models.Service.created_at)
        )
        .offset(skip)
        .limit(limit)
        .all()
    )
    return items


@router.get("/services/{service_id}", response_model=schemas.Service)
def read_service_detail(
    service_id: str,
    db: Session = Depends(core.get_db),
    current_user: Optional[models.User] = Depends(core.get_optional_current_user)
):
    db_item = db.query(models.Service).filter(models.Service.id == service_id).first()
    if db_item is None:
        raise HTTPException(status_code=404, detail="Service not found")
    if not core.can_view_service(db_item, current_user):
        raise HTTPException(status_code=404, detail="Service not found")
    return db_item


@router.delete("/services/{service_id}", response_model=schemas.Service)
def delete_service(
    service_id: str,
    db: Session = Depends(core.get_db),
    current_user: models.User = Depends(core.get_current_user)
):
    db_item = db.query(models.Service).filter(models.Service.id == service_id).first()
    if db_item is None:
        raise HTTPException(status_code=404, detail="Service not found")
    core.ensure_record_owner(db_item, current_user, "creator_id")
    db_item.is_deleted = True
    db_item.review_status = "rejected"
    db_item.updated_at = int(time.time() * 1000)
    commit_and_refresh(db, db_item)
    return db_item


@router.delete("/services/{service_id}/record")
def hide_service_record(service_id: str, db: Session = Depends(core.get_db),
                        current_user: models.User = Depends(core.get_current_user)):
    item = db.get(models.Service, service_id)
    if item is None:
        raise HTTPException(404, "Service not found")
    core.ensure_record_owner(item, current_user, "creator_id")
    if not item.is_deleted and not item.is_draft:
        raise HTTPException(409, "Cancel publication before hiding its record")
    item.record_hidden = True
    db.commit()
    return {"hidden": True}


@router.get("/services/{service_id}/calendar", response_model=schemas.CalendarResponse)
def read_calendar(service_id: str, db: Session = Depends(core.get_db),
                  current_user: Optional[models.User] = Depends(core.get_optional_current_user)):
    item = db.get(models.Service, service_id)
    if item is None or not core.can_view_service(item, current_user):
        raise HTTPException(404, "Service not found")
    rows = db.query(models.CalendarClosure).filter_by(service_id=service_id).all()
    return {"days": {row.day: {
        "allDay": row.all_day, "start": row.start, "end": row.end,
        "version": row.version, "active": row.active,
    } for row in rows}}


@router.put("/services/{service_id}/calendar/{day}", response_model=schemas.CalendarDay)
def save_calendar_day(service_id: str, day: str, payload: schemas.CalendarDay,
                      db: Session = Depends(core.get_db),
                      current_user: models.User = Depends(core.get_current_user)):
    try:
        if date.fromisoformat(day).isoformat() != day:
            raise ValueError()
    except ValueError:
        raise HTTPException(422, "Use an ISO calendar date")
    item = db.get(models.Service, service_id)
    if item is None:
        raise HTTPException(404, "Service not found")
    core.ensure_record_owner(item, current_user, "creator_id")
    key = f"{service_id}:{day}"
    row = db.get(models.CalendarClosure, key)
    if row is None:
        if payload.version != 0:
            raise HTTPException(409, "Calendar changed; reload before saving")
        row = models.CalendarClosure(
            id=key, service_id=service_id, day=day, all_day=payload.allDay,
            start=payload.start, end=payload.end, active=payload.active, version=1,
        )
        db.add(row)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            raise HTTPException(409, "Calendar changed; reload before saving")
    else:
        changed = db.query(models.CalendarClosure).filter_by(
            id=key, version=payload.version
        ).update({
            "all_day": payload.allDay, "start": payload.start, "end": payload.end,
            "active": payload.active, "version": payload.version + 1,
        }, synchronize_session=False)
        if not changed:
            db.rollback()
            raise HTTPException(409, "Calendar changed; reload before saving")
        db.commit()
        db.refresh(row)
    return {"allDay": row.all_day, "start": row.start, "end": row.end,
            "active": row.active, "version": row.version}


@router.post("/experiences/", response_model=schemas.Experience)
def create_experience(
    experience: schemas.ExperienceCreate,
    db: Session = Depends(core.get_db),
    current_user: models.User = Depends(core.get_current_user)
):
    core.ensure_field_matches_current_user(current_user, experience.host_id, "host_id")
    db_item = models.Experience(**experience.model_dump())
    db_item.average_rating = compute_experience_rating_for_host(db, experience.host_id)
    core.apply_owner_experience_review_state(db_item)
    db.add(db_item)
    commit_and_refresh(db, db_item)
    return db_item


@router.put("/experiences/{experience_id}", response_model=schemas.Experience)
def update_experience(
    experience_id: str,
    experience: schemas.ExperienceCreate,
    db: Session = Depends(core.get_db),
    current_user: models.User = Depends(core.get_current_user)
):
    db_item = db.query(models.Experience).filter(
        models.Experience.id == experience_id
    ).first()
    if db_item is None:
        raise HTTPException(status_code=404, detail="Experience not found")
    core.ensure_record_owner(db_item, current_user, "host_id")
    core.ensure_field_matches_current_user(current_user, experience.host_id, "host_id")
    update_data = experience.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        if key in {"id", "host_id", "created_at"}:
            continue
        setattr(db_item, key, value)
    db_item.record_hidden = False
    db_item.average_rating = compute_experience_rating_for_host(db, experience.host_id)
    core.apply_owner_experience_review_state(db_item)
    db_item.updated_at = int(time.time() * 1000)

    commit_and_refresh(db, db_item)
    return db_item


@router.get("/experiences/", response_model=List[schemas.Experience])
def read_experiences(
    user_id: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=200),
    db: Session = Depends(core.get_db),
    current_user: models.User = Depends(core.get_current_user)
):
    owner_id = core.ensure_optional_self_access(current_user, user_id)
    query = db.query(models.Experience).filter(models.Experience.record_hidden == False)
    if owner_id:
        query = query.filter(models.Experience.host_id == owner_id)
    return query.order_by(desc(models.Experience.updated_at), desc(models.Experience.created_at)).offset(skip).limit(limit).all()


@router.get("/experiences/discovery", response_model=List[schemas.Experience])
def list_square_discovery_experiences(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=200),
    updated_after: Optional[int] = Query(None, ge=0),
    db: Session = Depends(core.get_db),
    viewer=Depends(core.get_optional_current_user),
):
    query = db.query(models.Experience).filter(
        models.Experience.is_deleted == False,
        models.Experience.is_draft == False,
        models.Experience.review_status == "approved",
    )
    hidden = hidden_hosts(db, viewer)
    if hidden:
        query = query.filter(models.Experience.host_id.notin_(hidden))
    if updated_after is not None:
        query = query.filter(models.Experience.updated_at > updated_after)
    return (
        query.order_by(desc(models.Experience.updated_at), desc(models.Experience.created_at))
        .offset(skip)
        .limit(limit)
        .all()
    )


@router.get("/experiences/{experience_id}", response_model=schemas.Experience)
def read_experience_detail(
    experience_id: str,
    db: Session = Depends(core.get_db),
    current_user: Optional[models.User] = Depends(core.get_optional_current_user)
):
    db_item = db.query(models.Experience).filter(
        models.Experience.id == experience_id
    ).first()
    if db_item is None:
        raise HTTPException(status_code=404, detail="Experience not found")
    if not core.can_view_experience(db_item, current_user):
        raise HTTPException(status_code=404, detail="Experience not found")
    return db_item


@router.delete("/experiences/{experience_id}", response_model=schemas.Experience)
def delete_experience(
    experience_id: str,
    db: Session = Depends(core.get_db),
    current_user: models.User = Depends(core.get_current_user)
):
    db_item = db.query(models.Experience).filter(models.Experience.id == experience_id).first()
    if db_item is None:
        raise HTTPException(status_code=404, detail="Experience not found")
    core.ensure_record_owner(db_item, current_user, "host_id")
    db_item.is_deleted = True
    db_item.review_status = "rejected"
    db_item.updated_at = int(time.time() * 1000)
    commit_and_refresh(db, db_item)
    return db_item


@router.delete("/experiences/{experience_id}/record")
def hide_experience_record(experience_id: str, db: Session = Depends(core.get_db),
                           current_user: models.User = Depends(core.get_current_user)):
    item = db.get(models.Experience, experience_id)
    if item is None:
        raise HTTPException(404, "Experience not found")
    core.ensure_record_owner(item, current_user, "host_id")
    if not item.is_deleted and not item.is_draft:
        raise HTTPException(409, "Cancel publication before hiding its record")
    item.record_hidden = True
    db.commit()
    return {"hidden": True}

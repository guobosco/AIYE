from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import desc
from typing import List, Optional
import time
try:
    from . import core
    from .errors import commit_and_refresh
    from .experience_rating import compute_experience_rating_for_host
    from .core import models, schemas
except ImportError:
    import core
    from errors import commit_and_refresh
    from experience_rating import compute_experience_rating_for_host
    from core import models, schemas

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
    query = db.query(models.Service).filter(models.Service.creator_id == owner_id)
    return query.order_by(desc(models.Service.updated_at), desc(models.Service.created_at)).offset(skip).limit(limit).all()


@router.get("/services/discovery", response_model=List[schemas.Service])
def list_square_discovery_services(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=200),
    updated_after: Optional[int] = Query(None, ge=0),
    db: Session = Depends(core.get_db),
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
        models.Experience.id == experience_id,
        models.Experience.is_deleted == False
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
    query = db.query(models.Experience).filter(models.Experience.is_deleted == False)
    if owner_id:
        query = query.filter(models.Experience.host_id == owner_id)
    return query.order_by(desc(models.Experience.updated_at), desc(models.Experience.created_at)).offset(skip).limit(limit).all()


@router.get("/experiences/discovery", response_model=List[schemas.Experience])
def list_square_discovery_experiences(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=200),
    updated_after: Optional[int] = Query(None, ge=0),
    db: Session = Depends(core.get_db),
):
    query = db.query(models.Experience).filter(
        models.Experience.is_deleted == False,
        models.Experience.review_status == "approved",
    )
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

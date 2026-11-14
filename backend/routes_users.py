from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import or_, desc
from typing import List, Optional
import time
try:
    from . import core
    from .errors import commit_and_refresh
    from .core import models, schemas, accounts
except ImportError:
    import core
    from errors import commit_and_refresh
    from core import models, schemas, accounts

router = APIRouter()

@router.get("/users/search", response_model=schemas.User)
def search_user(query: str, db: Session = Depends(core.get_db), current_user: models.User = Depends(core.get_current_user)):
    """
    根据手机号或lulu号搜索用户
    """
    user = db.query(models.User).filter(
        or_(models.User.phone_number == query, models.User.pei_pei_id == query)
    ).first()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return core.user_schema_for_viewer(db, user, current_user.id, expose_phone=(query == user.phone_number))


@router.post("/users/match_contacts", response_model=List[schemas.User])
def match_contacts(request: schemas.ContactMatchRequest, db: Session = Depends(core.get_db), current_user: models.User = Depends(core.get_current_user)):
    """
    批量匹配通讯录中的手机号
    """
    if not request.phone_numbers:
        return []
        
    # Query all users where phone_number is in the provided list
    users = db.query(models.User).filter(
        models.User.phone_number.in_(request.phone_numbers)
    ).all()
    
    return core.user_schemas_for_viewer(db, users, current_user.id, expose_phone=True)


@router.get("/users/discovery", response_model=List[schemas.User])
def discovery_users(
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(core.get_db),
    current_user: models.User = Depends(core.get_current_user)
):
    users = db.query(models.User).filter(
        models.User.id != current_user.id
    ).order_by(desc(models.User.updated_at), desc(models.User.created_at)).limit(limit).all()
    return core.user_schemas_for_viewer(db, users, current_user.id)


@router.get("/users/{user_id}", response_model=schemas.User)
def read_user(
    user_id: str,
    db: Session = Depends(core.get_db),
    current_user: Optional[models.User] = Depends(core.get_optional_current_user),
):
    """
    根据用户 ID 获取用户信息。
    允许匿名访问：与 /services/discovery 一致，冷启动仅有本地 demo 用户、尚未拿 token 时仍可打开他人主页。
    """
    db_user = db.query(models.User).filter(models.User.id == user_id).first()
    if db_user is None:
        raise HTTPException(status_code=404, detail="User not found")
    viewer_id = current_user.id if current_user is not None else ""
    return core.user_schema_for_viewer(db, db_user, viewer_id)


@router.put("/users/{user_id}", response_model=schemas.User)
def update_user(user_id: str, user: schemas.UserUpdate, db: Session = Depends(core.get_db), current_user: models.User = Depends(core.get_current_user)):
    """
    更新用户信息
    """
    core.ensure_self_access(current_user, user_id)
    if user.id is not None and user.id != user_id:
        raise HTTPException(status_code=400, detail="User ID mismatch")
    db_user = db.query(models.User).filter(models.User.id == user_id).first()
    if db_user is None:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Update fields
    user_data = user.model_dump(exclude_unset=True)
    # Filter out fields that shouldn't be updated directly via this endpoint if any
    # e.g., hashed_password usually via separate endpoint, but here User schema might not have it
    
    for key, value in user_data.items():
        # Skip id and other immutable fields if necessary
        if key not in accounts.PROFILE_FIELDS:
            continue
        setattr(db_user, key, value)
    
    db_user.updated_at = int(time.time() * 1000)
    
    commit_and_refresh(db, db_user)
        
    return core.hydrate_user_profile_metrics(db, db_user)

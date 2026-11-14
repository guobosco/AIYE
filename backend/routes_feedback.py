from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import desc
from typing import List, Optional
import uuid
try:
    from . import core
    from .errors import commit_and_refresh
    from .core import models, schemas
except ImportError:
    import core
    from errors import commit_and_refresh
    from core import models, schemas

router = APIRouter()

@router.post("/feedbacks", response_model=schemas.Feedback)
def create_feedback(
    payload: schemas.FeedbackCreate,
    db: Session = Depends(core.get_db),
    current_user: Optional[models.User] = Depends(core.get_optional_current_user),
):
    content = (payload.content or "").strip()
    if not content:
        raise HTTPException(status_code=400, detail="Feedback content is required")
    now = core.current_millis()
    item = models.Feedback(
        id=str(uuid.uuid4()),
        user_id=current_user.id if current_user else None,
        user_name=(current_user.name if current_user else "") or "",
        phone_number=(current_user.phone_number if current_user else "") or "",
        source=(payload.source or "app").strip() or "app",
        category=(payload.category or "general").strip() or "general",
        content=content,
        contact=(payload.contact or "").strip(),
        status="pending",
        admin_note="",
        created_at=now,
        updated_at=now,
        handled_at=0,
    )
    db.add(item)
    commit_and_refresh(db, item)
    return item


@router.get("/me/feedbacks", response_model=List[schemas.Feedback])
def list_my_feedbacks(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=200),
    db: Session = Depends(core.get_db),
    current_user: models.User = Depends(core.get_current_user),
):
    items = db.query(models.Feedback).filter(
        models.Feedback.user_id == current_user.id
    ).order_by(desc(models.Feedback.created_at), desc(models.Feedback.updated_at),
               desc(models.Feedback.id)).offset(skip).limit(limit).all()
    return items

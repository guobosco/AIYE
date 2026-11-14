from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
import time
try:
    from . import core
    from .errors import commit_and_refresh
    from .core import models, schemas
except ImportError:
    import core
    from errors import commit_and_refresh
    from core import models, schemas

router = APIRouter()

@router.get("/me/wishlist/services", response_model=schemas.FavoriteServicesResponse)
def get_my_favorite_services(current_user: models.User = Depends(core.get_current_user)):
    return schemas.FavoriteServicesResponse(service_ids=current_user.favorite_service_ids or [])


@router.get("/me/wishlist/profile", response_model=schemas.WishlistProfileResponse)
def get_my_wishlist_profile(
    db: Session = Depends(core.get_db),
    current_user: models.User = Depends(core.get_current_user)
):
    return core._load_wishlist_profile(db, current_user)


@router.put("/me/wishlist/services", response_model=schemas.FavoriteServicesResponse)
def update_my_favorite_services(
    payload: schemas.FavoriteServicesUpdateRequest,
    db: Session = Depends(core.get_db),
    current_user: models.User = Depends(core.get_current_user)
):
    response = core._persist_wishlist_profile(db, current_user, payload.service_ids)
    commit_and_refresh(db, current_user)
    return schemas.FavoriteServicesResponse(service_ids=response.service_ids)


@router.get("/me/wishlist/experiences", response_model=schemas.FavoriteExperiencesResponse)
def get_my_favorite_experiences(current_user: models.User = Depends(core.get_current_user)):
    return schemas.FavoriteExperiencesResponse(
        experience_ids=core._dedupe_non_empty_ids(current_user.favorite_experience_ids or [])
    )


@router.put("/me/wishlist/experiences", response_model=schemas.FavoriteExperiencesResponse)
def update_my_favorite_experiences(
    payload: schemas.FavoriteExperiencesUpdateRequest,
    db: Session = Depends(core.get_db),
    current_user: models.User = Depends(core.get_current_user)
):
    normalized_experience_ids = core._filter_existing_experience_ids(db, payload.experience_ids)
    current_user.favorite_experience_ids = normalized_experience_ids
    current_user.updated_at = int(time.time() * 1000)
    commit_and_refresh(db, current_user)
    return schemas.FavoriteExperiencesResponse(experience_ids=normalized_experience_ids)


@router.put("/me/wishlist/profile", response_model=schemas.WishlistProfileResponse)
def update_my_wishlist_profile(
    payload: schemas.WishlistProfileUpdateRequest,
    db: Session = Depends(core.get_db),
    current_user: models.User = Depends(core.get_current_user)
):
    response = core._persist_wishlist_profile(db, current_user, payload.service_ids, payload.groups)
    commit_and_refresh(db, current_user)
    return response

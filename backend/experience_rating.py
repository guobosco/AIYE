from __future__ import annotations

from typing import Optional

from sqlalchemy.orm import Session

try:
    from . import models
except ImportError:
    import models


EXPERIENCE_RATING_PRIOR_MEAN = 4.70
EXPERIENCE_RATING_PRIOR_COUNT = 8
EXPERIENCE_RATING_MAX = 5.0


def _clamp_rating(value: float) -> float:
    return max(0.0, min(EXPERIENCE_RATING_MAX, value))


def compute_classic_five_point_rating(
    average_rating: Optional[float],
    review_count: Optional[int],
    prior_mean: float = EXPERIENCE_RATING_PRIOR_MEAN,
    prior_count: int = EXPERIENCE_RATING_PRIOR_COUNT,
) -> float:
    mean = _clamp_rating(float(average_rating or 0.0))
    count = max(int(review_count or 0), 0)
    if mean <= 0.0 or count <= 0:
        return 0.0

    weighted = ((count * mean) + (prior_count * prior_mean)) / (count + prior_count)
    return round(_clamp_rating(weighted), 2)


def compute_experience_rating_for_host(
    db: Session,
    host_id: str,
    *,
    prior_mean: float = EXPERIENCE_RATING_PRIOR_MEAN,
    prior_count: int = EXPERIENCE_RATING_PRIOR_COUNT,
) -> float:
    normalized_host_id = (host_id or "").strip()
    if not normalized_host_id:
        return 0.0

    host_user = (
        db.query(models.User.average_rating, models.User.review_count)
        .filter(models.User.id == normalized_host_id)
        .first()
    )
    if host_user is None:
        return 0.0

    return compute_classic_five_point_rating(
        average_rating=host_user.average_rating,
        review_count=host_user.review_count,
        prior_mean=prior_mean,
        prior_count=prior_count,
    )

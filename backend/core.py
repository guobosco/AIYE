from fastapi import Depends, HTTPException, UploadFile, Request, Header
from sqlalchemy.orm import Session
from sqlalchemy import desc, func
from typing import Dict, List, Optional, Union
from pydantic import BaseModel
import time
import uuid
import json
import random
import bcrypt
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from datetime import datetime, timedelta, date
import os
from urllib.parse import urlencode
from urllib.request import urlopen
try:
    from . import models, schemas
except ImportError:
    import models, schemas
try:
    from .database import SessionLocal
except ImportError:
    from database import SessionLocal
try:
    from .chat_realtime import ChatRealtimeHub
except ImportError:
    from chat_realtime import ChatRealtimeHub
try:
    from . import account_security as accounts
except ImportError:
    import account_security as accounts

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.abspath(os.getenv("LULU_STATIC_DIR") or os.path.join(BASE_DIR, "static"))
ADMIN_WEB_DIR = os.path.abspath(
    os.getenv("LULU_ADMIN_WEB_DIR") or os.path.join(os.path.dirname(BASE_DIR), "admin_web")
)
ADMIN_INDEX_PATH = os.path.join(ADMIN_WEB_DIR, "index.html")
AVATAR_DIR = os.path.join(STATIC_DIR, "avatars")
CHAT_MEDIA_DIR = os.path.join(STATIC_DIR, "chat")
SERVICE_MEDIA_DIR = os.path.join(STATIC_DIR, "services")
EXPERIENCE_MEDIA_DIR = os.path.join(STATIC_DIR, "experiences")
MAX_UPLOAD_SIZE_BYTES = int(os.getenv("LULU_MAX_UPLOAD_SIZE_MB", "10")) * 1024 * 1024
MAX_ADMIN_PAGE_SIZE = 100
MEDIA_BIZ_TO_DIR = {
    "avatar": AVATAR_DIR,
    "service": SERVICE_MEDIA_DIR,
    "experience": EXPERIENCE_MEDIA_DIR,
    "chat": CHAT_MEDIA_DIR,
}
APP_ENV = os.getenv("LULU_ENV", "development").lower()
ADMIN_TOKEN = os.getenv("LULU_ADMIN_TOKEN", "").strip()
ADMIN_USERNAME = os.getenv("LULU_ADMIN_USERNAME", "admin").strip()
ADMIN_PASSWORD = os.getenv("LULU_ADMIN_PASSWORD", "").strip()
ADMIN_DISPLAY_NAME = os.getenv("LULU_ADMIN_DISPLAY_NAME", "平台管理员").strip() or "平台管理员"
ADMIN_SESSION_EXPIRE_HOURS = max(int(os.getenv("LULU_ADMIN_SESSION_EXPIRE_HOURS", "72")), 1)
WECHAT_APP_ID = os.getenv("LULU_WECHAT_APP_ID", "").strip()
WECHAT_APP_SECRET = os.getenv("LULU_WECHAT_APP_SECRET", "").strip()
chat_hub = ChatRealtimeHub()

def verify_password(plain_password, hashed_password):
    try:
        return bcrypt.checkpw(plain_password.encode('utf-8'), hashed_password.encode('utf-8'))
    except ValueError:
        return False

def get_password_hash(password):
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(password.encode('utf-8'), salt)
    return hashed.decode('utf-8')

# JWT 配置
SECRET_KEY = os.getenv("LULU_SECRET_KEY", "dev-secret")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = accounts.ACCESS_MINUTES
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/token")
# 与广场发现流一致：无 token 时不报错，供公开读接口（如他人资料）使用
oauth2_scheme_optional = OAuth2PasswordBearer(tokenUrl="/auth/token", auto_error=False)

if APP_ENV == "production" and SECRET_KEY == "dev-secret":
    raise RuntimeError("LULU_SECRET_KEY must be set in production")
if ACCESS_TOKEN_EXPIRE_MINUTES < 0:
    raise RuntimeError("LULU_ACCESS_TOKEN_EXPIRE_MINUTES must be >= 0")

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    expire_delta = expires_delta
    if expire_delta is None and ACCESS_TOKEN_EXPIRE_MINUTES > 0:
        expire_delta = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    if expire_delta is not None:
        expire = datetime.utcnow() + expire_delta
        to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def current_millis() -> int:
    return int(time.time() * 1000)


def normalize_mobile_platform(platform: str) -> str:
    normalized = (platform or "").strip().lower()
    if normalized not in {"android", "ios"}:
        raise HTTPException(status_code=400, detail="Unsupported mobile platform")
    return normalized


def generate_pei_pei_id(db: Session, prefix: str = "pp") -> str:
    for _ in range(20):
        candidate = f"{prefix}_{random.randint(100000, 999999)}"
        exists = db.query(models.User).filter(models.User.pei_pei_id == candidate).first()
        if exists is None:
            return candidate
    return f"{prefix}_{uuid.uuid4().hex[:8]}"


def build_auth_session_response(
    db: Session,
    user: models.User,
    need_bind_phone: bool,
    is_new_user: bool = False
) -> schemas.AuthSessionResponse:
    tokens = accounts.issue_session(db, user)
    return schemas.AuthSessionResponse(
        **tokens,
        user=schemas.User.model_validate(hydrate_user_profile_metrics(db, user), from_attributes=True),
        need_bind_phone=need_bind_phone,
        is_new_user=is_new_user,
    )


def exchange_wechat_mobile_code(code: str, platform: str) -> dict:
    if (code or "").strip().startswith("debug_wechat_"):
        raise HTTPException(status_code=400, detail="Debug WeChat identities are disabled")
    if not WECHAT_APP_ID or not WECHAT_APP_SECRET:
        raise HTTPException(status_code=503, detail="WeChat mobile auth is not configured")
    query = urlencode({
        "appid": WECHAT_APP_ID,
        "secret": WECHAT_APP_SECRET,
        "code": code,
        "grant_type": "authorization_code",
    })
    url = f"https://api.weixin.qq.com/sns/oauth2/access_token?{query}"
    try:
        with urlopen(url, timeout=8) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except Exception:
        raise HTTPException(status_code=502, detail="WeChat auth request failed")
    if payload.get("errcode"):
        raise HTTPException(
            status_code=400,
            detail=f"WeChat auth failed: {payload.get('errmsg') or payload['errcode']}"
        )
    openid = (payload.get("openid") or "").strip()
    if not openid:
        raise HTTPException(status_code=400, detail="WeChat auth failed: missing openid")
    return {
        "openid": openid,
        "unionid": (payload.get("unionid") or "").strip() or None,
        "nickname": "",
    }

# 数据库依赖项 (Dependency)
# 用于在请求处理期间获取数据库会话，并在请求结束时关闭会话
def get_db():
    db = SessionLocal()
    try:
        yield db
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

def get_current_user(request: Request, token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    _, user = accounts.resolve_session(db, token)
    if not user.is_phone_verified and not (
        request.url.path.startswith("/auth/")
        or request.url.path == f"/users/{user.id}"
    ):
        raise HTTPException(403, "Verified phone required; complete phone binding")
    return user


def get_optional_current_user(
    token: Optional[str] = Depends(oauth2_scheme_optional),
    db: Session = Depends(get_db),
) -> Optional[models.User]:
    """已登录则返回用户；无 token 或无效 token 时返回 None（用于公开只读接口）。"""
    if not token:
        return None
    try:
        _, user = accounts.resolve_session(db, token)
        return user
    except HTTPException:
        return None


def ensure_self_access(current_user: models.User, user_id: str):
    if current_user.id != user_id:
        raise HTTPException(status_code=403, detail="Not authorized to access this user")

def ensure_optional_self_access(current_user: models.User, user_id: Optional[str]) -> str:
    if user_id is None:
        return current_user.id
    ensure_self_access(current_user, user_id)
    return user_id

def ensure_field_matches_current_user(current_user: models.User, field_value: Optional[str], field_name: str = "user_id"):
    if field_value is None or field_value != current_user.id:
        raise HTTPException(status_code=403, detail=f"{field_name} does not match current user")

def ensure_record_owner(record, current_user: models.User, owner_field: str = "user_id"):
    owner_id = getattr(record, owner_field, None)
    ensure_field_matches_current_user(current_user, owner_id, owner_field)


DEFAULT_WISHLIST_GROUP_NAME = "默认分组"


def _dedupe_non_empty_ids(values: Optional[List[str]]) -> List[str]:
    return list(dict.fromkeys([value for value in (values or []) if value]))


def _normalize_wishlist_group_name(name: Optional[str]) -> str:
    trimmed = (name or "").strip()
    return trimmed or DEFAULT_WISHLIST_GROUP_NAME


def _filter_existing_service_ids(db: Session, service_ids: List[str]) -> List[str]:
    normalized = _dedupe_non_empty_ids(service_ids)
    if not normalized:
        return []
    existing_ids = {
        item.id for item in db.query(models.Service.id).filter(
            models.Service.id.in_(normalized),
            models.Service.is_deleted == False
        ).all()
    }
    return [sid for sid in normalized if sid in existing_ids]


def _filter_existing_experience_ids(db: Session, experience_ids: List[str]) -> List[str]:
    normalized = _dedupe_non_empty_ids(experience_ids)
    if not normalized:
        return []
    existing_ids = {
        item.id for item in db.query(models.Experience.id).filter(
            models.Experience.id.in_(normalized),
            models.Experience.is_deleted == False
        ).all()
    }
    return [eid for eid in normalized if eid in existing_ids]


def _build_wishlist_profile_response(
    service_ids: List[str],
    groups: List[tuple[str, List[str]]]
) -> schemas.WishlistProfileResponse:
    return schemas.WishlistProfileResponse(
        service_ids=service_ids,
        groups=[
            schemas.WishlistGroupPayload(name=name, service_ids=group_service_ids)
            for name, group_service_ids in groups
        ]
    )


def _load_wishlist_profile(db: Session, current_user: models.User) -> schemas.WishlistProfileResponse:
    service_ids = _dedupe_non_empty_ids(current_user.favorite_service_ids or [])
    favorite_id_set = set(service_ids)
    group_rows = db.query(models.WishlistGroup).filter(
        models.WishlistGroup.user_id == current_user.id
    ).order_by(
        models.WishlistGroup.sort_order.asc(),
        models.WishlistGroup.created_at.asc(),
        models.WishlistGroup.id.asc()
    ).all()

    group_ids = [row.id for row in group_rows]
    items_by_group: dict[str, List[str]] = {group_id: [] for group_id in group_ids}
    if group_ids:
        item_rows = db.query(models.WishlistGroupItem).filter(
            models.WishlistGroupItem.user_id == current_user.id,
            models.WishlistGroupItem.group_id.in_(group_ids)
        ).order_by(
            models.WishlistGroupItem.created_at.asc(),
            models.WishlistGroupItem.id.asc()
        ).all()
        for item in item_rows:
            items_by_group.setdefault(item.group_id, []).append(item.service_id)

    assigned_ids = set()
    groups: List[tuple[str, List[str]]] = []
    default_group_index: Optional[int] = None
    for row in group_rows:
        name = _normalize_wishlist_group_name(row.name)
        if name == DEFAULT_WISHLIST_GROUP_NAME and default_group_index is None:
            default_group_index = len(groups)
        group_service_ids: List[str] = []
        for service_id in items_by_group.get(row.id, []):
            if service_id in favorite_id_set and service_id not in assigned_ids:
                group_service_ids.append(service_id)
                assigned_ids.add(service_id)
        groups.append((name, group_service_ids))

    unassigned_ids = [service_id for service_id in service_ids if service_id not in assigned_ids]
    if default_group_index is None:
        default_group_index = 0
        groups.insert(0, (DEFAULT_WISHLIST_GROUP_NAME, []))

    if unassigned_ids:
        default_name, default_service_ids = groups[default_group_index]
        groups[default_group_index] = (default_name, default_service_ids + unassigned_ids)

    deduped_groups: List[tuple[str, List[str]]] = []
    seen_group_names = set()
    for name, group_service_ids in groups:
        if name in seen_group_names:
            continue
        seen_group_names.add(name)
        deduped_groups.append((name, group_service_ids))

    return _build_wishlist_profile_response(service_ids, deduped_groups)


def _persist_wishlist_profile(
    db: Session,
    current_user: models.User,
    service_ids: List[str],
    groups: Optional[List[schemas.WishlistGroupPayload]] = None
) -> schemas.WishlistProfileResponse:
    normalized_service_ids = _filter_existing_service_ids(db, service_ids)
    normalized_service_id_set = set(normalized_service_ids)
    source_groups = groups if groups is not None else _load_wishlist_profile(db, current_user).groups

    normalized_groups: List[tuple[str, List[str]]] = []
    seen_group_names = set()
    assigned_ids = set()
    for group in source_groups:
        name = _normalize_wishlist_group_name(group.name)
        if name in seen_group_names:
            continue
        seen_group_names.add(name)
        group_service_ids: List[str] = []
        for service_id in _dedupe_non_empty_ids(group.service_ids):
            if service_id not in normalized_service_id_set or service_id in assigned_ids:
                continue
            group_service_ids.append(service_id)
            assigned_ids.add(service_id)
        normalized_groups.append((name, group_service_ids))

    if DEFAULT_WISHLIST_GROUP_NAME not in seen_group_names:
        normalized_groups.insert(0, (DEFAULT_WISHLIST_GROUP_NAME, []))

    default_index = next(
        (index for index, (name, _) in enumerate(normalized_groups) if name == DEFAULT_WISHLIST_GROUP_NAME),
        0
    )
    unassigned_ids = [service_id for service_id in normalized_service_ids if service_id not in assigned_ids]
    if unassigned_ids:
        default_name, default_service_ids = normalized_groups[default_index]
        normalized_groups[default_index] = (default_name, default_service_ids + unassigned_ids)

    timestamp = int(time.time() * 1000)
    current_user.favorite_service_ids = normalized_service_ids
    current_user.updated_at = timestamp

    db.query(models.WishlistGroupItem).filter(
        models.WishlistGroupItem.user_id == current_user.id
    ).delete(synchronize_session=False)
    db.query(models.WishlistGroup).filter(
        models.WishlistGroup.user_id == current_user.id
    ).delete(synchronize_session=False)

    for index, (name, group_service_ids) in enumerate(normalized_groups):
        group_id = uuid.uuid4().hex
        db.add(models.WishlistGroup(
            id=group_id,
            user_id=current_user.id,
            name=name,
            sort_order=index,
            created_at=timestamp,
            updated_at=timestamp
        ))
        for service_id in group_service_ids:
            db.add(models.WishlistGroupItem(
                id=uuid.uuid4().hex,
                user_id=current_user.id,
                group_id=group_id,
                service_id=service_id,
                created_at=timestamp,
                updated_at=timestamp
            ))

    return _build_wishlist_profile_response(normalized_service_ids, normalized_groups)


def _build_upload_filename(user_id: str, upload_file: UploadFile, force_ext: Optional[str] = None) -> str:
    if force_ext:
        ext = force_ext
    else:
        ext = upload_file.filename.split(".")[-1] if upload_file.filename and "." in upload_file.filename else "bin"
    if not ext.isascii() or not ext.isalnum() or len(ext) > 10:
        ext = "bin"
    return f"{user_id}_{uuid.uuid4().hex}.{ext}"


def _build_media_object_key(biz: str, user_id: str, filename: str) -> str:
    directory = "chat" if biz == "chat" else f"{biz}s"
    return f"{directory}/{user_id}/{filename}"


def _build_media_storage_path(biz: str, user_id: str, filename: str) -> str:
    user_dir = os.path.join(MEDIA_BIZ_TO_DIR[biz], user_id)
    os.makedirs(user_dir, exist_ok=True)
    return os.path.join(user_dir, filename)


def _save_upload_file_with_limit(upload_file: UploadFile, file_path: str, max_bytes: int) -> int:
    total_size = 0
    chunk_size = 1024 * 1024
    try:
        with open(file_path, "wb") as buffer:
            while True:
                chunk = upload_file.file.read(chunk_size)
                if not chunk:
                    break
                total_size += len(chunk)
                if total_size > max_bytes:
                    raise HTTPException(
                        status_code=413,
                        detail=f"File too large, max size is {max_bytes // (1024 * 1024)}MB"
                    )
                buffer.write(chunk)
            if total_size == 0:
                raise HTTPException(status_code=400, detail="Empty file")
    except Exception:
        try:
            os.remove(file_path)
        except OSError:
            pass
        raise
    return total_size


def _upload_media(
    file: UploadFile,
    current_user: models.User,
    biz: str,
    image_only: bool = False
) -> schemas.MediaUploadResponse:
    content_type = file.content_type or ""
    if not content_type:
        raise HTTPException(status_code=400, detail="Missing content type")
    if image_only and not content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File provided is not an image.")
    if biz not in MEDIA_BIZ_TO_DIR:
        raise HTTPException(status_code=400, detail="Unsupported media biz type")

    force_ext = None
    if biz == "avatar":
        force_ext = file.filename.split(".")[-1] if file.filename and "." in file.filename else "jpg"
    new_filename = _build_upload_filename(current_user.id, file, force_ext=force_ext)
    file_path = _build_media_storage_path(biz, current_user.id, new_filename)
    size = _save_upload_file_with_limit(file, file_path, MAX_UPLOAD_SIZE_BYTES)

    object_key = _build_media_object_key(biz, current_user.id, new_filename)
    url = f"static/{object_key}"
    if biz == "avatar":
        url += f"?t={int(time.time())}"

    return schemas.MediaUploadResponse(
        url=url,
        object_key=object_key,
        mime_type=content_type,
        size=size
    )

def get_ws_user(token: str, db: Session) -> models.User:
    _, user = accounts.resolve_session(db, token)
    if not user.is_phone_verified:
        raise HTTPException(403, "Verified phone required")
    return user


def service_years_from_timestamp(first_service_created_at: Optional[int]) -> int:
    if not first_service_created_at:
        return 0

    first_dt = datetime.fromtimestamp(first_service_created_at / 1000.0)
    now_dt = datetime.now()
    years = now_dt.year - first_dt.year
    if (now_dt.month, now_dt.day) < (first_dt.month, first_dt.day):
        years -= 1
    return max(0, years)


def calculate_service_years_from_first_service(db: Session, user_id: str) -> int:
    first_service_created_at = db.query(func.min(models.Service.created_at)).filter(
        models.Service.creator_id == user_id,
        models.Service.is_deleted == False
    ).scalar()
    return service_years_from_timestamp(first_service_created_at)


def hydrate_user_profile_metrics(db: Session, user: models.User):
    # 服务经验按首次发布服务日期动态计算，不依赖静态字段
    user.service_years = calculate_service_years_from_first_service(db, user.id)
    return user


def can_view_service(item: models.Service, viewer: Optional[models.User]) -> bool:
    if (
        item.is_deleted
        or item.is_draft
        or (item.review_status or "approved") != "approved"
    ):
        return viewer is not None and viewer.id == item.creator_id
    return True


def can_view_experience(item: models.Experience, viewer: Optional[models.User]) -> bool:
    if item.is_deleted or item.is_draft or (item.review_status or "approved") != "approved":
        return viewer is not None and viewer.id == item.host_id
    return True


def normalize_review_status_for_submit(is_draft: bool) -> str:
    return "draft" if is_draft else "pending_review"


def apply_owner_service_review_state(item: models.Service):
    next_status = normalize_review_status_for_submit(bool(item.is_draft))
    item.review_status = next_status
    if next_status == "draft":
        item.review_submitted_at = 0
        item.reviewed_at = 0
        item.review_note = ""
        return
    item.review_submitted_at = current_millis()
    item.reviewed_at = 0
    item.review_note = ""


def apply_owner_experience_review_state(item: models.Experience):
    item.review_status = normalize_review_status_for_submit(bool(item.is_draft))
    item.review_submitted_at = 0 if item.is_draft else current_millis()
    item.reviewed_at = 0
    item.review_note = ""


def user_schemas_for_viewer(
    db: Session,
    users: List[models.User],
    viewer_id: str,
    expose_phone: bool = False,
) -> List[schemas.User]:
    if not users:
        return []
    first_services = dict(db.query(
        models.Service.creator_id, func.min(models.Service.created_at)
    ).filter(
        models.Service.creator_id.in_([user.id for user in users]),
        models.Service.is_deleted == False,
    ).group_by(models.Service.creator_id).all())
    result = []
    defaults = schemas.UserBase().model_dump()
    for user in users:
        payload = schemas.User.model_validate(user, from_attributes=True).model_dump()
        payload["service_years"] = service_years_from_timestamp(first_services.get(user.id))
        if viewer_id != user.id:
            # Keep the existing response shape, but do not disclose account-private data.
            for field in (
                "email", "phone_number", "wechat_unionid", "wechat_openid", "wechat_platform",
                "address_detail", "address_recipient_name", "address_phone_number",
                "favorite_service_ids", "favorite_experience_ids", "memo", "remark_name",
                "phone_bound_at", "last_login_at", "login_provider",
                "id_modification_count", "last_id_modification_year",
            ):
                payload[field] = defaults[field]
            payload["phone_number"] = (user.phone_number or "") if expose_phone else ""
            if user.height_weight_private:
                payload["height_cm"] = 0
                payload["weight_kg"] = 0.0
        result.append(schemas.User(**payload))
    return result


def user_schema_for_viewer(
    db: Session, orm_user: models.User, viewer_id: str, expose_phone: bool = False,
) -> schemas.User:
    return user_schemas_for_viewer(db, [orm_user], viewer_id, expose_phone)[0]


def serialize_conversation_items(
    conversations: List[models.Conversation], current_user: models.User, db: Session,
) -> List[schemas.ConversationListItem]:
    if not conversations:
        return []
    members = db.query(models.ConversationMember).filter(
        models.ConversationMember.conversation_id.in_([item.id for item in conversations]),
        models.ConversationMember.user_id == current_user.id
    ).all()
    member_by_conversation = {member.conversation_id: member for member in members}
    peer_by_conversation = {}
    for conversation in conversations:
        peer_ids = [user_id for user_id in (conversation.participant_ids or [])
                    if user_id != current_user.id]
        if conversation.type == "direct" and peer_ids:
            peer_by_conversation[conversation.id] = peer_ids[0]
    peers = db.query(models.User).filter(
        models.User.id.in_(set(peer_by_conversation.values()))
    ).all() if peer_by_conversation else []
    peer_schemas = {
        peer.id: peer for peer in user_schemas_for_viewer(db, peers, current_user.id)
    }
    return [
        schemas.ConversationListItem(
            conversation=conversation,
            member=member_by_conversation.get(conversation.id),
            peer=peer_schemas.get(peer_by_conversation.get(conversation.id)),
        )
        for conversation in conversations
    ]


def serialize_conversation_item(conversation: models.Conversation, current_user: models.User, db: Session):
    return serialize_conversation_items([conversation], current_user, db)[0]


def ensure_conversation_member(conversation_id: str, current_user: models.User, db: Session):
    member = db.query(models.ConversationMember).filter(
        models.ConversationMember.conversation_id == conversation_id,
        models.ConversationMember.user_id == current_user.id
    ).first()
    if member is None:
        raise HTTPException(status_code=403, detail="Not authorized to access this conversation")
    conversation = db.query(models.Conversation).filter(
        models.Conversation.id == conversation_id,
        models.Conversation.is_deleted == False
    ).first()
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conversation, member


def build_message_preview(message_type: str, content: str, attachment_name: str = "") -> str:
    if message_type == "image":
        return "[图片]"
    if message_type == "location":
        return content or "[位置]"
    if message_type == "service_card":
        return content or "[服务卡片]"
    if message_type == "file":
        return attachment_name or "[文件]"
    if message_type == "system":
        return content or "[系统消息]"
    return content or ""


def get_or_create_direct_conversation(db: Session, current_user: models.User, peer_id: str):
    if peer_id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot create chat with self")
    peer = db.query(models.User).filter(models.User.id == peer_id).first()
    if peer is None:
        raise HTTPException(status_code=404, detail="User not found")

    for conversation in db.query(models.Conversation).join(
        models.ConversationMember,
        models.ConversationMember.conversation_id == models.Conversation.id,
    ).filter(
        models.ConversationMember.user_id == current_user.id,
        models.Conversation.type == "direct",
        models.Conversation.is_deleted == False
    ).all():
        participants = set(conversation.participant_ids or [])
        if participants == {current_user.id, peer_id}:
            return conversation

    now = int(time.time() * 1000)
    conversation = models.Conversation(
        id=str(uuid.uuid4()),
        type="direct",
        title="",
        owner_id=current_user.id,
        avatar_url="",
        participant_ids=[current_user.id, peer_id],
        created_at=now,
        updated_at=now,
        last_message_at=now,
    )
    db.add(conversation)
    db.flush()

    for user_id in [current_user.id, peer_id]:
        db.add(models.ConversationMember(
            id=str(uuid.uuid4()),
            conversation_id=conversation.id,
            user_id=user_id,
            role="owner" if user_id == current_user.id else "member",
            unread_count=0,
            joined_at=now,
            updated_at=now,
        ))
    db.commit()
    db.refresh(conversation)
    return conversation


class AdminUserUpdatePayload(BaseModel):
    is_phone_verified: Optional[bool] = None
    is_profile_completed: Optional[bool] = None
    identity_verified: Optional[bool] = None
    memo: Optional[str] = None


class AdminServiceUpdatePayload(BaseModel):
    title: Optional[str] = None
    category: Optional[str] = None
    location: Optional[str] = None
    price_text: Optional[str] = None
    description: Optional[str] = None
    cover_image_url: Optional[str] = None
    image_urls: Optional[List[str]] = None
    is_deleted: Optional[bool] = None
    is_draft: Optional[bool] = None
    sync_to_square: Optional[bool] = None
    is_important: Optional[bool] = None
    sort_priority: Optional[int] = None
    review_status: Optional[str] = None
    review_note: Optional[str] = None


class AdminExperienceUpdatePayload(BaseModel):
    title: Optional[str] = None
    category: Optional[str] = None
    location: Optional[str] = None
    price_text: Optional[str] = None
    description: Optional[str] = None
    cover_image_url: Optional[str] = None
    image_urls: Optional[List[str]] = None
    is_deleted: Optional[bool] = None
    review_status: Optional[str] = None
    review_note: Optional[str] = None


class AdminFeedbackUpdatePayload(BaseModel):
    status: Optional[str] = None
    admin_note: Optional[str] = None


class AdminReviewBatchItem(BaseModel):
    biz_type: str
    item_id: str


class AdminReviewBatchPayload(BaseModel):
    review_status: str
    review_note: Optional[str] = None
    items: List[AdminReviewBatchItem]


def require_admin_access(
    request: Request,
    x_admin_token: Optional[str] = Header(None),
):
    if not ADMIN_TOKEN and not ADMIN_PASSWORD:
        raise HTTPException(status_code=503, detail="Admin authentication is not configured")
    candidate = (x_admin_token or request.query_params.get("token") or "").strip()
    if ADMIN_TOKEN and candidate == ADMIN_TOKEN:
        return {"actor": ADMIN_DISPLAY_NAME, "role": "super_admin"}
    try:
        payload = jwt.decode(candidate, SECRET_KEY, algorithms=[ALGORITHM],
                             options={"require_exp": True})
    except JWTError:
        raise HTTPException(status_code=403, detail="Invalid admin token")
    if payload.get("scope") != "admin":
        raise HTTPException(status_code=403, detail="Invalid admin token")
    return {
        "actor": str(payload.get("display_name") or ADMIN_DISPLAY_NAME),
        "role": str(payload.get("role") or "super_admin"),
    }


def create_admin_access_token(display_name: str, role: str = "super_admin") -> str:
    return create_access_token(
        {
            "sub": "admin",
            "scope": "admin",
            "display_name": display_name,
            "role": role,
        },
        expires_delta=timedelta(hours=ADMIN_SESSION_EXPIRE_HOURS),
    )


def verify_admin_credentials(username: str, password: str) -> bool:
    if ADMIN_PASSWORD and username.strip() == ADMIN_USERNAME and password == ADMIN_PASSWORD:
        return True
    if ADMIN_TOKEN and password == ADMIN_TOKEN:
        return True
    return False


def admin_datetime_label(timestamp_ms: int) -> str:
    if not timestamp_ms:
        return "-"
    return datetime.fromtimestamp(timestamp_ms / 1000.0).strftime("%Y-%m-%d %H:%M")


def build_admin_day_buckets(days: int) -> List[Dict[str, Union[str, int]]]:
    today = date.today()
    buckets: List[Dict[str, Union[str, int]]] = []
    for offset in range(days - 1, -1, -1):
        current_day = today - timedelta(days=offset)
        buckets.append({
            "date": current_day.isoformat(),
            "label": current_day.strftime("%m-%d"),
            "count": 0,
        })
    return buckets


def build_registration_series(db: Session, days: int = 14) -> List[Dict[str, Union[str, int]]]:
    safe_days = max(1, min(days, 90))
    buckets = build_admin_day_buckets(safe_days)
    index = {item["date"]: item for item in buckets}
    start_day = date.today() - timedelta(days=safe_days - 1)
    start_ms = int(datetime.combine(start_day, datetime.min.time()).timestamp() * 1000)
    rows = db.query(models.User.created_at).filter(models.User.created_at >= start_ms).all()
    for (created_at,) in rows:
        if not created_at:
            continue
        bucket_key = datetime.fromtimestamp(created_at / 1000.0).date().isoformat()
        bucket = index.get(bucket_key)
        if bucket is not None:
            bucket["count"] = int(bucket["count"]) + 1
    return buckets


def review_status_label(status: str) -> str:
    mapping = {
        "draft": "草稿",
        "pending_review": "待审核",
        "approved": "已通过",
        "rejected": "已驳回",
    }
    normalized = (status or "").strip() or "approved"
    return mapping.get(normalized, normalized)


def serialize_admin_user(db: Session, user: models.User) -> Dict[str, Union[str, int, bool, float, None]]:
    hydrated = hydrate_user_profile_metrics(db, user)
    service_count = db.query(func.count(models.Service.id)).filter(
        models.Service.creator_id == user.id,
        models.Service.is_deleted == False
    ).scalar() or 0
    experience_count = db.query(func.count(models.Experience.id)).filter(
        models.Experience.host_id == user.id,
        models.Experience.is_deleted == False
    ).scalar() or 0
    return {
        "id": user.id,
        "pei_pei_id": user.pei_pei_id or "",
        "name": user.name or "",
        "phone_number": user.phone_number or "",
        "photo_url": user.photo_url or "",
        "login_provider": user.login_provider or "password",
        "is_phone_verified": bool(user.is_phone_verified),
        "is_profile_completed": bool(user.is_profile_completed),
        "identity_verified": bool(user.identity_verified),
        "service_years": hydrated.service_years,
        "service_count": int(service_count),
        "experience_count": int(experience_count),
        "created_at": int(user.created_at or 0),
        "created_at_label": admin_datetime_label(int(user.created_at or 0)),
        "last_login_at": int(user.last_login_at or 0),
        "last_login_at_label": admin_datetime_label(int(user.last_login_at or 0)),
        "memo": user.memo or "",
        "region": user.region or "",
    }


def serialize_admin_service(db: Session, item: models.Service) -> Dict[str, Union[str, int, bool]]:
    owner = db.query(models.User).filter(models.User.id == item.creator_id).first()
    return {
        "id": item.id,
        "title": item.title or "",
        "description": item.description or "",
        "category": item.category or "",
        "price_text": item.price_text or "",
        "location": item.location or "",
        "cover_image_url": item.cover_image_url or "",
        "image_urls": item.image_urls or [],
        "creator_id": item.creator_id or "",
        "creator_name": (owner.name if owner else item.creator) or "",
        "creator_phone_number": owner.phone_number if owner else "",
        "sync_to_square": bool(item.sync_to_square),
        "is_important": bool(item.is_important),
        "sort_priority": int(item.sort_priority or 0),
        "is_draft": bool(item.is_draft),
        "is_deleted": bool(item.is_deleted),
        "review_status": item.review_status or normalize_review_status_for_submit(bool(item.is_draft)),
        "review_status_label": review_status_label(item.review_status or normalize_review_status_for_submit(bool(item.is_draft))),
        "review_note": item.review_note or "",
        "review_submitted_at": int(item.review_submitted_at or 0),
        "review_submitted_at_label": admin_datetime_label(int(item.review_submitted_at or 0)),
        "reviewed_at": int(item.reviewed_at or 0),
        "reviewed_at_label": admin_datetime_label(int(item.reviewed_at or 0)),
        "created_at": int(item.created_at or 0),
        "created_at_label": admin_datetime_label(int(item.created_at or 0)),
        "updated_at": int(item.updated_at or 0),
        "updated_at_label": admin_datetime_label(int(item.updated_at or 0)),
    }


def serialize_admin_experience(db: Session, item: models.Experience) -> Dict[str, Union[str, int, bool, float]]:
    host = db.query(models.User).filter(models.User.id == item.host_id).first()
    return {
        "id": item.id,
        "title": item.title or "",
        "description": item.description or "",
        "category": item.category or "",
        "price_text": item.price_text or "",
        "location": item.location or "",
        "cover_image_url": item.cover_image_url or "",
        "image_urls": item.image_urls or [],
        "host_id": item.host_id or "",
        "host_name": (host.name if host else item.host_name) or "",
        "host_phone_number": host.phone_number if host else "",
        "average_rating": float(item.average_rating or 0.0),
        "is_deleted": bool(item.is_deleted),
        "is_draft": bool(item.is_draft),
        "review_status": item.review_status or "approved",
        "review_status_label": review_status_label(item.review_status or "approved"),
        "review_note": item.review_note or "",
        "review_submitted_at": int(item.review_submitted_at or 0),
        "review_submitted_at_label": admin_datetime_label(int(item.review_submitted_at or 0)),
        "reviewed_at": int(item.reviewed_at or 0),
        "reviewed_at_label": admin_datetime_label(int(item.reviewed_at or 0)),
        "created_at": int(item.created_at or 0),
        "created_at_label": admin_datetime_label(int(item.created_at or 0)),
        "updated_at": int(item.updated_at or 0),
        "updated_at_label": admin_datetime_label(int(item.updated_at or 0)),
    }


def serialize_admin_feedback(item: models.Feedback) -> Dict[str, Union[str, int]]:
    return {
        "id": item.id,
        "user_id": item.user_id or "",
        "user_name": item.user_name or "",
        "phone_number": item.phone_number or "",
        "source": item.source or "app",
        "category": item.category or "general",
        "content": item.content or "",
        "contact": item.contact or "",
        "status": item.status or "pending",
        "admin_note": item.admin_note or "",
        "created_at": int(item.created_at or 0),
        "created_at_label": admin_datetime_label(int(item.created_at or 0)),
        "updated_at": int(item.updated_at or 0),
        "updated_at_label": admin_datetime_label(int(item.updated_at or 0)),
        "handled_at": int(item.handled_at or 0),
        "handled_at_label": admin_datetime_label(int(item.handled_at or 0)),
    }


def serialize_admin_operation_log(item: models.AdminOperationLog) -> Dict[str, Union[str, int]]:
    return {
        "id": item.id,
        "actor": item.actor or "admin",
        "action": item.action or "",
        "entity_type": item.entity_type or "",
        "entity_id": item.entity_id or "",
        "summary": item.summary or "",
        "detail": item.detail or "",
        "created_at": int(item.created_at or 0),
        "created_at_label": admin_datetime_label(int(item.created_at or 0)),
    }


def append_admin_operation_log(
    db: Session,
    actor: str,
    action: str,
    entity_type: str,
    entity_id: str,
    summary: str,
    detail: str = "",
):
    db.add(models.AdminOperationLog(
        id=str(uuid.uuid4()),
        actor=actor or ADMIN_DISPLAY_NAME,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        summary=summary,
        detail=detail,
        created_at=current_millis(),
    ))


def build_review_queue(db: Session, limit: int = 20) -> List[Dict[str, Union[str, int, bool, float]]]:
    queue: List[Dict[str, Union[str, int, bool, float]]] = []
    services = db.query(models.Service).filter(
        models.Service.review_status == "pending_review",
        models.Service.is_deleted == False,
        models.Service.is_draft == False,
    ).order_by(desc(models.Service.review_submitted_at), desc(models.Service.updated_at)).limit(limit).all()
    for item in services:
        row = serialize_admin_service(db, item)
        row["biz_type"] = "service"
        row["owner_name"] = row["creator_name"]
        queue.append(row)
    experiences = db.query(models.Experience).filter(
        models.Experience.review_status == "pending_review",
        models.Experience.is_deleted == False,
        models.Experience.is_draft == False,
    ).order_by(desc(models.Experience.review_submitted_at), desc(models.Experience.updated_at)).limit(limit).all()
    for item in experiences:
        row = serialize_admin_experience(db, item)
        row["biz_type"] = "experience"
        row["owner_name"] = row["host_name"]
        queue.append(row)
    queue.sort(key=lambda item: int(item.get("review_submitted_at", 0) or 0), reverse=True)
    return queue[:limit]


def apply_admin_user_update(user: models.User, payload: AdminUserUpdatePayload):
    if payload.is_phone_verified is not None:
        user.is_phone_verified = payload.is_phone_verified
        if payload.is_phone_verified and not user.phone_bound_at:
            user.phone_bound_at = current_millis()
    if payload.is_profile_completed is not None:
        user.is_profile_completed = payload.is_profile_completed
    if payload.identity_verified is not None:
        user.identity_verified = payload.identity_verified
    if payload.memo is not None:
        user.memo = payload.memo.strip()
    user.updated_at = current_millis()


def apply_admin_service_update(item: models.Service, payload: AdminServiceUpdatePayload):
    if payload.title is not None:
        item.title = payload.title.strip()
    if payload.category is not None:
        item.category = payload.category.strip()
    if payload.location is not None:
        item.location = payload.location.strip()
    if payload.price_text is not None:
        item.price_text = payload.price_text.strip()
    if payload.description is not None:
        item.description = payload.description.strip()
    if payload.cover_image_url is not None:
        item.cover_image_url = payload.cover_image_url.strip()
    if payload.image_urls is not None:
        item.image_urls = [value for value in payload.image_urls if value]
    if payload.is_deleted is not None:
        item.is_deleted = payload.is_deleted
    if payload.is_draft is not None:
        item.is_draft = payload.is_draft
        if payload.is_draft:
            item.review_status = "draft"
            item.review_submitted_at = 0
            item.reviewed_at = 0
    if payload.sync_to_square is not None:
        item.sync_to_square = payload.sync_to_square
    if payload.is_important is not None:
        item.is_important = payload.is_important
    if payload.sort_priority is not None:
        item.sort_priority = max(0, min(int(payload.sort_priority), 9999))
    if payload.review_status is not None:
        normalized = payload.review_status.strip() or item.review_status or "approved"
        item.review_status = normalized
        if normalized == "approved":
            item.is_draft = False
            item.reviewed_at = current_millis()
            if payload.review_note is None and not item.review_note:
                item.review_note = "审核通过"
        elif normalized == "rejected":
            item.is_draft = False
            item.reviewed_at = current_millis()
        elif normalized == "pending_review":
            item.is_draft = False
            item.review_submitted_at = current_millis()
            item.reviewed_at = 0
        elif normalized == "draft":
            item.is_draft = True
            item.review_submitted_at = 0
            item.reviewed_at = 0
    if payload.review_note is not None:
        item.review_note = payload.review_note.strip()
    item.updated_at = current_millis()


def apply_admin_experience_update(item: models.Experience, payload: AdminExperienceUpdatePayload):
    if item.is_draft and payload.review_status in {"approved", "rejected", "pending_review"}:
        raise HTTPException(409, "Draft must be submitted by its owner before review")
    if payload.title is not None:
        item.title = payload.title.strip()
    if payload.category is not None:
        item.category = payload.category.strip()
    if payload.location is not None:
        item.location = payload.location.strip()
    if payload.price_text is not None:
        item.price_text = payload.price_text.strip()
    if payload.description is not None:
        item.description = payload.description.strip()
    if payload.cover_image_url is not None:
        item.cover_image_url = payload.cover_image_url.strip()
    if payload.image_urls is not None:
        item.image_urls = [value for value in payload.image_urls if value]
    if payload.is_deleted is not None:
        item.is_deleted = payload.is_deleted
    if payload.review_status is not None:
        normalized = payload.review_status.strip() or item.review_status or "approved"
        item.review_status = normalized
        if normalized == "approved":
            item.reviewed_at = current_millis()
            if payload.review_note is None and not item.review_note:
                item.review_note = "审核通过"
        elif normalized == "rejected":
            item.reviewed_at = current_millis()
        elif normalized == "pending_review":
            item.review_submitted_at = current_millis()
            item.reviewed_at = 0
    if payload.review_note is not None:
        item.review_note = payload.review_note.strip()
    item.updated_at = current_millis()


def apply_admin_feedback_update(item: models.Feedback, payload: AdminFeedbackUpdatePayload):
    if payload.status is not None:
        item.status = payload.status.strip() or item.status or "pending"
        if item.status in {"processing", "closed"}:
            item.handled_at = current_millis()
    if payload.admin_note is not None:
        item.admin_note = payload.admin_note.strip()
    item.updated_at = current_millis()

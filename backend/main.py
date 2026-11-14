from fastapi import FastAPI, Depends, HTTPException, Query, File, UploadFile, Form, WebSocket, WebSocketDisconnect, Request, Header
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from sqlalchemy import or_, desc, func
from typing import Dict, List, Optional, Union
from pydantic import BaseModel
import time
import uuid
import math
import json
import hashlib
import random
import threading
import asyncio
import bcrypt # 替换 passlib
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
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
    from .database import SessionLocal, engine
except ImportError:
    from database import SessionLocal, engine
try:
    from .schema_sync import sync_sqlite_schema
except ImportError:
    from schema_sync import sync_sqlite_schema
try:
    from .seed_data import ensure_seed_data
except ImportError:
    from seed_data import ensure_seed_data
try:
    from .experience_rating import compute_experience_rating_for_host
except ImportError:
    from experience_rating import compute_experience_rating_for_host
try:
    from .chat_realtime import ChatRealtimeHub
except ImportError:
    from chat_realtime import ChatRealtimeHub
try:
    from . import account_security as accounts
except ImportError:
    import account_security as accounts

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")
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
ACCESS_TOKEN_EXPIRE_MINUTES_ENV = os.getenv("LULU_ACCESS_TOKEN_EXPIRE_MINUTES", "").strip()
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


def normalize_phone_number(phone_number: str) -> str:
    normalized = "".join(ch for ch in (phone_number or "") if ch.isdigit())
    if len(normalized) != 11:
        raise HTTPException(status_code=400, detail="Invalid phone number")
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


def parse_debug_wechat_identity(code: str, platform: str) -> Optional[dict]:
    token = (code or "").strip()
    if not token.startswith("debug_wechat_"):
        return None
    seed = token.removeprefix("debug_wechat_")
    digest = hashlib.sha256(seed.encode("utf-8")).hexdigest()
    return {
        "openid": f"{platform}_{digest[:24]}",
        "unionid": digest[:28],
        "nickname": f"微信用户{digest[:4]}",
    }


def exchange_wechat_mobile_code(code: str, platform: str) -> dict:
    debug_identity = parse_debug_wechat_identity(code, platform)
    if debug_identity is not None:
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
    except Exception as exc:
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
    return f"{user_id}_{uuid.uuid4().hex}.{ext}"


def _build_media_object_key(biz: str, user_id: str, filename: str) -> str:
    return f"{biz}s/{user_id}/{filename}"


def _build_media_storage_path(biz: str, user_id: str, filename: str) -> str:
    user_dir = os.path.join(MEDIA_BIZ_TO_DIR[biz], user_id)
    os.makedirs(user_dir, exist_ok=True)
    return os.path.join(user_dir, filename)


def _save_upload_file_with_limit(upload_file: UploadFile, file_path: str, max_bytes: int) -> int:
    total_size = 0
    chunk_size = 1024 * 1024
    with open(file_path, "wb") as buffer:
        while True:
            chunk = upload_file.file.read(chunk_size)
            if not chunk:
                break
            total_size += len(chunk)
            if total_size > max_bytes:
                buffer.close()
                try:
                    os.remove(file_path)
                except OSError:
                    pass
                raise HTTPException(
                    status_code=413,
                    detail=f"File too large, max size is {max_bytes // (1024 * 1024)}MB"
                )
            buffer.write(chunk)
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

    if biz == "avatar":
        object_key = _build_media_object_key("avatar", current_user.id, new_filename)
        timestamp = int(time.time())
        url = f"static/{object_key}?t={timestamp}"
    elif biz == "service":
        object_key = _build_media_object_key("service", current_user.id, new_filename)
        url = f"static/{object_key}"
    elif biz == "experience":
        object_key = _build_media_object_key("experience", current_user.id, new_filename)
        url = f"static/{object_key}"
    else:
        object_key = f"chat/{new_filename}"
        url = f"static/{object_key}"

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


def get_direct_peer(conversation: models.Conversation, current_user_id: str, db: Session):
    peer_ids = [item for item in (conversation.participant_ids or []) if item != current_user_id]
    if not peer_ids:
        return None
    return db.query(models.User).filter(models.User.id == peer_ids[0]).first()


def calculate_service_years_from_first_service(db: Session, user_id: str) -> int:
    first_service_created_at = db.query(func.min(models.Service.created_at)).filter(
        models.Service.creator_id == user_id,
        models.Service.is_deleted == False
    ).scalar()
    if not first_service_created_at:
        return 0

    first_dt = datetime.fromtimestamp(first_service_created_at / 1000.0)
    now_dt = datetime.now()
    years = now_dt.year - first_dt.year
    if (now_dt.month, now_dt.day) < (first_dt.month, first_dt.day):
        years -= 1
    return max(0, years)


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
    if item.is_deleted or (item.review_status or "approved") != "approved":
        return viewer is not None and viewer.id == item.host_id
    return True


def normalize_review_status_for_submit(is_draft: bool) -> str:
    return "draft" if is_draft else "pending_review"


def apply_owner_service_review_state(item: models.Service, previous_status: str = ""):
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


def apply_owner_experience_review_state(item: models.Experience, previous_status: str = ""):
    item.review_status = "pending_review"
    item.review_submitted_at = current_millis()
    item.reviewed_at = 0
    item.review_note = ""


def user_schema_for_viewer(db: Session, orm_user: models.User, viewer_id: str) -> schemas.User:
    """
    将 ORM 用户转为响应 Schema；对他人且开启身高体重隐私时，抹掉具体数值（仍保留 privacy 标记供客户端展示「已隐藏」）。
    """
    hydrated = hydrate_user_profile_metrics(db, orm_user)
    su = schemas.User.model_validate(hydrated, from_attributes=True)
    if viewer_id != hydrated.id and getattr(hydrated, "height_weight_private", False):
        dumped = su.model_dump()
        dumped["height_cm"] = 0
        dumped["weight_kg"] = 0.0
        return schemas.User(**dumped)
    return su


def serialize_conversation_item(conversation: models.Conversation, current_user: models.User, db: Session):
    member = db.query(models.ConversationMember).filter(
        models.ConversationMember.conversation_id == conversation.id,
        models.ConversationMember.user_id == current_user.id
    ).first()
    peer = get_direct_peer(conversation, current_user.id, db) if conversation.type == "direct" else None
    return schemas.ConversationListItem(
        conversation=conversation,
        member=member,
        peer=peer,
    )


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

    for conversation in db.query(models.Conversation).filter(
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
        return {"actor": ADMIN_DISPLAY_NAME, "role": "super_admin"}
    candidate = (x_admin_token or request.query_params.get("token") or "").strip()
    if ADMIN_TOKEN and candidate == ADMIN_TOKEN:
        return {"actor": ADMIN_DISPLAY_NAME, "role": "super_admin"}
    try:
        payload = jwt.decode(candidate, SECRET_KEY, algorithms=[ALGORITHM])
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


# 创建所有数据库表
# 如果表已存在，不会重新创建
models.Base.metadata.create_all(bind=engine)
sync_sqlite_schema(engine, models.Base.metadata)
with SessionLocal() as seed_db:
    ensure_seed_data(seed_db)

app = FastAPI()

# --- 静态资源目录配置 ---
os.makedirs(AVATAR_DIR, exist_ok=True)
os.makedirs(CHAT_MEDIA_DIR, exist_ok=True)
os.makedirs(SERVICE_MEDIA_DIR, exist_ok=True)
os.makedirs(EXPERIENCE_MEDIA_DIR, exist_ok=True)
# Preserve existing asset URLs while keeping frontend files outside the backend.
if os.path.isdir(ADMIN_WEB_DIR):
    app.mount("/static/admin", StaticFiles(directory=ADMIN_WEB_DIR), name="admin_static")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.on_event("startup")
async def on_startup():
    await chat_hub.startup()


@app.on_event("shutdown")
async def on_shutdown():
    await chat_hub.shutdown()

# --- 用户相关 API (User APIs) ---

@app.post("/users/register", response_model=schemas.User)
def register_user(user: schemas.UserCreate, request: Request, db: Session = Depends(get_db)):
    """
    用户注册
    """
    try:
        number = accounts.phone(user.phone_number)
        accounts.rate_limit(db, f"register:{request.client.host if request.client else 'unknown'}", 10, 3600)
        if not 6 <= len(user.password) or len(user.password.encode("utf-8")) > 72:
            raise HTTPException(400, "Password must be at least 6 characters and at most 72 bytes")
        accounts.consume_code(db, number, "register", "", user.verify_code)
        # 1. 检查手机号是否已存在
        if user.phone_number:
            existing_user = db.query(models.User).filter(models.User.phone_number == user.phone_number).first()
            if existing_user:
                raise HTTPException(status_code=400, detail="Phone number already registered")
                
        # 3. 创建用户对象
        hashed_password = get_password_hash(user.password)
        user_dict = {k: v for k, v in user.model_dump().items() if k in accounts.PROFILE_FIELDS}
        user_dict["id"] = str(uuid.uuid4())
        user_dict["phone_number"] = number
        user_dict["is_phone_verified"] = True
        user_dict["phone_bound_at"] = current_millis()
        user_dict["hashed_password"] = hashed_password
        
        # 手动设置时间戳，防止 Pydantic 响应模型校验失败
        timestamp = int(time.time() * 1000)
        user_dict["created_at"] = timestamp
        user_dict["updated_at"] = timestamp
        user_dict["last_login_at"] = timestamp
        user_dict["login_provider"] = user_dict.get("login_provider") or "password"
        if not user_dict.get("pei_pei_id"):
            user_dict["pei_pei_id"] = generate_pei_pei_id(db)
        
        db_user = models.User(**user_dict)
        db.add(db_user)
        db.flush()
        accounts.bind_identity(db, db_user, "phone", number)
        
        db.commit()
        db.refresh(db_user)
        return hydrate_user_profile_metrics(db, db_user)

    except HTTPException as he:
        raise he
    except Exception as e:
        import traceback
        traceback.print_exc()
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Failed to register user: {str(e)}")

@app.post("/users/login", response_model=schemas.User)
def login_user(login_data: schemas.UserLogin, db: Session = Depends(get_db)):
    """
    用户登录
    """
    raise HTTPException(410, "Use /auth/token to sign in")

@app.get("/users/search", response_model=schemas.User)
def search_user(query: str, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    """
    根据手机号或lulu号搜索用户
    """
    user = db.query(models.User).filter(
        or_(models.User.phone_number == query, models.User.pei_pei_id == query)
    ).first()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return user_schema_for_viewer(db, user, current_user.id)

@app.post("/users/match_contacts", response_model=List[schemas.User])
def match_contacts(request: schemas.ContactMatchRequest, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    """
    批量匹配通讯录中的手机号
    """
    if not request.phone_numbers:
        return []
        
    # Query all users where phone_number is in the provided list
    users = db.query(models.User).filter(
        models.User.phone_number.in_(request.phone_numbers)
    ).all()
    
    return [user_schema_for_viewer(db, item, current_user.id) for item in users]

@app.get("/users/{user_id}", response_model=schemas.User)
def read_user(
    user_id: str,
    db: Session = Depends(get_db),
    current_user: Optional[models.User] = Depends(get_optional_current_user),
):
    """
    根据用户 ID 获取用户信息。
    允许匿名访问：与 /services/discovery 一致，冷启动仅有本地 demo 用户、尚未拿 token 时仍可打开他人主页。
    """
    db_user = db.query(models.User).filter(models.User.id == user_id).first()
    if db_user is None:
        raise HTTPException(status_code=404, detail="User not found")
    viewer_id = current_user.id if current_user is not None else ""
    return user_schema_for_viewer(db, db_user, viewer_id)


@app.get("/users/discovery", response_model=List[schemas.User])
def discovery_users(
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    users = db.query(models.User).filter(
        models.User.id != current_user.id
    ).order_by(desc(models.User.updated_at), desc(models.User.created_at)).limit(limit).all()
    return [user_schema_for_viewer(db, item, current_user.id) for item in users]

@app.post("/upload/avatar")
async def upload_avatar(file: UploadFile = File(...), user_id: Optional[str] = Form(None), current_user: models.User = Depends(get_current_user)):
    """
    上传头像文件，返回文件的网络访问 URL
    """
    if user_id is not None:
        ensure_self_access(current_user, user_id)
    else:
        user_id = current_user.id
    result = _upload_media(file=file, current_user=current_user, biz="avatar", image_only=True)
    return {"url": result.url}


@app.post("/media/upload", response_model=schemas.MediaUploadResponse)
async def upload_media(
    biz: str = Query(..., pattern="^(avatar|service|chat)$"),
    file: UploadFile = File(...),
    current_user: models.User = Depends(get_current_user)
):
    return _upload_media(file=file, current_user=current_user, biz=biz, image_only=(biz == "avatar"))

@app.put("/users/{user_id}", response_model=schemas.User)
def update_user(user_id: str, user: schemas.UserUpdate, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    """
    更新用户信息
    """
    ensure_self_access(current_user, user_id)
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
    
    try:
        db.commit()
        db.refresh(db_user)
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))
        
    return hydrate_user_profile_metrics(db, db_user)

@app.post("/auth/token", response_model=schemas.Token)
def login_for_access_token(request: Request, form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    ip = request.client.host if request.client else "unknown"
    accounts.rate_limit(db, f"password-ip:{ip}", 60, 600)
    accounts.rate_limit(db, f"password-user:{form_data.username}", 10, 600)
    user = db.query(models.User).filter(models.User.phone_number == form_data.username).first()
    if not user:
        raise HTTPException(status_code=401, detail="Invalid phone number or password")
    if not user.hashed_password:
        raise HTTPException(status_code=401, detail="Invalid phone number or password")
    if not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid phone number or password")
    user.last_login_at = current_millis()
    user.updated_at = current_millis()
    db.commit()
    return accounts.issue_session(db, user)

@app.get("/auth/me", response_model=schemas.User)
def read_me(current_user: models.User = Depends(get_current_user)):
    db = SessionLocal()
    try:
        fresh_user = db.query(models.User).filter(models.User.id == current_user.id).first()
        if fresh_user is None:
            raise HTTPException(status_code=404, detail="User not found")
        return hydrate_user_profile_metrics(db, fresh_user)
    finally:
        db.close()


def finish_wechat_login(db: Session, identity: dict, platform: str, appid: str):
    unionid = identity.get("unionid")
    openid = identity.get("openid")

    user = None
    provider = f"wechat:{appid}"
    existing = accounts.verified_identity(db, provider, openid)
    if existing:
        user = db.get(models.User, existing.user_id)
    scope = os.getenv("LULU_WECHAT_OPEN_PLATFORM_ID", "").strip()
    union_provider = f"wechat_union:{scope}" if scope else None
    if user is None and unionid and union_provider:
        union_identity = accounts.verified_identity(db, union_provider, unionid)
        if union_identity:
            user = db.get(models.User, union_identity.user_id)
    # Existing mobile accounts can be linked only by a provider-verified openid.
    if user is None and platform in {"android", "ios"}:
        legacy = db.query(models.User).filter(models.User.wechat_openid == openid).all()
        if len(legacy) > 1:
            raise HTTPException(409, "Duplicate legacy identity requires account recovery")
        user = legacy[0] if legacy else None

    is_new_user = False
    if user is None:
        timestamp = current_millis()
        user = models.User(
            id=str(uuid.uuid4()),
            pei_pei_id=generate_pei_pei_id(db, prefix="wx"),
            name=identity.get("nickname") or f"微信用户{openid[-4:]}",
            login_provider="wechat",
            wechat_unionid=unionid,
            wechat_openid=openid,
            wechat_platform=platform,
            created_at=timestamp,
            updated_at=timestamp,
            last_login_at=timestamp,
        )
        db.add(user)
        is_new_user = True
    else:
        user.login_provider = "wechat"
        user.wechat_unionid = unionid or user.wechat_unionid
        user.wechat_openid = openid or user.wechat_openid
        user.wechat_platform = platform
        user.last_login_at = current_millis()
        user.updated_at = current_millis()

    db.flush()
    accounts.bind_identity(db, user, provider, openid)
    if unionid and union_provider:
        accounts.bind_identity(db, user, union_provider, unionid)
    db.commit()
    need_bind_phone = not bool(user.phone_number and user.is_phone_verified)
    return build_auth_session_response(
        db=db,
        user=user,
        need_bind_phone=need_bind_phone,
        is_new_user=is_new_user,
    )


@app.post("/auth/wechat/mobile/login", response_model=schemas.AuthSessionResponse)
def wechat_mobile_login(payload: schemas.WeChatMobileLoginRequest, request: Request, db: Session = Depends(get_db)):
    accounts.rate_limit(db, f"wechat:{request.client.host if request.client else 'unknown'}", 30, 600)
    platform = normalize_mobile_platform(payload.platform)
    identity = exchange_wechat_mobile_code(payload.code, platform)
    return finish_wechat_login(db, identity, platform, WECHAT_APP_ID)


@app.post("/auth/wechat/miniapp/login", response_model=schemas.AuthSessionResponse)
def wechat_miniapp_login(payload: schemas.MiniAppLoginRequest, request: Request, db: Session = Depends(get_db)):
    accounts.rate_limit(db, f"miniapp:{request.client.host if request.client else 'unknown'}", 30, 600)
    appid, identity = accounts.exchange_miniapp_code(payload.code)
    return finish_wechat_login(db, identity, "weapp", appid)


@app.post("/auth/phone/send-code", response_model=schemas.PhoneSendCodeResponse)
def send_phone_code(
    payload: schemas.PhoneSendCodeRequest, request: Request,
    db: Session = Depends(get_db),
    current_user: Optional[models.User] = Depends(get_optional_current_user),
):
    if payload.scene == "bind_wechat_phone" and current_user is None:
        raise HTTPException(401, "Sign in before binding a phone")
    return accounts.send_code(
        db, payload.phone_number, payload.scene,
        current_user.id if payload.scene == "bind_wechat_phone" else "",
        request.client.host if request.client else "unknown",
    )


@app.post("/auth/wechat/bind-phone", response_model=schemas.User)
def bind_wechat_phone(
    payload: schemas.WeChatBindPhoneRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    phone_number = accounts.phone(payload.phone_number)
    if current_user.is_phone_verified and current_user.phone_number != phone_number:
        raise HTTPException(409, "Phone replacement requires a separate recovery flow")
    accounts.consume_code(db, phone_number, "bind_wechat_phone", current_user.id, payload.verify_code)

    existing_user = db.query(models.User).filter(
        models.User.phone_number == phone_number,
        models.User.id != current_user.id
    ).first()
    if existing_user is not None:
        raise HTTPException(status_code=409, detail="Phone number already bound to another account")

    accounts.bind_identity(db, current_user, "phone", phone_number)
    current_user.phone_number = phone_number
    current_user.is_phone_verified = True
    current_user.phone_bound_at = current_millis()
    current_user.updated_at = current_millis()
    if not current_user.pei_pei_id:
        current_user.pei_pei_id = generate_pei_pei_id(db, prefix="wx")

    db.commit()
    db.refresh(current_user)
    return hydrate_user_profile_metrics(db, current_user)


def finish_phone_login(db: Session, number: str):
    identity = accounts.verified_identity(db, "phone", number)
    user = db.get(models.User, identity.user_id) if identity else None
    if user is None:
        legacy = db.query(models.User).filter(models.User.phone_number == number).all()
        if len(legacy) > 1:
            raise HTTPException(409, "Duplicate phone requires account recovery")
        user = legacy[0] if legacy else None
    is_new = user is None
    if user is None:
        user = models.User(id=str(uuid.uuid4()), name="", phone_number=number,
                           pei_pei_id=generate_pei_pei_id(db), created_at=current_millis())
        db.add(user)
        db.flush()
    accounts.bind_identity(db, user, "phone", number)
    user.is_phone_verified = True
    user.phone_bound_at = user.phone_bound_at or current_millis()
    user.last_login_at = current_millis()
    user.updated_at = current_millis()
    db.commit()
    return build_auth_session_response(db, user, False, is_new)


@app.post("/auth/phone/login", response_model=schemas.AuthSessionResponse)
def phone_login(payload: schemas.PhoneLoginRequest, request: Request, db: Session = Depends(get_db)):
    accounts.rate_limit(db, f"phone-login:{request.client.host if request.client else 'unknown'}", 30, 600)
    number = accounts.phone(payload.phone_number)
    accounts.consume_code(db, number, "login", "", payload.verify_code)
    return finish_phone_login(db, number)


@app.post("/auth/phone/one-key/login", response_model=schemas.AuthSessionResponse)
def one_key_login(payload: schemas.OneKeyLoginRequest, request: Request, db: Session = Depends(get_db)):
    accounts.rate_limit(db, f"one-key:{request.client.host if request.client else 'unknown'}", 30, 600)
    result = accounts.aliyun_rpc("dypnsapi.aliyuncs.com", "GetMobile", "2017-05-25",
                                 {"AccessToken": payload.access_token})
    number = accounts.phone((result.get("GetMobileResultDTO") or {}).get("Mobile"))
    return finish_phone_login(db, number)


@app.post("/auth/refresh", response_model=schemas.Token)
def refresh_session(payload: schemas.RefreshSessionRequest, db: Session = Depends(get_db)):
    return accounts.rotate_session(db, payload.refresh_token)


@app.post("/auth/logout")
def logout_session(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    session, _ = accounts.resolve_session(db, token)
    session.revoked_at = current_millis()
    db.commit()
    return {"success": True}


@app.post("/auth/logout-all")
def logout_all_sessions(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    _, user = accounts.resolve_session(db, token)
    db.query(models.AuthSession).filter_by(user_id=user.id, revoked_at=0).update(
        {"revoked_at": current_millis()}, synchronize_session=False)
    db.commit()
    return {"success": True}


@app.get("/me/wishlist/services", response_model=schemas.FavoriteServicesResponse)
def get_my_favorite_services(current_user: models.User = Depends(get_current_user)):
    return schemas.FavoriteServicesResponse(service_ids=current_user.favorite_service_ids or [])


@app.get("/me/wishlist/profile", response_model=schemas.WishlistProfileResponse)
def get_my_wishlist_profile(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    return _load_wishlist_profile(db, current_user)


@app.put("/me/wishlist/services", response_model=schemas.FavoriteServicesResponse)
def update_my_favorite_services(
    payload: schemas.FavoriteServicesUpdateRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    response = _persist_wishlist_profile(db, current_user, payload.service_ids)
    try:
        db.commit()
        db.refresh(current_user)
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    return schemas.FavoriteServicesResponse(service_ids=response.service_ids)


@app.get("/me/wishlist/experiences", response_model=schemas.FavoriteExperiencesResponse)
def get_my_favorite_experiences(current_user: models.User = Depends(get_current_user)):
    return schemas.FavoriteExperiencesResponse(
        experience_ids=_dedupe_non_empty_ids(current_user.favorite_experience_ids or [])
    )


@app.put("/me/wishlist/experiences", response_model=schemas.FavoriteExperiencesResponse)
def update_my_favorite_experiences(
    payload: schemas.FavoriteExperiencesUpdateRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    normalized_experience_ids = _filter_existing_experience_ids(db, payload.experience_ids)
    current_user.favorite_experience_ids = normalized_experience_ids
    current_user.updated_at = int(time.time() * 1000)
    try:
        db.commit()
        db.refresh(current_user)
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    return schemas.FavoriteExperiencesResponse(experience_ids=normalized_experience_ids)


@app.put("/me/wishlist/profile", response_model=schemas.WishlistProfileResponse)
def update_my_wishlist_profile(
    payload: schemas.WishlistProfileUpdateRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    response = _persist_wishlist_profile(db, current_user, payload.service_ids, payload.groups)
    try:
        db.commit()
        db.refresh(current_user)
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    return response


@app.post("/feedbacks", response_model=schemas.Feedback)
def create_feedback(
    payload: schemas.FeedbackCreate,
    db: Session = Depends(get_db),
    current_user: Optional[models.User] = Depends(get_optional_current_user),
):
    content = (payload.content or "").strip()
    if not content:
        raise HTTPException(status_code=400, detail="Feedback content is required")
    now = current_millis()
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
    try:
        db.commit()
        db.refresh(item)
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc))
    return item


@app.get("/me/feedbacks", response_model=List[schemas.Feedback])
def list_my_feedbacks(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    items = db.query(models.Feedback).filter(
        models.Feedback.user_id == current_user.id
    ).order_by(desc(models.Feedback.created_at), desc(models.Feedback.updated_at)).all()
    return items

@app.post("/service/upload", response_model=schemas.ChatUploadResponse)
async def upload_service_file(
    file: UploadFile = File(...),
    current_user: models.User = Depends(get_current_user)
):
    result = _upload_media(file=file, current_user=current_user, biz="service")
    return schemas.ChatUploadResponse(
        url=result.url,
        object_key=result.object_key
    )


@app.post("/experience/upload", response_model=schemas.ChatUploadResponse)
async def upload_experience_file(
    file: UploadFile = File(...),
    current_user: models.User = Depends(get_current_user)
):
    result = _upload_media(file=file, current_user=current_user, biz="experience")
    return schemas.ChatUploadResponse(
        url=result.url,
        object_key=result.object_key
    )

@app.post("/services/", response_model=schemas.Service)
def create_service(
    service: schemas.ServiceCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    ensure_field_matches_current_user(current_user, service.creator_id, "creator_id")
    db_item = models.Service(**service.model_dump())
    db_item.sort_priority = 0
    apply_owner_service_review_state(db_item)
    db.add(db_item)
    try:
        db.commit()
        db.refresh(db_item)
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    return db_item

@app.put("/services/{service_id}", response_model=schemas.Service)
def update_service(
    service_id: str,
    service: schemas.ServiceCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    db_item = db.query(models.Service).filter(
        models.Service.id == service_id
    ).first()
    if db_item is None:
        raise HTTPException(status_code=404, detail="Service not found")
    ensure_record_owner(db_item, current_user, "creator_id")
    ensure_field_matches_current_user(current_user, service.creator_id, "creator_id")
    previous_review_status = db_item.review_status or ""

    update_data = service.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        if key in {"id", "creator_id", "created_at", "sort_priority"}:
            continue
        setattr(db_item, key, value)
    apply_owner_service_review_state(db_item, previous_review_status)
    db_item.updated_at = int(time.time() * 1000)

    try:
        db.commit()
        db.refresh(db_item)
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    return db_item

@app.get("/services/", response_model=List[schemas.Service])
def read_services(
    user_id: Optional[str] = None,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    owner_id = ensure_optional_self_access(current_user, user_id)
    query = db.query(models.Service).filter(models.Service.creator_id == owner_id)
    return query.order_by(desc(models.Service.updated_at), desc(models.Service.created_at)).offset(skip).limit(limit).all()


@app.get("/services/discovery", response_model=List[schemas.Service])
def list_square_discovery_services(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=200),
    updated_after: Optional[int] = Query(None, ge=0),
    db: Session = Depends(get_db),
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


@app.get("/services/{service_id}", response_model=schemas.Service)
def read_service_detail(
    service_id: str,
    db: Session = Depends(get_db),
    current_user: Optional[models.User] = Depends(get_optional_current_user)
):
    db_item = db.query(models.Service).filter(models.Service.id == service_id).first()
    if db_item is None:
        raise HTTPException(status_code=404, detail="Service not found")
    if not can_view_service(db_item, current_user):
        raise HTTPException(status_code=404, detail="Service not found")
    return db_item

@app.delete("/services/{service_id}", response_model=schemas.Service)
def delete_service(
    service_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    db_item = db.query(models.Service).filter(models.Service.id == service_id).first()
    if db_item is None:
        raise HTTPException(status_code=404, detail="Service not found")
    ensure_record_owner(db_item, current_user, "creator_id")
    db_item.is_deleted = True
    db_item.review_status = "rejected"
    db_item.updated_at = int(time.time() * 1000)
    try:
        db.commit()
        db.refresh(db_item)
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    return db_item


@app.post("/experiences/", response_model=schemas.Experience)
def create_experience(
    experience: schemas.ExperienceCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    ensure_field_matches_current_user(current_user, experience.host_id, "host_id")
    db_item = models.Experience(**experience.model_dump())
    db_item.average_rating = compute_experience_rating_for_host(db, experience.host_id)
    apply_owner_experience_review_state(db_item)
    db.add(db_item)
    try:
        db.commit()
        db.refresh(db_item)
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    return db_item


@app.put("/experiences/{experience_id}", response_model=schemas.Experience)
def update_experience(
    experience_id: str,
    experience: schemas.ExperienceCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    db_item = db.query(models.Experience).filter(
        models.Experience.id == experience_id,
        models.Experience.is_deleted == False
    ).first()
    if db_item is None:
        raise HTTPException(status_code=404, detail="Experience not found")
    ensure_record_owner(db_item, current_user, "host_id")
    ensure_field_matches_current_user(current_user, experience.host_id, "host_id")
    previous_review_status = db_item.review_status or ""

    update_data = experience.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        if key in {"id", "host_id", "created_at"}:
            continue
        setattr(db_item, key, value)
    db_item.average_rating = compute_experience_rating_for_host(db, experience.host_id)
    apply_owner_experience_review_state(db_item, previous_review_status)
    db_item.updated_at = int(time.time() * 1000)

    try:
        db.commit()
        db.refresh(db_item)
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    return db_item


@app.get("/experiences/", response_model=List[schemas.Experience])
def read_experiences(
    user_id: Optional[str] = None,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    owner_id = ensure_optional_self_access(current_user, user_id)
    query = db.query(models.Experience).filter(models.Experience.is_deleted == False)
    if owner_id:
        query = query.filter(models.Experience.host_id == owner_id)
    return query.order_by(desc(models.Experience.updated_at), desc(models.Experience.created_at)).offset(skip).limit(limit).all()


@app.get("/experiences/discovery", response_model=List[schemas.Experience])
def list_square_discovery_experiences(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=200),
    updated_after: Optional[int] = Query(None, ge=0),
    db: Session = Depends(get_db),
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


@app.get("/experiences/{experience_id}", response_model=schemas.Experience)
def read_experience_detail(
    experience_id: str,
    db: Session = Depends(get_db),
    current_user: Optional[models.User] = Depends(get_optional_current_user)
):
    db_item = db.query(models.Experience).filter(
        models.Experience.id == experience_id
    ).first()
    if db_item is None:
        raise HTTPException(status_code=404, detail="Experience not found")
    if not can_view_experience(db_item, current_user):
        raise HTTPException(status_code=404, detail="Experience not found")
    return db_item


@app.delete("/experiences/{experience_id}", response_model=schemas.Experience)
def delete_experience(
    experience_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    db_item = db.query(models.Experience).filter(models.Experience.id == experience_id).first()
    if db_item is None:
        raise HTTPException(status_code=404, detail="Experience not found")
    ensure_record_owner(db_item, current_user, "host_id")
    db_item.is_deleted = True
    db_item.review_status = "rejected"
    db_item.updated_at = int(time.time() * 1000)
    try:
        db.commit()
        db.refresh(db_item)
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    return db_item


@app.get("/admin")
@app.get("/admin/")
def admin_page():
    if not os.path.isfile(ADMIN_INDEX_PATH):
        raise HTTPException(status_code=404, detail="Admin page not found")
    return FileResponse(ADMIN_INDEX_PATH)


@app.get("/admin/api/config")
def admin_config():
    return {
        "requires_token": bool(ADMIN_TOKEN),
        "password_login_enabled": bool(ADMIN_PASSWORD),
        "default_username": ADMIN_USERNAME,
        "display_name": ADMIN_DISPLAY_NAME,
        "session_expire_hours": ADMIN_SESSION_EXPIRE_HOURS,
    }


@app.post("/admin/api/auth/login", response_model=schemas.AdminLoginResponse)
def admin_login(payload: schemas.AdminLoginRequest):
    username = (payload.username or "").strip() or ADMIN_USERNAME
    password = payload.password or ""
    if not verify_admin_credentials(username, password):
        raise HTTPException(status_code=401, detail="账号或密码错误")
    token = create_admin_access_token(ADMIN_DISPLAY_NAME, role="super_admin")
    return schemas.AdminLoginResponse(
        token=token,
        display_name=ADMIN_DISPLAY_NAME,
        role="super_admin",
        expires_in_seconds=ADMIN_SESSION_EXPIRE_HOURS * 3600,
    )


@app.get("/admin/api/overview")
def admin_overview(
    _: None = Depends(require_admin_access),
    db: Session = Depends(get_db),
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
        "registration_series": build_registration_series(db, days=14),
        "provider_distribution": [
            {"provider": provider, "count": count}
            for provider, count in sorted(provider_stats.items(), key=lambda item: (-item[1], item[0]))
        ],
        "recent_registrations": [serialize_admin_user(db, item) for item in recent_users],
        "review_queue": build_review_queue(db, limit=8),
    }


@app.get("/admin/api/review-queue")
def admin_review_queue(
    limit: int = Query(20, ge=1, le=100),
    _: None = Depends(require_admin_access),
    db: Session = Depends(get_db),
):
    return {
        "items": build_review_queue(db, limit=limit),
    }


@app.post("/admin/api/reviews/batch")
def admin_batch_review(
    payload: AdminReviewBatchPayload,
    admin_identity: Dict[str, str] = Depends(require_admin_access),
    db: Session = Depends(get_db),
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
    actor = admin_identity.get("actor") or ADMIN_DISPLAY_NAME
    for row in items:
        biz_type = (row.biz_type or "").strip()
        item_id = (row.item_id or "").strip()
        if biz_type == "service":
            item = db.query(models.Service).filter(models.Service.id == item_id).first()
            if item is None:
                continue
            apply_admin_service_update(item, AdminServiceUpdatePayload(
                review_status=review_status,
                review_note=note or ("审核通过" if review_status == "approved" else ""),
            ))
            append_admin_operation_log(
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
            apply_admin_experience_update(item, AdminExperienceUpdatePayload(
                review_status=review_status,
                review_note=note or ("审核通过" if review_status == "approved" else ""),
            ))
            append_admin_operation_log(
                db,
                actor,
                f"batch_{review_status}",
                "experience",
                item.id,
                f"{actor}批量{'通过' if review_status == 'approved' else '驳回'}了体验《{item.title or item.id}》",
                note,
            )
            processed.append({"biz_type": "experience", "item_id": item.id})
    try:
        db.commit()
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc))
    return {
        "processed_count": len(processed),
        "items": processed,
    }


@app.get("/admin/api/users")
def admin_list_users(
    q: str = Query("", description="按昵称、ID、手机号搜索"),
    provider: str = Query("all"),
    verification: str = Query("all"),
    page: int = Query(1, ge=1),
    page_size: int = Query(12, ge=1, le=MAX_ADMIN_PAGE_SIZE),
    _: None = Depends(require_admin_access),
    db: Session = Depends(get_db),
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
        "items": [serialize_admin_user(db, item) for item in items],
        "total": int(total),
        "page": page,
        "page_size": page_size,
    }


@app.patch("/admin/api/users/{user_id}")
def admin_update_user(
    user_id: str,
    payload: AdminUserUpdatePayload,
    admin_identity: Dict[str, str] = Depends(require_admin_access),
    db: Session = Depends(get_db),
):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    apply_admin_user_update(user, payload)
    actor = admin_identity.get("actor") or ADMIN_DISPLAY_NAME
    append_admin_operation_log(
        db,
        actor,
        "update_user",
        "user",
        user.id,
        f"{actor}更新了用户 {user.name or user.id} 的后台状态",
        json.dumps(payload.model_dump(exclude_none=True), ensure_ascii=False),
    )
    try:
        db.commit()
        db.refresh(user)
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc))
    return serialize_admin_user(db, user)


@app.get("/admin/api/services")
def admin_list_services(
    q: str = Query("", description="按标题、ID、地点搜索"),
    status: str = Query("all"),
    category: str = Query("all"),
    page: int = Query(1, ge=1),
    page_size: int = Query(12, ge=1, le=MAX_ADMIN_PAGE_SIZE),
    _: None = Depends(require_admin_access),
    db: Session = Depends(get_db),
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
        "items": [serialize_admin_service(db, item) for item in items],
        "total": int(total),
        "page": page,
        "page_size": page_size,
    }


@app.get("/admin/api/services/{service_id}")
def admin_get_service_detail(
    service_id: str,
    _: Dict[str, str] = Depends(require_admin_access),
    db: Session = Depends(get_db),
):
    item = db.query(models.Service).filter(models.Service.id == service_id).first()
    if item is None:
        raise HTTPException(status_code=404, detail="Service not found")
    return serialize_admin_service(db, item)


@app.patch("/admin/api/services/{service_id}")
def admin_update_service(
    service_id: str,
    payload: AdminServiceUpdatePayload,
    admin_identity: Dict[str, str] = Depends(require_admin_access),
    db: Session = Depends(get_db),
):
    item = db.query(models.Service).filter(models.Service.id == service_id).first()
    if item is None:
        raise HTTPException(status_code=404, detail="Service not found")
    apply_admin_service_update(item, payload)
    actor = admin_identity.get("actor") or ADMIN_DISPLAY_NAME
    append_admin_operation_log(
        db,
        actor,
        "update_service",
        "service",
        item.id,
        f"{actor}更新了服务《{item.title or item.id}》",
        json.dumps(payload.model_dump(exclude_none=True), ensure_ascii=False),
    )
    try:
        db.commit()
        db.refresh(item)
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc))
    return serialize_admin_service(db, item)


@app.get("/admin/api/experiences")
def admin_list_experiences(
    q: str = Query("", description="按标题、ID、地点搜索"),
    status: str = Query("all"),
    category: str = Query("all"),
    page: int = Query(1, ge=1),
    page_size: int = Query(12, ge=1, le=MAX_ADMIN_PAGE_SIZE),
    _: None = Depends(require_admin_access),
    db: Session = Depends(get_db),
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
        "items": [serialize_admin_experience(db, item) for item in items],
        "total": int(total),
        "page": page,
        "page_size": page_size,
    }


@app.get("/admin/api/experiences/{experience_id}")
def admin_get_experience_detail(
    experience_id: str,
    _: Dict[str, str] = Depends(require_admin_access),
    db: Session = Depends(get_db),
):
    item = db.query(models.Experience).filter(models.Experience.id == experience_id).first()
    if item is None:
        raise HTTPException(status_code=404, detail="Experience not found")
    return serialize_admin_experience(db, item)


@app.patch("/admin/api/experiences/{experience_id}")
def admin_update_experience(
    experience_id: str,
    payload: AdminExperienceUpdatePayload,
    admin_identity: Dict[str, str] = Depends(require_admin_access),
    db: Session = Depends(get_db),
):
    item = db.query(models.Experience).filter(models.Experience.id == experience_id).first()
    if item is None:
        raise HTTPException(status_code=404, detail="Experience not found")
    apply_admin_experience_update(item, payload)
    actor = admin_identity.get("actor") or ADMIN_DISPLAY_NAME
    append_admin_operation_log(
        db,
        actor,
        "update_experience",
        "experience",
        item.id,
        f"{actor}更新了体验《{item.title or item.id}》",
        json.dumps(payload.model_dump(exclude_none=True), ensure_ascii=False),
    )
    try:
        db.commit()
        db.refresh(item)
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc))
    return serialize_admin_experience(db, item)


@app.get("/admin/api/feedbacks")
def admin_list_feedbacks(
    q: str = Query("", description="按内容、用户、联系方式搜索"),
    status: str = Query("all"),
    category: str = Query("all"),
    page: int = Query(1, ge=1),
    page_size: int = Query(12, ge=1, le=MAX_ADMIN_PAGE_SIZE),
    _: None = Depends(require_admin_access),
    db: Session = Depends(get_db),
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
        "items": [serialize_admin_feedback(item) for item in items],
        "total": int(total),
        "page": page,
        "page_size": page_size,
    }


@app.patch("/admin/api/feedbacks/{feedback_id}")
def admin_update_feedback(
    feedback_id: str,
    payload: AdminFeedbackUpdatePayload,
    admin_identity: Dict[str, str] = Depends(require_admin_access),
    db: Session = Depends(get_db),
):
    item = db.query(models.Feedback).filter(models.Feedback.id == feedback_id).first()
    if item is None:
        raise HTTPException(status_code=404, detail="Feedback not found")
    apply_admin_feedback_update(item, payload)
    actor = admin_identity.get("actor") or ADMIN_DISPLAY_NAME
    append_admin_operation_log(
        db,
        actor,
        "update_feedback",
        "feedback",
        item.id,
        f"{actor}更新了反馈 {item.id} 的处理状态",
        json.dumps(payload.model_dump(exclude_none=True), ensure_ascii=False),
    )
    try:
        db.commit()
        db.refresh(item)
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc))
    return serialize_admin_feedback(item)


@app.get("/admin/api/operation-logs")
def admin_list_operation_logs(
    page: int = Query(1, ge=1),
    page_size: int = Query(12, ge=1, le=MAX_ADMIN_PAGE_SIZE),
    _: Dict[str, str] = Depends(require_admin_access),
    db: Session = Depends(get_db),
):
    query = db.query(models.AdminOperationLog)
    total = query.count()
    items = query.order_by(desc(models.AdminOperationLog.created_at)).offset((page - 1) * page_size).limit(page_size).all()
    return {
        "items": [serialize_admin_operation_log(item) for item in items],
        "total": int(total),
        "page": page,
        "page_size": page_size,
    }

@app.get("/")
def read_root():
    """
    根路径，用于检查 API 是否运行
    """
    return {"message": "Lulu API is running"}

@app.get("/healthz")
def healthz():
    return {"status": "ok", "environment": APP_ENV}

if __name__ == "__main__":
    import uvicorn

    host = os.getenv("LULU_HOST", "0.0.0.0")
    port = int(os.getenv("LULU_PORT", "8000"))
    uvicorn.run(app, host=host, port=port)


@app.post("/chat/upload", response_model=schemas.ChatUploadResponse)
async def upload_chat_file(
    file: UploadFile = File(...),
    current_user: models.User = Depends(get_current_user)
):
    result = _upload_media(file=file, current_user=current_user, biz="chat")
    return schemas.ChatUploadResponse(
        url=result.url,
        object_key=result.object_key
    )


@app.post("/chat/conversations/direct/{peer_id}", response_model=schemas.ConversationListItem)
def create_direct_conversation(
    peer_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    conversation = get_or_create_direct_conversation(db, current_user, peer_id)
    return serialize_conversation_item(conversation, current_user, db)


@app.get("/chat/conversations", response_model=List[schemas.ConversationListItem])
def list_conversations(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    members = db.query(models.ConversationMember).filter(
        models.ConversationMember.user_id == current_user.id
    ).all()
    conversation_ids = [member.conversation_id for member in members]
    if not conversation_ids:
        return []
    conversations = db.query(models.Conversation).filter(
        models.Conversation.id.in_(conversation_ids),
        models.Conversation.is_deleted == False
    ).order_by(desc(models.Conversation.last_message_at), desc(models.Conversation.updated_at)).all()
    return [serialize_conversation_item(item, current_user, db) for item in conversations]


@app.get("/chat/conversations/{conversation_id}/messages", response_model=List[schemas.ChatMessage])
def list_chat_messages(
    conversation_id: str,
    limit: int = Query(100, ge=1, le=500),
    before: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    ensure_conversation_member(conversation_id, current_user, db)
    query = db.query(models.ChatMessage).filter(
        models.ChatMessage.conversation_id == conversation_id,
        models.ChatMessage.is_deleted == False
    )
    if before is not None:
        query = query.filter(models.ChatMessage.created_at < before)
    items = query.order_by(desc(models.ChatMessage.created_at)).limit(limit).all()
    return list(reversed(items))


@app.post("/chat/conversations/{conversation_id}/messages", response_model=schemas.ChatMessage)
async def send_chat_message(
    conversation_id: str,
    payload: schemas.ChatMessageCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    conversation, _ = ensure_conversation_member(conversation_id, current_user, db)
    now = int(time.time() * 1000)
    message = models.ChatMessage(
        id=str(uuid.uuid4()),
        conversation_id=conversation_id,
        sender_id=current_user.id,
        type=payload.type,
        content=payload.content,
        attachment_url=payload.attachment_url,
        attachment_name=payload.attachment_name,
        attachment_size=payload.attachment_size,
        object_key=payload.object_key,
        extra=payload.extra or {},
        client_message_id=payload.client_message_id,
        status="sent",
        created_at=now,
        updated_at=now,
    )
    db.add(message)
    preview = build_message_preview(payload.type, payload.content, payload.attachment_name)
    conversation.last_message_id = message.id
    conversation.last_message_preview = preview
    conversation.last_message_at = now
    conversation.updated_at = now

    participants = conversation.participant_ids or []
    members = db.query(models.ConversationMember).filter(
        models.ConversationMember.conversation_id == conversation_id
    ).all()
    for member in members:
        if member.user_id == current_user.id:
            member.last_read_message_id = message.id
            member.last_read_at = now
        else:
            member.unread_count = (member.unread_count or 0) + 1
        member.updated_at = now
    db.commit()
    db.refresh(message)

    event = {
        "type": "chat_message",
        "conversation_id": conversation_id,
        "message": schemas.ChatMessage.model_validate(message).model_dump(mode="json"),
    }
    await chat_hub.publish_to_users(participants, event)
    return message


@app.post("/chat/conversations/{conversation_id}/read", response_model=schemas.ConversationMember)
async def mark_conversation_read(
    conversation_id: str,
    payload: schemas.ChatMessageReadRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    conversation, member = ensure_conversation_member(conversation_id, current_user, db)
    now = int(time.time() * 1000)
    message_id = payload.message_id or conversation.last_message_id
    member.unread_count = 0
    member.last_read_message_id = message_id
    member.last_read_at = now
    member.updated_at = now
    db.commit()
    db.refresh(member)
    await chat_hub.publish_to_users(
        conversation.participant_ids or [],
        {
            "type": "conversation_read",
            "conversation_id": conversation_id,
            "user_id": current_user.id,
            "message_id": message_id,
            "read_at": now,
        }
    )
    return member


@app.websocket("/ws/chat")
async def chat_websocket(websocket: WebSocket, token: str):
    db = SessionLocal()
    user = None
    try:
        user = get_ws_user(token, db)
        session_id = accounts.resolve_session(db, token)[0].id
        await websocket.accept()
        await chat_hub.register(user.id, websocket)
        await websocket.send_json({"type": "connected", "user_id": user.id})
        while True:
            db.rollback()
            db.expire_all()
            live_session = db.get(models.AuthSession, session_id)
            if live_session is None or live_session.revoked_at or live_session.expires_at <= current_millis():
                raise HTTPException(401, "Session revoked")
            try:
                raw = await asyncio.wait_for(websocket.receive_text(), timeout=20)
            except asyncio.TimeoutError:
                continue
            try:
                payload = json.loads(raw)
            except Exception:
                await websocket.send_json({"type": "error", "detail": "Invalid JSON"})
                continue
            if payload.get("type") == "ping":
                await websocket.send_json({"type": "pong"})
    except WebSocketDisconnect:
        pass
    except HTTPException:
        try:
            await websocket.close(code=4401)
        except Exception:
            pass
    finally:
        if user is not None:
            await chat_hub.unregister(user.id, websocket)
        db.close()

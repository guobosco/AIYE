from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from typing import Optional
import uuid
import os
try:
    from . import core
    from .errors import commit_and_refresh
    from .core import models, schemas, accounts
except ImportError:
    import core
    from errors import commit_and_refresh
    from core import models, schemas, accounts

router = APIRouter()

@router.post("/users/register", response_model=schemas.User)
def register_user(user: schemas.UserCreate, request: Request, db: Session = Depends(core.get_db)):
    number = accounts.phone(user.phone_number)
    accounts.rate_limit(db, f"register:{request.client.host if request.client else 'unknown'}", 10, 3600)
    if len(user.password) < 6 or len(user.password.encode("utf-8")) > 72:
        raise HTTPException(400, "Password must be at least 6 characters and at most 72 bytes")
    accounts.consume_code(db, number, "register", "", user.verify_code)
    if db.query(models.User).filter(models.User.phone_number == number).first():
        raise HTTPException(400, "Phone number already registered")
    timestamp = core.current_millis()
    user_dict = {key: value for key, value in user.model_dump().items()
                 if key in accounts.PROFILE_FIELDS}
    user_dict.update(
        id=str(uuid.uuid4()), phone_number=number, is_phone_verified=True,
        phone_bound_at=timestamp, hashed_password=core.get_password_hash(user.password),
        created_at=timestamp, updated_at=timestamp, last_login_at=timestamp,
        login_provider="password",
    )
    if not user_dict.get("pei_pei_id"):
        user_dict["pei_pei_id"] = core.generate_pei_pei_id(db)
    db_user = models.User(**user_dict)
    db.add(db_user)
    db.flush()
    accounts.bind_identity(db, db_user, "phone", number)
    commit_and_refresh(db, db_user)
    return core.hydrate_user_profile_metrics(db, db_user)


@router.post("/users/login", response_model=schemas.User)
def login_user(login_data: schemas.UserLogin):
    """
    用户登录
    """
    raise HTTPException(410, "Use /auth/token to sign in")


@router.post("/auth/token", response_model=schemas.Token)
def login_for_access_token(request: Request, form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(core.get_db)):
    ip = request.client.host if request.client else "unknown"
    accounts.rate_limit(db, f"password-ip:{ip}", 60, 600)
    accounts.rate_limit(db, f"password-user:{form_data.username}", 10, 600)
    user = db.query(models.User).filter(models.User.phone_number == form_data.username).first()
    if not user:
        raise HTTPException(status_code=401, detail="Invalid phone number or password")
    if not user.hashed_password:
        raise HTTPException(status_code=401, detail="Invalid phone number or password")
    if not core.verify_password(form_data.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid phone number or password")
    user.last_login_at = core.current_millis()
    user.updated_at = core.current_millis()
    db.commit()
    return accounts.issue_session(db, user)


@router.get("/auth/me", response_model=schemas.User)
def read_me(
    current_user: models.User = Depends(core.get_current_user),
    db: Session = Depends(core.get_db),
):
    return core.hydrate_user_profile_metrics(db, current_user)


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
        timestamp = core.current_millis()
        user = models.User(
            id=str(uuid.uuid4()),
            pei_pei_id=core.generate_pei_pei_id(db, prefix="wx"),
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
        user.last_login_at = core.current_millis()
        user.updated_at = core.current_millis()

    db.flush()
    accounts.bind_identity(db, user, provider, openid)
    if unionid and union_provider:
        accounts.bind_identity(db, user, union_provider, unionid)
    db.commit()
    need_bind_phone = not bool(user.phone_number and user.is_phone_verified)
    return core.build_auth_session_response(
        db=db,
        user=user,
        need_bind_phone=need_bind_phone,
        is_new_user=is_new_user,
    )


@router.post("/auth/wechat/mobile/login", response_model=schemas.AuthSessionResponse)
def wechat_mobile_login(payload: schemas.WeChatMobileLoginRequest, request: Request, db: Session = Depends(core.get_db)):
    accounts.rate_limit(db, f"wechat:{request.client.host if request.client else 'unknown'}", 30, 600)
    platform = core.normalize_mobile_platform(payload.platform)
    identity = core.exchange_wechat_mobile_code(payload.code, platform)
    return finish_wechat_login(db, identity, platform, core.WECHAT_APP_ID)


@router.post("/auth/wechat/miniapp/login", response_model=schemas.AuthSessionResponse)
def wechat_miniapp_login(payload: schemas.MiniAppLoginRequest, request: Request, db: Session = Depends(core.get_db)):
    accounts.rate_limit(db, f"miniapp:{request.client.host if request.client else 'unknown'}", 30, 600)
    appid, identity = accounts.exchange_miniapp_code(payload.code)
    return finish_wechat_login(db, identity, "weapp", appid)


@router.post("/auth/phone/send-code", response_model=schemas.PhoneSendCodeResponse)
def send_phone_code(
    payload: schemas.PhoneSendCodeRequest, request: Request,
    db: Session = Depends(core.get_db),
    current_user: Optional[models.User] = Depends(core.get_optional_current_user),
):
    if payload.scene == "bind_wechat_phone" and current_user is None:
        raise HTTPException(401, "Sign in before binding a phone")
    return accounts.send_code(
        db, payload.phone_number, payload.scene,
        current_user.id if payload.scene == "bind_wechat_phone" else "",
        request.client.host if request.client else "unknown",
    )


@router.post("/auth/wechat/bind-phone", response_model=schemas.User)
def bind_wechat_phone(
    payload: schemas.WeChatBindPhoneRequest,
    db: Session = Depends(core.get_db),
    current_user: models.User = Depends(core.get_current_user)
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
    current_user.phone_bound_at = core.current_millis()
    current_user.updated_at = core.current_millis()
    if not current_user.pei_pei_id:
        current_user.pei_pei_id = core.generate_pei_pei_id(db, prefix="wx")

    db.commit()
    db.refresh(current_user)
    return core.hydrate_user_profile_metrics(db, current_user)


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
                           pei_pei_id=core.generate_pei_pei_id(db), created_at=core.current_millis())
        db.add(user)
        db.flush()
    accounts.bind_identity(db, user, "phone", number)
    user.is_phone_verified = True
    user.phone_bound_at = user.phone_bound_at or core.current_millis()
    user.last_login_at = core.current_millis()
    user.updated_at = core.current_millis()
    db.commit()
    return core.build_auth_session_response(db, user, False, is_new)


@router.post("/auth/phone/login", response_model=schemas.AuthSessionResponse)
def phone_login(payload: schemas.PhoneLoginRequest, request: Request, db: Session = Depends(core.get_db)):
    accounts.rate_limit(db, f"phone-login:{request.client.host if request.client else 'unknown'}", 30, 600)
    number = accounts.phone(payload.phone_number)
    accounts.consume_code(db, number, "login", "", payload.verify_code)
    return finish_phone_login(db, number)


@router.post("/auth/phone/one-key/login", response_model=schemas.AuthSessionResponse)
def one_key_login(payload: schemas.OneKeyLoginRequest, request: Request, db: Session = Depends(core.get_db)):
    accounts.rate_limit(db, f"one-key:{request.client.host if request.client else 'unknown'}", 30, 600)
    result = accounts.aliyun_rpc("dypnsapi.aliyuncs.com", "GetMobile", "2017-05-25",
                                 {"AccessToken": payload.access_token})
    number = accounts.phone((result.get("GetMobileResultDTO") or {}).get("Mobile"))
    return finish_phone_login(db, number)


@router.post("/auth/refresh", response_model=schemas.Token)
def refresh_session(payload: schemas.RefreshSessionRequest, db: Session = Depends(core.get_db)):
    return accounts.rotate_session(db, payload.refresh_token)


@router.post("/auth/logout")
def logout_session(token: str = Depends(core.oauth2_scheme), db: Session = Depends(core.get_db)):
    session, _ = accounts.resolve_session(db, token)
    session.revoked_at = core.current_millis()
    db.commit()
    return {"success": True}


@router.post("/auth/logout-all")
def logout_all_sessions(token: str = Depends(core.oauth2_scheme), db: Session = Depends(core.get_db)):
    _, user = accounts.resolve_session(db, token)
    db.query(models.AuthSession).filter_by(user_id=user.id, revoked_at=0).update(
        {"revoked_at": core.current_millis()}, synchronize_session=False)
    db.commit()
    return {"success": True}

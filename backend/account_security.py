"""Server-owned identities, revocable sessions and shared verification challenges."""

import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import time
import uuid
from datetime import datetime, timezone
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

from fastapi import HTTPException
from jose import JWTError, jwt
from sqlalchemy import update
from sqlalchemy.exc import IntegrityError

try:
    from . import models
except ImportError:
    import models

SECRET = os.getenv("LULU_SECRET_KEY", "dev-secret")
ACCESS_MINUTES = int(os.getenv("LULU_ACCESS_TOKEN_EXPIRE_MINUTES", "15") or "15")
SESSION_DAYS = int(os.getenv("LULU_SESSION_EXPIRE_DAYS", "30"))
if ACCESS_MINUTES <= 0 or SESSION_DAYS <= 0:
    raise RuntimeError("Account token and session lifetimes must be positive")

# Full legacy User payloads remain accepted, but only these fields are mutable.
PROFILE_FIELDS = {
    "name", "email", "photo_url", "profile_image_urls", "signature", "memo",
    "gender", "region", "job_title", "education", "birth_decade", "height_cm",
    "weight_kg", "height_weight_private", "middle_school_favorite_song",
    "spoken_languages", "living_city", "living_country", "is_profile_completed",
    "address_detail", "address_recipient_name", "address_phone_number",
    "remark_name", "tags",
}


def millis():
    return int(time.time() * 1000)


def digest(value):
    return hmac.new(SECRET.encode(), value.encode(), hashlib.sha256).hexdigest()


def phone(value):
    value = (value or "").strip()
    if not re.fullmatch(r"1[3-9][0-9]{9}", value):
        raise HTTPException(400, "Invalid mainland mobile number")
    return value


def rate_limit(db, key, limit, window_seconds):
    """An atomic shared DB counter, not a per-process in-memory limit."""
    now = millis()
    bucket = digest(f"{key}:{now // (window_seconds * 1000)}")
    if db.get(models.AuthRateLimit, bucket) is None:
        try:
            with db.begin_nested():
                db.add(models.AuthRateLimit(key=bucket, window_start=now, count=0))
                db.flush()
        except IntegrityError:
            pass
    changed = db.execute(update(models.AuthRateLimit).where(
        models.AuthRateLimit.key == bucket,
        models.AuthRateLimit.count < limit,
    ).values(count=models.AuthRateLimit.count + 1)).rowcount
    db.commit()
    if not changed:
        raise HTTPException(429, "Too many attempts; try again later")


def issue_session(db, user):
    if db.get(models.AccountClosure, user.id):
        raise HTTPException(403, "Account unavailable")
    now = millis()
    had_session = db.query(models.AuthSession.id).filter_by(user_id=user.id).first() is not None
    refresh = secrets.token_urlsafe(48)
    row = models.AuthSession(
        id=uuid.uuid4().hex, user_id=user.id, refresh_hash=digest(refresh),
        created_at=now, expires_at=now + SESSION_DAYS * 86400000, revoked_at=0,
    )
    db.add(row)
    if had_session:
        try:
            from .consultation_service import notice
        except ImportError:
            from consultation_service import notice
        notice(db, user.id, row.id, "account", "账号发生新的登录，请检查登录会话", "", now)
    db.commit()
    return session_tokens(row, refresh)


def session_tokens(row, refresh):
    expires = min(millis() + ACCESS_MINUTES * 60000, row.expires_at)
    token = jwt.encode({
        "sub": row.user_id, "sid": row.id, "type": "access",
        "iat": int(time.time()), "exp": expires // 1000,
    }, SECRET, algorithm="HS256")
    return {
        "access_token": token, "token_type": "bearer",
        "refresh_token": refresh,
        "expires_in": max(0, (expires - millis()) // 1000),
        "session_id": row.id,
    }


def resolve_session(db, token):
    try:
        payload = jwt.decode(token, SECRET, algorithms=["HS256"],
                             options={"require_exp": True})
        if payload.get("type") != "access" or not payload.get("sid"):
            raise ValueError()
        row = db.get(models.AuthSession, payload["sid"])
        if (row is None or row.revoked_at or row.expires_at <= millis()
                or row.user_id != payload.get("sub")):
            raise ValueError()
        user = db.get(models.User, row.user_id)
        if user is None or db.get(models.AccountClosure, user.id):
            raise ValueError()
        return row, user
    except (JWTError, ValueError, KeyError):
        raise HTTPException(401, "Session expired or revoked; please sign in again")


def rotate_session(db, refresh):
    old_hash = digest(refresh)
    row = db.query(models.AuthSession).filter(
        models.AuthSession.refresh_hash == old_hash,
    ).first()
    if row is None:
        replay = db.query(models.AuthSession).filter(
            models.AuthSession.previous_refresh_hash == old_hash,
        ).first()
        if replay:
            replay.revoked_at = millis()
            db.commit()
        raise HTTPException(401, "Invalid refresh token")
    if row.revoked_at or row.expires_at <= millis() or db.get(models.AccountClosure, row.user_id):
        raise HTTPException(401, "Session expired or revoked")
    refresh = secrets.token_urlsafe(48)
    changed = db.execute(update(models.AuthSession).where(
        models.AuthSession.id == row.id, models.AuthSession.refresh_hash == old_hash,
        models.AuthSession.revoked_at == 0,
    ).values(refresh_hash=digest(refresh), previous_refresh_hash=old_hash)).rowcount
    db.commit()
    if changed != 1:
        raise HTTPException(401, "Refresh token already used")
    db.refresh(row)
    return session_tokens(row, refresh)


def verified_identity(db, provider, subject):
    return db.query(models.AuthIdentity).filter_by(
        provider=provider, subject=subject,
    ).first()


def bind_identity(db, user, provider, subject):
    existing = verified_identity(db, provider, subject)
    if existing:
        if existing.user_id != user.id:
            raise HTTPException(409, "Identity already belongs to another account")
        return
    db.add(models.AuthIdentity(
        id=uuid.uuid4().hex, user_id=user.id, provider=provider,
        subject=subject, verified_at=millis(),
    ))
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Identity already belongs to another account")


def provider_json(url, body=None):
    try:
        req = Request(url, data=body,
                      headers={"Content-Type": "application/x-www-form-urlencoded"})
        with urlopen(req, timeout=10) as response:
            return json.loads(response.read(1024 * 1024))
    except Exception:
        # Provider URLs and errors can contain credentials. Never return them.
        raise HTTPException(502, "Authentication provider unavailable")


def aliyun_rpc(host, action, version, params):
    key = os.getenv("LULU_ALIYUN_ACCESS_KEY_ID", "")
    secret = os.getenv("LULU_ALIYUN_ACCESS_KEY_SECRET", "")
    if not key or not secret:
        raise HTTPException(503, "Aliyun authentication service is not configured")
    values = {
        "AccessKeyId": key, "Action": action, "Version": version, "Format": "JSON",
        "SignatureMethod": "HMAC-SHA1", "SignatureVersion": "1.0",
        "SignatureNonce": uuid.uuid4().hex,
        "Timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        **params,
    }
    canonical = "&".join(f"{quote(k, safe='~')}={quote(str(v), safe='~')}"
                         for k, v in sorted(values.items()))
    signed = "POST&%2F&" + quote(canonical, safe="~")
    values["Signature"] = base64.b64encode(hmac.new(
        (secret + "&").encode(), signed.encode(), hashlib.sha1,
    ).digest()).decode()
    result = provider_json(f"https://{host}/", urlencode(values).encode())
    if result.get("Code") != "OK":
        raise HTTPException(502, "Authentication provider rejected the request")
    return result


def send_code(db, number, scene, owner, ip):
    number = phone(number)
    if scene not in {"login", "register", "bind_wechat_phone", "change_phone_old", "change_phone_new", "close_account"}:
        raise HTTPException(400, "Unsupported verification scene")
    rate_limit(db, f"sms-ip:{ip}", 20, 3600)
    rate_limit(db, f"sms-phone:{number}", 5, 3600)
    key = digest(f"phone:{number}:{scene}:{owner}")
    now = millis()
    row = db.get(models.PhoneChallenge, key)
    if row and now - row.created_at < 60000:
        raise HTTPException(429, "Wait 60 seconds before requesting another code")
    code = f"{secrets.randbelow(1000000):06d}"
    trace = uuid.uuid4().hex
    values = dict(
        code_hash=digest(f"{key}:{code}"), scene=scene, user_id=owner,
        trace_id=trace, created_at=now, expires_at=now + 300000,
        attempts=0, consumed=False,
    )
    if row:
        changed = db.execute(update(models.PhoneChallenge).where(
            models.PhoneChallenge.key == key,
            models.PhoneChallenge.created_at == row.created_at,
        ).values(**values)).rowcount
        if changed != 1:
            db.rollback()
            raise HTTPException(429, "Verification request already in progress")
    else:
        db.add(models.PhoneChallenge(key=key, **values))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(429, "Verification request already in progress")
    is_debug = (os.getenv("LULU_ENV", "development").lower() != "production"
                and os.getenv("LULU_ENABLE_DEBUG_PHONE_CODES") == "true")
    try:
        if not is_debug:
            sign = os.getenv("LULU_SMS_SIGN_NAME", "")
            template = os.getenv("LULU_SMS_TEMPLATE_CODE", "")
            if not sign or not template:
                raise HTTPException(503, "SMS service is not configured")
            aliyun_rpc("dysmsapi.aliyuncs.com", "SendSms", "2017-05-25", {
                "PhoneNumbers": number, "SignName": sign, "TemplateCode": template,
                "TemplateParam": json.dumps({"code": code}),
            })
    except HTTPException:
        db.execute(update(models.PhoneChallenge).where(
            models.PhoneChallenge.key == key,
            models.PhoneChallenge.trace_id == trace,
        ).values(consumed=True))
        db.commit()
        raise
    return dict(success=True, cooldown_seconds=60, trace_id=trace,
                debug_code=code if is_debug else None)


def consume_code(db, number, scene, owner, code):
    key = digest(f"phone:{phone(number)}:{scene}:{owner}")
    row = db.get(models.PhoneChallenge, key)
    if not row or row.consumed or row.expires_at <= millis() or row.attempts >= 5:
        raise HTTPException(400, "Verification code expired or unavailable")
    if not hmac.compare_digest(row.code_hash, digest(f"{key}:{code.strip()}")):
        trace_id = row.trace_id
        # Persist only the failed attempt, never earlier account/code mutations.
        db.rollback()
        db.execute(update(models.PhoneChallenge).where(
            models.PhoneChallenge.key == key, models.PhoneChallenge.trace_id == trace_id,
        ).values(attempts=models.PhoneChallenge.attempts + 1))
        db.commit()
        raise HTTPException(400, "Incorrect verification code")
    # Consumption and the account mutation share one transaction.
    changed = db.execute(update(models.PhoneChallenge).where(
        models.PhoneChallenge.key == key, models.PhoneChallenge.trace_id == row.trace_id,
        models.PhoneChallenge.consumed == False, models.PhoneChallenge.attempts < 5,
        models.PhoneChallenge.expires_at > millis(),
    ).values(consumed=True)).rowcount
    if changed != 1:
        raise HTTPException(400, "Verification code already used")


def exchange_miniapp_code(code):
    appid = os.getenv("LULU_WECHAT_MINI_APP_ID", "")
    secret = os.getenv("LULU_WECHAT_MINI_APP_SECRET", "")
    if not appid or not secret:
        raise HTTPException(503, "WeChat mini program authentication is not configured")
    result = provider_json("https://api.weixin.qq.com/sns/jscode2session?" + urlencode({
        "appid": appid, "secret": secret, "js_code": code,
        "grant_type": "authorization_code",
    }))
    if result.get("errcode") or not result.get("openid"):
        raise HTTPException(400, "Invalid WeChat mini program authorization code")
    return appid, result

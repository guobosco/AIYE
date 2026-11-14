from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session
from sqlalchemy import and_, desc, or_
from typing import List, Optional
from starlette.concurrency import run_in_threadpool
import time
import json
import asyncio
try:
    from . import core
    from .chat_service import persist_message
    from .errors import commit_and_refresh, logger
    from .core import models, schemas, accounts
except ImportError:
    import core
    from chat_service import persist_message
    from errors import commit_and_refresh, logger
    from core import models, schemas, accounts

router = APIRouter()

@router.post("/chat/conversations/direct/{peer_id}", response_model=schemas.ConversationListItem)
def create_direct_conversation(
    peer_id: str,
    db: Session = Depends(core.get_db),
    current_user: models.User = Depends(core.get_current_user)
):
    conversation = core.get_or_create_direct_conversation(db, current_user, peer_id)
    return core.serialize_conversation_item(conversation, current_user, db)


@router.get("/chat/conversations", response_model=List[schemas.ConversationListItem])
def list_conversations(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=200),
    db: Session = Depends(core.get_db),
    current_user: models.User = Depends(core.get_current_user)
):
    conversations = db.query(models.Conversation).filter(
        models.Conversation.id.in_(
            db.query(models.ConversationMember.conversation_id).filter(
                models.ConversationMember.user_id == current_user.id,
            )
        ),
        models.Conversation.is_deleted == False
    ).order_by(desc(models.Conversation.last_message_at), desc(models.Conversation.updated_at),
               desc(models.Conversation.id)).offset(skip).limit(limit).all()
    return core.serialize_conversation_items(conversations, current_user, db)


@router.get("/chat/conversations/{conversation_id}/messages", response_model=List[schemas.ChatMessage])
def list_chat_messages(
    conversation_id: str,
    limit: int = Query(100, ge=1, le=500),
    before: Optional[int] = Query(None, ge=0),
    before_id: Optional[str] = Query(None, min_length=1, max_length=128),
    db: Session = Depends(core.get_db),
    current_user: models.User = Depends(core.get_current_user)
):
    core.ensure_conversation_member(conversation_id, current_user, db)
    if before_id is not None and before is None:
        raise HTTPException(422, "before_id requires before")
    query = db.query(models.ChatMessage).filter(
        models.ChatMessage.conversation_id == conversation_id,
        models.ChatMessage.is_deleted == False
    )
    if before is not None:
        if before_id is None:
            query = query.filter(models.ChatMessage.created_at < before)
        else:
            # Match the ordering key so equal-timestamp legacy messages remain pageable.
            query = query.filter(or_(
                models.ChatMessage.created_at < before,
                and_(models.ChatMessage.created_at == before, models.ChatMessage.id < before_id),
            ))
    items = query.order_by(desc(models.ChatMessage.created_at),
                           desc(models.ChatMessage.id)).limit(limit).all()
    return list(reversed(items))


@router.post("/chat/conversations/{conversation_id}/messages", response_model=schemas.ChatMessage)
async def send_chat_message(
    conversation_id: str,
    payload: schemas.ChatMessageCreate,
    db: Session = Depends(core.get_db),
    current_user: models.User = Depends(core.get_current_user)
):
    message, delivery = await run_in_threadpool(
        persist_message, db, current_user, conversation_id, payload,
    )
    if delivery is not None:
        participants, event = delivery
        try:
            await core.chat_hub.publish_to_users(participants, event)
        except Exception:
            # Persisted messages remain available via HTTP even if realtime delivery fails.
            logger.exception("Realtime message delivery failed")
    return message


@router.post("/chat/conversations/{conversation_id}/read", response_model=schemas.ConversationMember)
async def mark_conversation_read(
    conversation_id: str,
    payload: schemas.ChatMessageReadRequest,
    db: Session = Depends(core.get_db),
    current_user: models.User = Depends(core.get_current_user)
):
    conversation, member = core.ensure_conversation_member(conversation_id, current_user, db)
    now = int(time.time() * 1000)
    message_id = payload.message_id or conversation.last_message_id
    if message_id and not db.query(models.ChatMessage.id).filter_by(
        id=message_id, conversation_id=conversation_id, is_deleted=False,
    ).first():
        raise HTTPException(404, "Message not found in this conversation")
    member.unread_count = 0
    member.last_read_message_id = message_id
    member.last_read_at = now
    member.updated_at = now
    commit_and_refresh(db, member)
    await core.chat_hub.publish_to_users(
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


@router.websocket("/ws/chat")
async def chat_websocket(websocket: WebSocket, token: str):
    db = core.SessionLocal()
    user = None
    try:
        user = core.get_ws_user(token, db)
        session_id = accounts.resolve_session(db, token)[0].id
        await websocket.accept()
        await core.chat_hub.register(user.id, websocket)
        await websocket.send_json({"type": "connected", "user_id": user.id})
        while True:
            db.rollback()
            db.expire_all()
            live_session = db.get(models.AuthSession, session_id)
            if live_session is None or live_session.revoked_at or live_session.expires_at <= core.current_millis():
                raise HTTPException(401, "Session revoked")
            try:
                raw = await asyncio.wait_for(websocket.receive_text(), timeout=20)
            except asyncio.TimeoutError:
                continue
            try:
                payload = json.loads(raw)
            except json.JSONDecodeError:
                await websocket.send_json({"type": "error", "detail": "Invalid JSON"})
                continue
            if not isinstance(payload, dict):
                await websocket.send_json({"type": "error", "detail": "Expected JSON object"})
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
            await core.chat_hub.unregister(user.id, websocket)
        db.close()

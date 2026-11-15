"""Persist messages once, scoped to sender, conversation, and client request ID."""
import json
import uuid
from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
try:
    from . import core
    from .core import models, schemas
    from .consultation_service import ensure_contact_allowed, capture_inquiry, notice
except ImportError:
    import core
    from core import models, schemas
    from consultation_service import ensure_contact_allowed, capture_inquiry, notice


def validate_retry(message, payload):
    fields = ("type", "content", "attachment_url", "attachment_name", "attachment_size",
              "object_key", "extra")
    if message.is_deleted or any(getattr(message, field) != getattr(payload, field)
                                 for field in fields):
        raise HTTPException(409, "Client message ID already used for a different message")
    return message


def persist_message(db, current_user, conversation_id, payload):
    conversation, _ = core.ensure_conversation_member(conversation_id, current_user, db)
    client_id = payload.client_message_id
    if client_id:
        existing = db.query(models.ChatMessage).filter_by(
            conversation_id=conversation_id, sender_id=current_user.id,
            client_message_id=client_id,
        ).first()
        if existing is not None:
            return validate_retry(existing, payload), None
        key = json.dumps([current_user.id, conversation_id, client_id], separators=(",", ":"))
        message_id = str(uuid.uuid5(uuid.NAMESPACE_URL, key))
    else:
        message_id = str(uuid.uuid4())
    for peer_id in conversation.participant_ids or []:
        if peer_id != current_user.id:
            ensure_contact_allowed(db, current_user.id, peer_id)
    message = models.ChatMessage(
        id=message_id, conversation_id=conversation_id, sender_id=current_user.id,
        **payload.model_dump(), status="sent",
    )
    try:
        db.add(message)
        # The primary key serializes concurrent retries without deleting legacy duplicates.
        db.flush()
        db.refresh(conversation)
        now = max(core.current_millis(), (conversation.last_message_at or 0) + 1)
        message.created_at = now
        message.updated_at = now
        conversation.last_message_id = message.id
        conversation.last_message_preview = core.build_message_preview(
            payload.type, payload.content, payload.attachment_name,
        )
        conversation.last_message_at = now
        conversation.updated_at = now
        db.query(models.ConversationMember).filter(
            models.ConversationMember.conversation_id == conversation_id,
            models.ConversationMember.user_id != current_user.id,
        ).update({
            models.ConversationMember.unread_count: func.coalesce(
                models.ConversationMember.unread_count, 0) + 1,
            models.ConversationMember.updated_at: now,
        }, synchronize_session=False)
        db.query(models.ConversationMember).filter_by(
            conversation_id=conversation_id, user_id=current_user.id,
        ).update({
            "last_read_message_id": message.id, "last_read_at": now, "updated_at": now,
        }, synchronize_session=False)
        participants = list(conversation.participant_ids or [])
        capture_inquiry(db, current_user, conversation, message)
        for peer_id in participants:
            if peer_id != current_user.id:
                notice(db, peer_id, message.id, "message", "收到一条新消息", conversation_id, now)
        db.commit()
        db.refresh(message)
    except IntegrityError:
        db.rollback()
        existing = db.get(models.ChatMessage, message_id) if client_id else None
        if existing is None:
            raise
        return validate_retry(existing, payload), None
    except Exception:
        db.rollback()
        raise
    event = {
        "type": "chat_message", "conversation_id": conversation_id,
        "message": schemas.ChatMessage.model_validate(message).model_dump(mode="json"),
    }
    return message, (participants, event)

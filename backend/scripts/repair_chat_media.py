"""Inspect legacy chat URLs; --apply updates only verified local file references."""
import argparse
import json
import os
from pathlib import Path
from urllib.parse import unquote, urlsplit, urlunsplit, quote
try:
    from .. import models
    from ..database import SessionLocal
except ImportError:
    import sys
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    import models
    from database import SessionLocal


def repair_chat_media(db, static_dir, apply=False):
    root = Path(static_dir).resolve()
    report = {"repairable": [], "missing": [], "applied": 0}
    rows = db.query(models.ChatMessage).filter(
        models.ChatMessage.is_deleted == False,
        models.ChatMessage.attachment_url != "",
    ).yield_per(200)
    for message in rows:
        parsed = urlsplit(message.attachment_url or "")
        if parsed.scheme or parsed.netloc:
            continue
        parts = unquote(parsed.path).lstrip("/").split("/")
        if len(parts) != 3 or parts[:2] != ["static", "chat"]:
            continue
        filename = parts[2]
        sender = message.sender_id
        if not sender or not filename or filename in {".", ".."} or "/" in sender or "\\" in sender \
                or sender in {".", ".."} or "\\" in filename:
            continue
        old_file = (root / "chat" / filename).resolve()
        if old_file.is_relative_to(root) and old_file.is_file():
            continue
        object_key = f"chat/{sender}/{filename}"
        candidate = (root / object_key).resolve()
        if not candidate.is_relative_to(root) or not candidate.is_file():
            report["missing"].append(message.id)
            continue
        corrected = urlunsplit(("", "", "static/" + quote(object_key, safe="/"),
                               parsed.query, parsed.fragment))
        report["repairable"].append({
            "message_id": message.id, "old_url": message.attachment_url, "new_url": corrected,
        })
        if apply:
            message.attachment_url = corrected
            message.object_key = object_key
    if apply:
        try:
            db.commit()
        except Exception:
            db.rollback()
            raise
        report["applied"] = len(report["repairable"])
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Update verified legacy references")
    args = parser.parse_args()
    static_dir = os.getenv("LULU_STATIC_DIR") or str(Path(__file__).resolve().parents[1] / "static")
    with SessionLocal() as db:
        report = repair_chat_media(db, static_dir, apply=args.apply)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

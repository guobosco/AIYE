"""Consistent database errors without disclosing SQL, parameters, or paths."""
import logging
from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

logger = logging.getLogger("aiye.backend")


def commit_and_refresh(db, *objects):
    try:
        db.commit()
        for item in objects:
            db.refresh(item)
    except IntegrityError:
        db.rollback()
        logger.exception("Database write conflict")
        raise HTTPException(409, "Data conflict; reload and try again") from None
    except SQLAlchemyError:
        db.rollback()
        logger.exception("Database write failed")
        raise HTTPException(500, "Unable to save data; try again later") from None


def install_error_handlers(app):
    @app.exception_handler(SQLAlchemyError)
    async def database_error(request: Request, exc: SQLAlchemyError):
        logger.error("Database operation failed on %s", request.url.path,
                     exc_info=(type(exc), exc, exc.__traceback__))
        status = 409 if isinstance(exc, IntegrityError) else 500
        detail = "Data conflict; reload and try again" if status == 409 else "Database operation failed"
        return JSONResponse(status_code=status, content={"detail": detail})

    @app.exception_handler(Exception)
    async def unexpected_error(request: Request, exc: Exception):
        logger.error("Unhandled error on %s", request.url.path,
                     exc_info=(type(exc), exc, exc.__traceback__))
        return JSONResponse(status_code=500, content={"detail": "Internal server error"})

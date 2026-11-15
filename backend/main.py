"""Application assembly; business endpoints live in routes_* modules."""
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
try:
    from . import core, bootstrap, errors
    from . import routes_auth, routes_users, routes_wishlist, routes_feedback
    from . import routes_catalog, routes_admin, routes_chat, routes_media, routes_consultation
except ImportError:
    import core, bootstrap, errors
    import routes_auth, routes_users, routes_wishlist, routes_feedback
    import routes_catalog, routes_admin, routes_chat, routes_media, routes_consultation


@asynccontextmanager
async def lifespan(app: FastAPI):
    bootstrap.initialize_database()
    for directory in core.MEDIA_BIZ_TO_DIR.values():
        os.makedirs(directory, exist_ok=True)
    try:
        await core.chat_hub.startup()
        yield
    finally:
        await core.chat_hub.shutdown()


app = FastAPI(lifespan=lifespan)
errors.install_error_handlers(app)

if os.path.isdir(core.ADMIN_WEB_DIR):
    app.mount("/static/admin", StaticFiles(directory=core.ADMIN_WEB_DIR), name="admin_static")
app.mount("/static", StaticFiles(directory=core.STATIC_DIR, check_dir=False), name="static")

for module in (
    routes_auth, routes_users, routes_wishlist, routes_feedback,
    routes_catalog, routes_admin, routes_chat, routes_media, routes_consultation,
):
    app.include_router(module.router)


@app.get("/")
def read_root():
    return {"message": "Lulu API is running"}


@app.get("/healthz")
def healthz():
    return {"status": "ok", "environment": core.APP_ENV}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        app, host=os.getenv("LULU_HOST", "0.0.0.0"),
        port=int(os.getenv("LULU_PORT", "8000")),
    )

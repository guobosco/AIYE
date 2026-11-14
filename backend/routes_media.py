from fastapi import APIRouter, Depends, Query, File, UploadFile, Form
from typing import Optional
try:
    from . import core
    from .core import models, schemas
except ImportError:
    import core
    from core import models, schemas

router = APIRouter()

@router.post("/upload/avatar")
def upload_avatar(file: UploadFile = File(...), user_id: Optional[str] = Form(None), current_user: models.User = Depends(core.get_current_user)):
    """
    上传头像文件，返回文件的网络访问 URL
    """
    if user_id is not None:
        core.ensure_self_access(current_user, user_id)
    else:
        user_id = current_user.id
    result = core._upload_media(file=file, current_user=current_user, biz="avatar", image_only=True)
    return {"url": result.url}


@router.post("/media/upload", response_model=schemas.MediaUploadResponse)
def upload_media(
    biz: str = Query(..., pattern="^(avatar|service|experience|chat)$"),
    file: UploadFile = File(...),
    current_user: models.User = Depends(core.get_current_user)
):
    return core._upload_media(file=file, current_user=current_user, biz=biz, image_only=(biz == "avatar"))


@router.post("/service/upload", response_model=schemas.ChatUploadResponse)
def upload_service_file(
    file: UploadFile = File(...),
    current_user: models.User = Depends(core.get_current_user)
):
    result = core._upload_media(file=file, current_user=current_user, biz="service")
    return schemas.ChatUploadResponse(
        url=result.url,
        object_key=result.object_key
    )


@router.post("/experience/upload", response_model=schemas.ChatUploadResponse)
def upload_experience_file(
    file: UploadFile = File(...),
    current_user: models.User = Depends(core.get_current_user)
):
    result = core._upload_media(file=file, current_user=current_user, biz="experience")
    return schemas.ChatUploadResponse(
        url=result.url,
        object_key=result.object_key
    )


@router.post("/chat/upload", response_model=schemas.ChatUploadResponse)
def upload_chat_file(
    file: UploadFile = File(...),
    current_user: models.User = Depends(core.get_current_user)
):
    result = core._upload_media(file=file, current_user=current_user, biz="chat")
    return schemas.ChatUploadResponse(
        url=result.url,
        object_key=result.object_key
    )

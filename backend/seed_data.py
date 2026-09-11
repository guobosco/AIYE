import time

import bcrypt
from sqlalchemy.orm import Session

try:
    from . import models
except ImportError:
    import models
try:
    from .experience_rating import compute_classic_five_point_rating
except ImportError:
    from experience_rating import compute_classic_five_point_rating


SEED_LOGIN_PASSWORD = "123456"
MIDDLE_SCHOOL_FAVORITE_SONGS = [
    "稻香",
    "平凡之路",
    "夜曲",
    "晴天",
    "七里香",
    "后来",
    "遇见",
    "小幸运",
    "起风了",
    "海阔天空",
]
DEFAULT_BIRTH_DECADES = ["95后", "90后", "95后", "90后", "00后", "95后"]
DEFAULT_JOB_TITLES = ["城市向导", "旅行顾问", "体验主理人", "旅拍搭子", "生活方式顾问"]
DEFAULT_EDUCATIONS = ["旅游管理", "视觉传达", "市场营销", "酒店管理", "形象设计"]


def _now_ms() -> int:
    return int(time.time() * 1000)


def _static_url(relative_path: str) -> str:
    return f"static/{relative_path.lstrip('/')}"


def _hash_seed_password() -> str:
    return bcrypt.hashpw(SEED_LOGIN_PASSWORD.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def _extract_user_index(raw_value: str, fallback: int = 1) -> int:
    digits = "".join(ch for ch in (raw_value or "") if ch.isdigit())
    if not digits:
        return fallback
    return max(int(digits[-3:]), fallback)


def _normalized_avatar_index(index: int) -> int:
    return ((max(index, 1) - 1) % 20) + 1


def _avatar_url(index: int) -> str:
    return _static_url(f"avatars/avatar_{_normalized_avatar_index(index):02d}.jpg")


def _build_profile_image_urls(primary_photo_url: str, index: int) -> list[str]:
    secondary_index = _normalized_avatar_index(index + 6)
    secondary = _static_url(f"avatars/avatar_{secondary_index:02d}.jpg")
    if primary_photo_url == secondary:
        secondary_index = _normalized_avatar_index(index + 1)
        secondary = _static_url(f"avatars/avatar_{secondary_index:02d}.jpg")
    return [primary_photo_url, secondary]


def _default_phone_number(index: int) -> str:
    return f"1390000{max(index, 1):04d}"


def _default_birth_decade(index: int) -> str:
    return DEFAULT_BIRTH_DECADES[(max(index, 1) - 1) % len(DEFAULT_BIRTH_DECADES)]


def _default_song(index: int) -> str:
    return MIDDLE_SCHOOL_FAVORITE_SONGS[(max(index, 1) - 1) % len(MIDDLE_SCHOOL_FAVORITE_SONGS)]


def _default_job_title(index: int) -> str:
    return DEFAULT_JOB_TITLES[(max(index, 1) - 1) % len(DEFAULT_JOB_TITLES)]


def _default_education(index: int) -> str:
    return DEFAULT_EDUCATIONS[(max(index, 1) - 1) % len(DEFAULT_EDUCATIONS)]


def _default_email(user_id: str) -> str:
    safe_user_id = "".join(ch if ch.isalnum() else "_" for ch in (user_id or "").lower()).strip("_")
    return f"{safe_user_id or 'seed_user'}@lulu.app"


def _non_empty_text(value) -> bool:
    return isinstance(value, str) and value.strip() != ""


def _non_empty_list(value) -> bool:
    return isinstance(value, list) and len(value) > 0


def _fallback_city(item) -> str:
    if _non_empty_text(item.living_city):
        return item.living_city.strip()
    if _non_empty_text(item.region):
        parts = item.region.strip().split()
        if parts:
            return parts[-1]
    return "三亚"


def _fallback_country(item, city: str) -> str:
    if _non_empty_text(item.living_country):
        return item.living_country.strip()
    if city == "三亚":
        return "中国"
    return "法国"


def _fallback_region(item, city: str, country: str) -> str:
    if _non_empty_text(item.region):
        return item.region.strip()
    if country == "中国":
        return f"海南 {city}"
    return city


def _fallback_languages(item, country: str) -> list[str]:
    if _non_empty_list(item.spoken_languages):
        return item.spoken_languages
    if country == "中国":
        return ["普通话", "英语"]
    return ["英语"]


def _fallback_tags(item, city: str, index: int) -> list[str]:
    if _non_empty_list(item.tags):
        return item.tags
    job_or_role = item.job_title.strip() if _non_empty_text(item.job_title) else _default_job_title(index)
    return [job_or_role, city, "好沟通"]


def _fallback_review_summaries(item, city: str) -> list[str]:
    if _non_empty_list(item.review_summaries):
        return item.review_summaries
    name = item.name.strip() if _non_empty_text(item.name) else "这位体验官"
    return [
        f"{name}沟通顺畅，安排很稳，整个体验过程很省心。",
        f"在{city}找{name}很靠谱，细节照顾得很到位。",
    ]


def _pick_default_favorites(rows, owner_id: str, count: int, offset: int) -> list[str]:
    candidates = [row_id for row_id, row_owner_id in rows if row_owner_id != owner_id]
    if not candidates:
        candidates = [row_id for row_id, _ in rows]
    if not candidates:
        return []
    return [candidates[(offset + index) % len(candidates)] for index in range(min(count, len(candidates)))]


def _is_seed_user(item) -> bool:
    user_id = (item.id or "").strip().lower()
    pei_pei_id = (item.pei_pei_id or "").strip().lower()
    email = (item.email or "").strip().lower()
    return (
        user_id.startswith("seed-")
        or pei_pei_id.startswith("seed")
        or pei_pei_id.startswith("pp_seed")
        or email.endswith("@lulu.app")
    )


def _complete_user_record(item, now_ms: int, index_hint: int = 1) -> None:
    user_index = _extract_user_index(item.id, fallback=index_hint)

    if not _non_empty_text(item.name):
        item.name = f"用户{user_index:02d}"
    if not _non_empty_text(item.email):
        item.email = _default_email(item.id)
    if not _non_empty_text(item.phone_number):
        item.phone_number = _default_phone_number(user_index)
    if not item.hashed_password:
        item.hashed_password = _hash_seed_password()
    if not _non_empty_text(item.login_provider):
        item.login_provider = "password"
    if not _non_empty_text(item.wechat_unionid):
        item.wechat_unionid = f"seed_union_{item.id.replace('-', '_')}"
    if not _non_empty_text(item.wechat_openid):
        item.wechat_openid = f"seed_open_{item.id.replace('-', '_')}"
    if not _non_empty_text(item.wechat_platform):
        item.wechat_platform = "ios" if user_index % 2 else "android"
    if not item.phone_bound_at and _non_empty_text(item.phone_number):
        item.phone_bound_at = item.created_at or now_ms
    if not item.last_login_at:
        item.last_login_at = item.updated_at or now_ms

    if not _non_empty_text(item.photo_url):
        item.photo_url = _avatar_url(user_index)
    if not _non_empty_list(item.profile_image_urls):
        item.profile_image_urls = _build_profile_image_urls(item.photo_url, user_index)
    if not _non_empty_text(item.remark_name):
        item.remark_name = item.name

    city = _fallback_city(item)
    country = _fallback_country(item, city)
    region = _fallback_region(item, city, country)

    if not _non_empty_text(item.signature):
        item.signature = f"你好，我是{item.name}，欢迎来{city}。"
    if not _non_empty_text(item.memo):
        item.memo = "偏好提前沟通时间、人数和具体安排。"
    if not _non_empty_text(item.gender):
        item.gender = "女" if user_index % 3 else "男"
    if not _non_empty_text(item.region):
        item.region = region
    if not _non_empty_text(item.job_title):
        item.job_title = _default_job_title(user_index)
    if not _non_empty_text(item.education):
        item.education = _default_education(user_index)
    if not _non_empty_text(item.birth_decade):
        item.birth_decade = _default_birth_decade(user_index)
    if not item.height_cm:
        item.height_cm = 160 + (user_index % 16)
    if not item.weight_kg:
        item.weight_kg = float(48 + (user_index % 18))
    if not _non_empty_text(item.middle_school_favorite_song):
        item.middle_school_favorite_song = _default_song(user_index)
    if not _non_empty_list(item.spoken_languages):
        item.spoken_languages = _fallback_languages(item, country)
    if not _non_empty_text(item.living_city):
        item.living_city = city
    if not _non_empty_text(item.living_country):
        item.living_country = country
    if not _non_empty_list(item.tags):
        item.tags = _fallback_tags(item, city, user_index)
    if item.favorite_service_ids is None:
        item.favorite_service_ids = []
    if item.favorite_experience_ids is None:
        item.favorite_experience_ids = []
    if not item.review_count:
        item.review_count = 32 + user_index * 3
    if not item.average_rating:
        item.average_rating = round(4.72 + (user_index % 8) * 0.03, 2)
    if not item.service_years:
        item.service_years = 2 + (user_index % 6)
    if not _non_empty_list(item.review_summaries):
        item.review_summaries = _fallback_review_summaries(item, city)

    if not _non_empty_text(item.address_detail):
        item.address_detail = f"{region}核心区域，可提前沟通具体见面点。"
    if not _non_empty_text(item.address_recipient_name):
        item.address_recipient_name = item.name
    if not _non_empty_text(item.address_phone_number):
        item.address_phone_number = item.phone_number


USER_SEEDS = [
    {
        "id": "seed-user-01",
        "pei_pei_id": "seed001",
        "name": "阿宁",
        "phone_number": "18800000001",
        "photo_url": _static_url("avatars/avatar_01.jpg"),
        "profile_image_urls": [
            _static_url("avatars/avatar_01.jpg"),
            _static_url("avatars/avatar_07.jpg"),
        ],
        "tags": ["地陪", "会拍照", "会规划路线"],
        "signature": "熟悉三亚湾到海棠湾路线，擅长安排轻松不赶的行程。",
        "gender": "女",
        "region": "海南 三亚",
        "job_title": "地陪主理人",
        "education": "旅游管理",
        "birth_decade": "95后",
        "spoken_languages": ["普通话", "英语"],
        "living_city": "三亚",
        "living_country": "中国",
        "identity_verified": True,
        "is_phone_verified": True,
        "is_profile_completed": True,
    },
    {
        "id": "seed-user-02",
        "pei_pei_id": "seed002",
        "name": "小岛",
        "phone_number": "18800000002",
        "photo_url": _static_url("avatars/avatar_02.jpg"),
        "profile_image_urls": [
            _static_url("avatars/avatar_02.jpg"),
            _static_url("avatars/avatar_08.jpg"),
        ],
        "tags": ["摄影", "情侣拍摄", "夜景擅长"],
        "signature": "擅长海边氛围感和纪实跟拍，返图节奏稳定。",
        "gender": "男",
        "region": "海南 三亚",
        "job_title": "旅拍摄影师",
        "education": "视觉传达",
        "birth_decade": "90后",
        "spoken_languages": ["普通话"],
        "living_city": "三亚",
        "living_country": "中国",
        "identity_verified": True,
        "is_phone_verified": True,
        "is_profile_completed": True,
    },
    {
        "id": "seed-user-03",
        "pei_pei_id": "seed003",
        "name": "Mika",
        "phone_number": "18800000003",
        "photo_url": _static_url("avatars/avatar_03.jpg"),
        "profile_image_urls": [
            _static_url("avatars/avatar_03.jpg"),
            _static_url("avatars/avatar_09.jpg"),
        ],
        "tags": ["DJ", "暖场互动", "婚礼经验"],
        "signature": "婚礼、生日派对和小型 club 包场都接，曲风可定制。",
        "gender": "女",
        "region": "海南 三亚",
        "job_title": "DJ / 气氛组",
        "education": "音乐制作",
        "birth_decade": "95后",
        "spoken_languages": ["普通话", "英语"],
        "living_city": "三亚",
        "living_country": "中国",
        "identity_verified": True,
        "is_phone_verified": True,
        "is_profile_completed": True,
    },
    {
        "id": "seed-user-04",
        "pei_pei_id": "seed004",
        "name": "Tina",
        "phone_number": "18800000004",
        "photo_url": _static_url("avatars/avatar_04.jpg"),
        "profile_image_urls": [
            _static_url("avatars/avatar_04.jpg"),
            _static_url("avatars/avatar_10.jpg"),
        ],
        "tags": ["私教", "体态改善", "新手友好"],
        "signature": "擅长海边晨练、减脂塑形和一对一陪练。",
        "gender": "女",
        "region": "海南 三亚",
        "job_title": "运动教练",
        "education": "运动康复",
        "birth_decade": "90后",
        "spoken_languages": ["普通话"],
        "living_city": "三亚",
        "living_country": "中国",
        "identity_verified": True,
        "is_phone_verified": True,
        "is_profile_completed": True,
    },
    {
        "id": "seed-user-05",
        "pei_pei_id": "seed005",
        "name": "Kiki",
        "phone_number": "18800000005",
        "photo_url": _static_url("avatars/avatar_05.jpg"),
        "profile_image_urls": [
            _static_url("avatars/avatar_05.jpg"),
            _static_url("avatars/avatar_11.jpg"),
        ],
        "tags": ["私厨", "上门制作", "可定制菜单"],
        "signature": "擅长 2-6 人家宴和海鲜轻食，沟通忌口会很细。",
        "gender": "女",
        "region": "海南 三亚",
        "job_title": "私厨",
        "education": "酒店管理",
        "birth_decade": "90后",
        "spoken_languages": ["普通话"],
        "living_city": "三亚",
        "living_country": "中国",
        "identity_verified": True,
        "is_phone_verified": True,
        "is_profile_completed": True,
    },
    {
        "id": "seed-user-06",
        "pei_pei_id": "seed006",
        "name": "Luna",
        "phone_number": "18800000006",
        "photo_url": _static_url("avatars/avatar_06.jpg"),
        "profile_image_urls": [
            _static_url("avatars/avatar_06.jpg"),
            _static_url("avatars/avatar_12.jpg"),
        ],
        "tags": ["化妆", "技能教学", "可上门"],
        "signature": "可做妆造，也能带零基础学简单日常妆和拍照动作。",
        "gender": "女",
        "region": "海南 三亚",
        "job_title": "妆造 / 技能教学",
        "education": "形象设计",
        "birth_decade": "00后",
        "spoken_languages": ["普通话"],
        "living_city": "三亚",
        "living_country": "中国",
        "identity_verified": True,
        "is_phone_verified": True,
        "is_profile_completed": True,
    },
]


SERVICE_SEEDS = [
    {
        "id": "seed-service-guide-01",
        "creator_id": "seed-user-01",
        "creator": "阿宁",
        "title": "亚龙湾轻松地陪半日线",
        "description": "适合第一次来三亚的用户，含路线建议、拍照点位和用餐安排，节奏不赶。",
        "cover_image_url": _static_url("services/seed-user-01/sanya_service_001.jpg"),
        "image_urls": [
            _static_url("services/seed-user-01/sanya_service_001.jpg"),
            _static_url("services/seed-user-01/sanya_service_002.jpg"),
            _static_url("services/seed-user-01/sanya_service_003.jpg"),
        ],
        "location": "三亚",
        "price_text": "398元",
        "price_basis_text": "任意4小时",
        "prepayment_percent": 30,
        "full_refund_cancel_lead_days": 1,
        "category": "地陪",
        "service_mode": "小时",
        "booking_time_ranges_json": '[{"start":"09:00","end":"22:00"}]',
        "booking_lead_hours": 6.0,
        "booking_future_open_days": 30,
        "auto_accept_after_payment": True,
        "sync_to_square": True,
        "service_declarations_extra": ["景区门票需自理", "默认 2 人内，更多人数请先沟通"],
        "service_feature_tags": ["熟悉路线", "会安排行程", "会拍照"],
        "service_extra_fee_tags": ["门票", "打车费"],
        "participant_ids": ["seed-user-01"],
        "is_important": True,
        "is_draft": False,
        "is_deleted": False,
    },
    {
        "id": "seed-service-photo-01",
        "creator_id": "seed-user-02",
        "creator": "小岛",
        "title": "椰梦长廊情侣旅拍",
        "description": "主打日落氛围感和轻纪实，底片全送，精修 9 张，适合情侣和闺蜜。",
        "cover_image_url": _static_url("services/seed-user-01/sanya_service_101.jpg"),
        "image_urls": [
            _static_url("services/seed-user-01/sanya_service_101.jpg"),
            _static_url("services/seed-user-01/sanya_service_102.jpg"),
            _static_url("services/seed-user-01/sanya_service_103.jpg"),
        ],
        "location": "三亚",
        "price_text": "699元",
        "price_basis_text": "每次（不超过2小时）",
        "prepayment_percent": 50,
        "full_refund_cancel_lead_days": 2,
        "category": "摄影",
        "service_mode": "次",
        "booking_time_ranges_json": '[{"start":"15:00","end":"20:00"}]',
        "booking_lead_hours": 12.0,
        "booking_future_open_days": 45,
        "auto_accept_after_payment": False,
        "sync_to_square": True,
        "service_declarations_extra": ["精修风格可提前沟通", "如需加急返图请单独确认"],
        "service_feature_tags": ["审美在线", "底片全送", "夜景擅长"],
        "service_extra_fee_tags": ["场地费", "加急修图费"],
        "participant_ids": ["seed-user-02"],
        "is_important": True,
        "is_draft": False,
        "is_deleted": False,
    },
    {
        "id": "seed-service-dj-01",
        "creator_id": "seed-user-03",
        "creator": "Mika",
        "title": "生日派对 DJ 气氛组",
        "description": "含暖场互动与歌单定制，小型派对、生日局、包场预热都可接。",
        "cover_image_url": _static_url("services/seed-user-01/sanya_service_201.jpg"),
        "image_urls": [
            _static_url("services/seed-user-01/sanya_service_201.jpg"),
            _static_url("services/seed-user-01/sanya_service_202.jpg"),
        ],
        "location": "三亚",
        "price_text": "1280元",
        "price_basis_text": "每晚（晚上10点前）",
        "prepayment_percent": 40,
        "full_refund_cancel_lead_days": 3,
        "category": "DJ气氛组",
        "service_mode": "晚",
        "booking_time_ranges_json": '[{"start":"18:00","end":"23:00"}]',
        "booking_lead_hours": 24.0,
        "booking_future_open_days": 60,
        "auto_accept_after_payment": False,
        "sync_to_square": True,
        "service_declarations_extra": ["设备进场时间需提前确认"],
        "service_feature_tags": ["氛围带动", "曲风可定制", "派对经验"],
        "service_extra_fee_tags": ["设备运输费", "超时费"],
        "participant_ids": ["seed-user-03"],
        "is_important": False,
        "is_draft": False,
        "is_deleted": False,
    },
    {
        "id": "seed-service-fitness-01",
        "creator_id": "seed-user-04",
        "creator": "Tina",
        "title": "海边晨练减脂私教",
        "description": "一对一晨练课程，适合零基础，含动作纠正和简单饮食建议。",
        "cover_image_url": _static_url("services/sanya_coach.jpg"),
        "image_urls": [
            _static_url("services/sanya_coach.jpg"),
            _static_url("services/seed-user-02/sanya_service_006.jpg"),
        ],
        "location": "三亚",
        "price_text": "299元",
        "price_basis_text": "每小时",
        "prepayment_percent": 30,
        "full_refund_cancel_lead_days": 1,
        "category": "运动教练",
        "service_mode": "小时",
        "booking_time_ranges_json": '[{"start":"06:30","end":"10:30"}]',
        "booking_lead_hours": 8.0,
        "booking_future_open_days": 30,
        "auto_accept_after_payment": True,
        "sync_to_square": True,
        "service_declarations_extra": ["训练强度会根据体能调整"],
        "service_feature_tags": ["纠正动作", "减脂塑形", "新手友好"],
        "service_extra_fee_tags": ["场地费", "超时费"],
        "participant_ids": ["seed-user-04"],
        "is_important": False,
        "is_draft": False,
        "is_deleted": False,
    },
    {
        "id": "seed-service-chef-01",
        "creator_id": "seed-user-05",
        "creator": "Kiki",
        "title": "4人份海鲜家宴私厨",
        "description": "上门采购和制作，适合家庭聚餐或朋友小聚，可按忌口调整菜单。",
        "cover_image_url": _static_url("services/sanya_chef.jpg"),
        "image_urls": [
            _static_url("services/sanya_chef.jpg"),
            _static_url("services/seed-user-02/sanya_service_107.jpg"),
        ],
        "location": "三亚",
        "price_text": "880元",
        "price_basis_text": "每次",
        "prepayment_percent": 35,
        "full_refund_cancel_lead_days": 2,
        "category": "私厨",
        "service_mode": "次",
        "booking_time_ranges_json": '[{"start":"10:00","end":"20:00"}]',
        "booking_lead_hours": 24.0,
        "booking_future_open_days": 30,
        "auto_accept_after_payment": False,
        "sync_to_square": True,
        "service_declarations_extra": ["默认不含食材费", "需可正常使用厨房"],
        "service_feature_tags": ["会买菜", "可定制菜单", "上门制作"],
        "service_extra_fee_tags": ["食材费", "交通费"],
        "participant_ids": ["seed-user-05"],
        "is_important": False,
        "is_draft": False,
        "is_deleted": False,
    },
    {
        "id": "seed-service-makeup-01",
        "creator_id": "seed-user-06",
        "creator": "Luna",
        "title": "海岛度假轻透妆造",
        "description": "适合旅拍、约会和晚餐局，支持上门，妆面偏自然干净。",
        "cover_image_url": _static_url("services/sanya_makeup.jpg"),
        "image_urls": [
            _static_url("services/sanya_makeup.jpg"),
            _static_url("services/seed-user-02/sanya_service_108.jpg"),
        ],
        "location": "三亚",
        "price_text": "368元",
        "price_basis_text": "每次",
        "prepayment_percent": 30,
        "full_refund_cancel_lead_days": 1,
        "category": "化妆",
        "service_mode": "次",
        "booking_time_ranges_json": '[{"start":"08:00","end":"21:00"}]',
        "booking_lead_hours": 4.0,
        "booking_future_open_days": 21,
        "auto_accept_after_payment": True,
        "sync_to_square": True,
        "service_declarations_extra": ["如需试妆请提前说明"],
        "service_feature_tags": ["自然妆感", "可上门", "证件照妆"],
        "service_extra_fee_tags": ["上门费", "早妆费"],
        "participant_ids": ["seed-user-06"],
        "is_important": False,
        "is_draft": False,
        "is_deleted": False,
    },
    {
        "id": "seed-service-teaching-01",
        "creator_id": "seed-user-06",
        "creator": "Luna",
        "title": "拍照动作和表情管理陪练",
        "description": "适合不会面对镜头的人，含动作示范、表情引导和现场复盘。",
        "cover_image_url": _static_url("services/sanya_photo.jpg"),
        "image_urls": [
            _static_url("services/sanya_photo.jpg"),
            _static_url("services/seed-user-02/sanya_service_109.jpg"),
        ],
        "location": "三亚",
        "price_text": "220元",
        "price_basis_text": "每小时",
        "prepayment_percent": 20,
        "full_refund_cancel_lead_days": 1,
        "category": "技能教学",
        "service_mode": "小时",
        "booking_time_ranges_json": '[{"start":"10:00","end":"18:00"}]',
        "booking_lead_hours": 2.0,
        "booking_future_open_days": 14,
        "auto_accept_after_payment": True,
        "sync_to_square": True,
        "service_declarations_extra": ["建议自带想模仿的参考照片"],
        "service_feature_tags": ["零基础友好", "一对一", "可陪练"],
        "service_extra_fee_tags": ["场地费"],
        "participant_ids": ["seed-user-06"],
        "is_important": False,
        "is_draft": False,
        "is_deleted": False,
    },
    {
        "id": "seed-service-other-01",
        "creator_id": "seed-user-01",
        "creator": "阿宁",
        "title": "海边求婚流程协助",
        "description": "帮忙踩点、卡时间、安排动线和拍照位，适合简单仪式和惊喜策划。",
        "cover_image_url": _static_url("services/sanya_misc.jpg"),
        "image_urls": [
            _static_url("services/sanya_misc.jpg"),
            _static_url("services/seed-user-01/sanya_service_304.jpg"),
        ],
        "location": "三亚",
        "price_text": "520元",
        "price_basis_text": "每次（不超过3小时）",
        "prepayment_percent": 30,
        "full_refund_cancel_lead_days": 2,
        "category": "其他服务",
        "service_mode": "次",
        "booking_time_ranges_json": '[{"start":"09:00","end":"22:00"}]',
        "booking_lead_hours": 12.0,
        "booking_future_open_days": 45,
        "auto_accept_after_payment": False,
        "sync_to_square": True,
        "service_declarations_extra": ["现场布置费用按实际另计"],
        "service_feature_tags": ["沟通顺畅", "可定制", "长期可约"],
        "service_extra_fee_tags": ["材料费", "交通费"],
        "participant_ids": ["seed-user-01", "seed-user-02"],
        "is_important": False,
        "is_draft": False,
        "is_deleted": False,
    },
    {
        "id": "seed-service-draft-01",
        "creator_id": "seed-user-01",
        "creator": "阿宁",
        "title": "蜈支洲一日轻安排草稿",
        "description": "草稿示例：还在补充集合方式、可约人数和交通建议。",
        "cover_image_url": _static_url("services/seed-user-01/sanya_service_401.jpg"),
        "image_urls": [
            _static_url("services/seed-user-01/sanya_service_401.jpg"),
            _static_url("services/seed-user-01/sanya_service_402.jpg"),
        ],
        "location": "三亚",
        "price_text": "待定",
        "price_basis_text": "",
        "prepayment_percent": 30,
        "full_refund_cancel_lead_days": 1,
        "category": "地陪",
        "service_mode": "天",
        "booking_time_ranges_json": "[]",
        "booking_lead_hours": 0.0,
        "booking_future_open_days": 30,
        "auto_accept_after_payment": False,
        "sync_to_square": False,
        "service_declarations_extra": ["草稿暂未公开"],
        "service_feature_tags": ["会安排行程"],
        "service_extra_fee_tags": [],
        "participant_ids": ["seed-user-01"],
        "is_important": False,
        "is_draft": True,
        "is_deleted": False,
    },
    {
        "id": "seed-service-offline-01",
        "creator_id": "seed-user-02",
        "creator": "小岛",
        "title": "已下架示例：清晨跟拍档期结束",
        "description": "用于测试下架记录持久化，不应出现在发现流。",
        "cover_image_url": _static_url("services/seed-user-01/sanya_service_403.jpg"),
        "image_urls": [
            _static_url("services/seed-user-01/sanya_service_403.jpg"),
        ],
        "location": "三亚",
        "price_text": "499元",
        "price_basis_text": "每次",
        "prepayment_percent": 30,
        "full_refund_cancel_lead_days": 1,
        "category": "摄影",
        "service_mode": "次",
        "booking_time_ranges_json": "[]",
        "booking_lead_hours": 0.0,
        "booking_future_open_days": 30,
        "auto_accept_after_payment": True,
        "sync_to_square": False,
        "service_declarations_extra": [],
        "service_feature_tags": ["当日返图"],
        "service_extra_fee_tags": [],
        "participant_ids": ["seed-user-02"],
        "is_important": False,
        "is_draft": False,
        "is_deleted": True,
    },
]


EXPERIENCE_SEEDS = []


def _upsert_record(db: Session, model_class, record_id: str, payload: dict):
    normalized_payload = {key: value for key, value in payload.items() if key != "id"}
    item = db.query(model_class).filter(model_class.id == record_id).first()
    if item is None:
        item = model_class(id=record_id, **normalized_payload)
        db.add(item)
        return item
    for key, value in normalized_payload.items():
        setattr(item, key, value)
    return item


def _seed_users(db: Session, now_ms: int) -> None:
    for index, payload in enumerate(USER_SEEDS):
        created_at = now_ms - (30 + index) * 86_400_000
        item = _upsert_record(
            db,
            models.User,
            payload["id"],
            {
                **payload,
                "favorite_service_ids": [],
                "favorite_experience_ids": [],
                "review_count": 32 + (index + 1) * 3,
                "average_rating": round(4.72 + ((index + 1) % 8) * 0.03, 2),
                "service_years": 2 + ((index + 1) % 6),
                "review_summaries": [
                    f"{payload['name']}沟通顺畅，安排很稳，整个体验过程很省心。",
                    f"在{payload.get('living_city', '三亚')}找{payload['name']}很靠谱，细节照顾得很到位。",
                ],
                "memo": "偏好提前沟通时间、人数和具体安排。",
                "remark_name": payload["name"],
                "height_cm": 160 + ((index + 1) % 16),
                "weight_kg": float(48 + ((index + 1) % 18)),
                "height_weight_private": False,
                "middle_school_favorite_song": _default_song(index + 1),
                "address_detail": f"{payload.get('region', '海南 三亚')}核心区域，可提前沟通具体见面点。",
                "address_recipient_name": payload["name"],
                "address_phone_number": payload["phone_number"],
                "id_modification_count": 0,
                "last_id_modification_year": 0,
                "created_at": created_at,
                "updated_at": now_ms - index * 60_000,
                "is_synced": True,
            },
        )
        _complete_user_record(item, now_ms=now_ms, index_hint=index + 1)


def _complete_existing_users(db: Session, now_ms: int) -> None:
    service_rows = (
        db.query(models.Service.id, models.Service.creator_id)
        .filter(models.Service.is_deleted == False)
        .order_by(models.Service.id.asc())
        .all()
    )
    experience_rows = (
        db.query(models.Experience.id, models.Experience.host_id)
        .filter(models.Experience.is_deleted == False)
        .order_by(models.Experience.id.asc())
        .all()
    )
    users = db.query(models.User).order_by(models.User.id.asc()).all()
    for index, item in enumerate(users, start=1):
        if not _is_seed_user(item):
            continue
        _complete_user_record(item, now_ms=now_ms, index_hint=index)
        if not _non_empty_list(item.favorite_service_ids):
            item.favorite_service_ids = _pick_default_favorites(service_rows, item.id, count=3, offset=index - 1)
        if not _non_empty_list(item.favorite_experience_ids):
            item.favorite_experience_ids = _pick_default_favorites(experience_rows, item.id, count=2, offset=index)


def _seed_services(db: Session, now_ms: int) -> None:
    for index, payload in enumerate(SERVICE_SEEDS):
        created_at = now_ms - (10 + index) * 3_600_000
        _upsert_record(
            db,
            models.Service,
            payload["id"],
            {
                **payload,
                "created_at": created_at,
                "updated_at": created_at + 1_800_000,
                "is_synced": True,
            },
        )


def _seed_experiences(db: Session, now_ms: int) -> None:
    for index, payload in enumerate(EXPERIENCE_SEEDS):
        created_at = now_ms - (20 + index) * 7_200_000
        _upsert_record(
            db,
            models.Experience,
            payload["id"],
            {
                **payload,
                "created_at": created_at,
                "updated_at": created_at + 1_200_000,
                "is_deleted": False,
                "is_synced": True,
            },
        )


def _backfill_experience_ratings(db: Session) -> None:
    host_rows = (
        db.query(models.User.id, models.User.average_rating, models.User.review_count)
        .filter(models.User.id.in_(db.query(models.Experience.host_id).distinct()))
        .all()
    )
    host_rating_map = {
        host_id: compute_classic_five_point_rating(average_rating, review_count)
        for host_id, average_rating, review_count in host_rows
    }

    experiences = db.query(models.Experience).all()
    for item in experiences:
        item.average_rating = host_rating_map.get(item.host_id, 0.0)


def _seed_wishlist_profile(db: Session, now_ms: int) -> None:
    favorite_ids = [
        "seed-service-guide-01",
        "seed-service-photo-01",
        "seed-service-dj-01",
    ]
    user = db.query(models.User).filter(models.User.id == "seed-user-01").first()
    if user is None:
        return
    user.favorite_service_ids = favorite_ids
    user.updated_at = now_ms

    db.query(models.WishlistGroupItem).filter(
        models.WishlistGroupItem.user_id == user.id
    ).delete(synchronize_session=False)
    db.query(models.WishlistGroup).filter(
        models.WishlistGroup.user_id == user.id
    ).delete(synchronize_session=False)

    groups = [
        ("默认分组", ["seed-service-guide-01"]),
        ("旅拍收藏", ["seed-service-photo-01"]),
        ("派对备选", ["seed-service-dj-01"]),
    ]
    for index, (name, service_ids) in enumerate(groups):
        group_id = f"seed-wishlist-group-{index + 1:02d}"
        db.add(
            models.WishlistGroup(
                id=group_id,
                user_id=user.id,
                name=name,
                sort_order=index,
                created_at=now_ms,
                updated_at=now_ms,
            )
        )
        for item_index, service_id in enumerate(service_ids):
            db.add(
                models.WishlistGroupItem(
                    id=f"seed-wishlist-item-{index + 1:02d}-{item_index + 1:02d}",
                    user_id=user.id,
                    group_id=group_id,
                    service_id=service_id,
                    created_at=now_ms,
                    updated_at=now_ms,
                )
            )


def ensure_seed_data(db: Session) -> None:
    now_ms = _now_ms()
    _seed_users(db, now_ms)
    _seed_services(db, now_ms)
    _seed_experiences(db, now_ms)
    _backfill_experience_ratings(db)
    _complete_existing_users(db, now_ms)
    _seed_wishlist_profile(db, now_ms)
    db.commit()

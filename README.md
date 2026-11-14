# AIYE 爱野

AIYE 是一个围绕体验、服务发现和用户交流的多端项目，包含 Python 后端、独立管理网站、Android 原生客户端、iOS 原生客户端和保留的小程序源码。

当前功能更新主要面向 Android 和 iOS，小程序暂不跟随更新。首页默认展示“体验”，顶部顺序为“体验”在前、“服务”在后。

本 README 说明当前源码结构、实际配置和本地运行方式，不代表全部功能已经完成生产环境验证。

## 目录导航

- [项目结构](#项目结构)
- [技术栈与环境](#技术栈与环境)
- [快速启动后端](#快速启动后端)
- [后端配置](#后端配置)
- [管理网站](#管理网站)
- [Android 开发](#android-开发)
- [iOS 开发](#ios-开发)
- [多端接口地址](#多端接口地址)
- [微信小程序](#微信小程序)
- [接口与业务规则](#接口与业务规则)
- [数据库与媒体文件](#数据库与媒体文件)
- [部署注意事项](#部署注意事项)
- [常见问题](#常见问题)
- [源码管理与清理](#源码管理与清理)

## 项目结构

```text
AIYE/
├── README.md
├── .gitignore
├── backend/                         # 后端代码及业务媒体资源
│   ├── main.py                      # FastAPI 入口、业务路由和管理 API
│   ├── database.py                  # 数据库连接、Session、SQLite WAL 配置
│   ├── models.py                    # SQLAlchemy 数据模型
│   ├── schemas.py                   # 请求与响应模型
│   ├── schema_sync.py               # SQLite 表结构同步
│   ├── seed_data.py                 # 开发种子数据与数据补全
│   ├── experience_rating.py         # 体验评分计算
│   ├── chat_realtime.py             # WebSocket 连接与可选 Redis 广播
│   ├── requirements.txt             # Python 依赖
│   ├── run_dev.sh                   # 开发服务器启动脚本
│   ├── scripts/                     # 数据与媒体维护工具
│   └── static/                      # 头像、服务、体验、聊天媒体；不是前端源码
├── admin_web/                       # 独立管理网站前端
│   ├── index.html                   # 管理页面
│   ├── admin.css                    # 页面样式
│   ├── admin.js                     # 页面交互与管理 API 请求
│   └── README.md                    # 管理网站运行和部署说明
├── android_aiye/                    # Android 原生工程
│   ├── app/src/main/
│   │   ├── java/com/example/PeiPei/  # 应用、网络、数据、页面和公共组件
│   │   ├── assets/                  # 必需的本地数据资源
│   │   └── res/                     # Android 界面、图标、主题等资源
│   ├── app/build.gradle.kts
│   ├── gradle.properties
│   ├── settings.gradle.kts
│   └── gradlew                      # Gradle Wrapper
├── ios_aiye/
│   └── aiye/
│       ├── Config/                  # 尚未绑定到工程的 xcconfig 配置文件
│       ├── Resources/               # 配置模板
│       └── aiye/
│           ├── aiye.xcodeproj       # 实际 Xcode 工程
│           └── aiye/                # App、Core、Domain、Features 和界面资源
└── wechat_aiye/                     # 保留的 Taro 小程序源码
    ├── config/
    ├── src/
    ├── package.json
    └── project.config.json
```

`backend/` 内不再包含管理网站的 HTML、CSS 或 JavaScript。管理 API 仍属于后端；业务图片属于服务运行数据，不属于管理网站前端。

## 技术栈与环境

| 模块 | 主要技术 | 环境说明 |
| --- | --- | --- |
| 后端 | FastAPI、SQLAlchemy、Pydantic、JWT、bcrypt、WebSocket | 建议使用 Python 3.11 或更高版本及独立虚拟环境 |
| 数据库 | 默认 SQLite，可配置 SQLAlchemy 数据库 URL | 本地开发无需安装独立数据库服务；PostgreSQL 迁移需另行验证 |
| 管理网站 | 原生 HTML、JavaScript、CSS | 无需 npm 安装或前端构建 |
| Android | Kotlin、Jetpack Compose、Room、Retrofit、OkHttp、Coil、高德 SDK | Android Studio、JDK 21、Android SDK 34 |
| iOS | SwiftUI、CoreData、Keychain | macOS、Xcode 及满足工程 Deployment Target 的 SDK |
| 小程序 | Taro 4.1.9、React 18、TypeScript | 建议 Node.js 22 LTS、npm、微信开发者工具 |

Android 当前配置为 Gradle 8.13、Android Gradle Plugin 8.13.2、Kotlin 1.9.20，Java/Kotlin 编译目标为 21；`minSdk` 为 21，`compileSdk` 和 `targetSdk` 为 34。使用仓库的 Wrapper，不必另行安装全局 Gradle。

iOS 工程当前写入的 `IPHONEOS_DEPLOYMENT_TARGET` 为 **26.4**。先确认本机 Xcode 是否提供相应 SDK；如需支持更低系统版本，应结合代码兼容性调整工程，而不是只修改文档。

## 快速启动后端

以下命令适用于 macOS/Linux，并以项目根目录为起点：

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
```

建议在启动前设置开发用管理员密码和 JWT 密钥。下面的密码是占位值，需要替换：

```bash
export LULU_ADMIN_USERNAME=admin
export LULU_ADMIN_PASSWORD='replace-with-a-strong-password'
export LULU_SECRET_KEY="$(openssl rand -hex 32)"
./run_dev.sh
```

同一部署环境应稳定保存 JWT 密钥，避免每次重启生成新密钥而使现有登录失效。

`run_dev.sh` 默认监听 `0.0.0.0:8000`，启用自动重载，并优先使用 `backend/.venv/bin/python`。脚本必须在 `backend/` 目录下运行。

```bash
# 修改开发服务器端口
./run_dev.sh 8001

# 等价的手动启动方式，需要已激活虚拟环境
python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload

# 不启用自动重载的启动方式
python main.py
```

Windows 可使用 `.venv\Scripts\Activate.ps1` 激活环境，并用 `python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload` 启动，不使用 Bash 脚本。

启动后检查：

```bash
curl http://127.0.0.1:8000/healthz
```

开发环境预期响应：

```json
{"status":"ok","environment":"development"}
```

| 地址 | 用途 |
| --- | --- |
| `http://127.0.0.1:8000/healthz` | 进程健康检查，不等同于完整业务检查 |
| `http://127.0.0.1:8000/docs` | FastAPI Swagger 接口文档 |
| `http://127.0.0.1:8000/redoc` | ReDoc 接口文档 |
| `http://127.0.0.1:8000/admin/` | 管理网站，需部署同级 `admin_web/` |

启动会自动建表、同步 SQLite 表结构并执行种子数据初始化。不是只创建空数据库：种子记录可能在后续启动时再次被补全或更新。连接已有数据库前，务必先备份。

## 后端配置

后端通过环境变量读取配置。代码不会自动加载 `.env` 文件；使用 `.env` 时，需要由终端、服务管理器或 Uvicorn 的相应配置负责加载。

### 基础与认证配置

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `LULU_ENV` | `development` | 环境名称；生产环境设置为 `production` |
| `LULU_HOST` | `0.0.0.0` | `run_dev.sh` 和 `python main.py` 的监听地址 |
| `LULU_PORT` | `8000` | 默认监听端口；脚本位置参数优先于该变量 |
| `LULU_SECRET_KEY` | `dev-secret` | 用户与管理员 JWT 签名密钥；生产环境必须替换 |
| `LULU_ACCESS_TOKEN_EXPIRE_MINUTES` | 未设置时为 `0` | 用户 token 有效期；`0` 表示不设置过期时间，不能为负数 |
| `LULU_ADMIN_USERNAME` | `admin` | 管理员账号 |
| `LULU_ADMIN_PASSWORD` | 空 | 设置后启用管理员账号密码登录 |
| `LULU_ADMIN_TOKEN` | 空 | 可选的固定管理访问口令，与账号密码登录兼容 |
| `LULU_ADMIN_DISPLAY_NAME` | `平台管理员` | 管理员显示名称 |
| `LULU_ADMIN_SESSION_EXPIRE_HOURS` | `72` | 管理员登录会话有效期，最少 1 小时 |

**重要：当管理员密码和固定口令都未设置时，管理 API 允许直接访问。不要将这种配置暴露到公网。** 设置 `LULU_ENV=production` 并不会自动补上管理员鉴权配置。

### 数据、媒体与集成配置

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `LULU_DB_PATH` | `backend/aiye.db` 的绝对路径 | SQLite 数据库文件位置，推荐指定绝对路径 |
| `LULU_DATABASE_URL` | 由 `LULU_DB_PATH` 生成 SQLite URL | 设置后优先于 `LULU_DB_PATH`；可使用 `postgresql+psycopg://...` |
| `LULU_ADMIN_WEB_DIR` | 后端同级 `admin_web/` | 管理网站目录，建议使用绝对路径 |
| `LULU_MAX_UPLOAD_SIZE_MB` | `10` | 单次媒体上传大小限制 |
| `LULU_REDIS_URL` | 空 | 聊天跨进程广播，例如 `redis://127.0.0.1:6379/0` |
| `LULU_WECHAT_APP_ID` | 空 | 后端微信登录使用的 App ID |
| `LULU_WECHAT_APP_SECRET` | 空 | 后端微信 App Secret，不得写入客户端或前端 |
| `LULU_PHONE_CODE_TTL_SECONDS` | `300` | 手机验证码有效期 |

把数据库放到源码目录外的示例：

```bash
# 父目录需要提前创建
mkdir -p "$HOME/.local/share/aiye"
export LULU_DB_PATH="$HOME/.local/share/aiye/aiye.db"
./run_dev.sh
```

未配置 Redis 或 Redis 连接失败时，聊天广播退回当前进程内分发。多个后端进程之间需要可用的 Redis 才能转发聊天事件。

当前验证码只保存在进程内存中，发送接口没有接入真实短信服务。非生产环境会返回 `debug_code`，生产环境不返回；不能因此认为生产短信流程已经可用。

## 管理网站

### 前后端职责

| 部分 | 位置 | 职责 |
| --- | --- | --- |
| 管理前端 | `admin_web/` | 页面展示、筛选、分页、登录交互、编辑表单 |
| 管理 API | `backend/main.py` 中的 `/admin/api/*` | 鉴权、查询、审核、更新和操作日志 |
| 业务媒体 | `backend/static/` | 用户头像、服务和体验图片、聊天媒体 |

网站包含概览、审核中心、用户、服务、体验、意见反馈和操作日志。前端源码无需编译。

### 与后端一起运行

保留 `backend/` 和 `admin_web/` 平级结构，启动后端即可访问 `/admin/`：

```text
AIYE/
├── backend/
└── admin_web/
```

样式和脚本继续使用 `/static/admin/admin.css`、`/static/admin/admin.js`。这些 URL 由后端映射到外部 `admin_web/`，不代表文件仍在 `backend/static/admin/`。

若网站放在其他目录，在启动后端前设置：

```bash
export LULU_ADMIN_WEB_DIR=/srv/aiye/admin_web
```

没有部署管理前端时，后端仍可启动，`/admin/` 返回 404，业务和管理 API 不受影响。部署前端或修改目录配置后应重启后端，使静态目录映射生效。

### 独立静态部署

可由 Nginx 单独托管管理前端。前端使用同源路径请求 API，所以必须将 `/admin/api/*` 反向代理到后端，并将业务图片的 `/static/*` 转发到后端。

以下是路径配置示例，假设前端目录为 `/srv/aiye/admin_web/`、后端监听 `127.0.0.1:8000`。需要替换域名和目录；它不包含公网部署所需的 HTTPS 证书和访问限制：

```nginx
server {
    listen 80;
    server_name admin.example.com;
    client_max_body_size 10m;

    location = /admin {
        return 302 /admin/;
    }

    location ^~ /admin/api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /admin/ {
        alias /srv/aiye/admin_web/;
        index index.html;
    }

    location ^~ /static/admin/ {
        alias /srv/aiye/admin_web/;
    }

    location /static/ {
        proxy_pass http://127.0.0.1:8000;
    }
}
```

如果前端与后端在不同机器上，修改 `proxy_pass` 为内网后端地址。这段配置只覆盖管理网站，不是完整的移动端 API 和 WebSocket 代理配置。

不要仅使用另一个端口的静态服务器打开网站：如果没有反向代理，管理 API 请求会发给静态服务器，导致登录和数据加载失败。详细目录说明见 [admin_web/README.md](admin_web/README.md)。

## Android 开发

1. 使用 Android Studio 打开 `android_aiye/`。
2. 安装 Android SDK 34，并将 Gradle JDK 设置为 JDK 21。
3. 由 Android Studio 生成本机 `local.properties`，不要复用其他机器的 SDK 路径。
4. 检查 API 地址、地图和微信配置，再同步 Gradle 并选择构建变体。

当前 API 配置在 `android_aiye/gradle.properties`：

```properties
DEV_API_BASE_URL=http://123.57.67.153:8000/
PROD_API_BASE_URL=http://123.57.67.153:8000/
```

这里是当前源码中的配置，不是对该服务器可用性或生产适用性的承诺。模拟器本地联调时，将开发地址改为 `http://10.0.2.2:8000/`；真机使用 Mac 的局域网 IP。

从项目根目录执行开发构建，可用命令行覆盖开发地址，不修改仓库配置：

```bash
./android_aiye/gradlew -p android_aiye assembleDevDebug \
  -PDEV_API_BASE_URL=http://10.0.2.2:8000/
```

API 地址需要以 `/` 结尾。工程有 `dev`、`prod` 两个 flavor，以及 `debug`、`release`、`huawei` 构建类型。发布签名示例目前被注释，不能把编译成功等同于已经配置正式签名。

| 配置项 | 说明 |
| --- | --- |
| `DEV_API_BASE_URL` | 开发 flavor 的后端地址 |
| `PROD_API_BASE_URL` | 生产 flavor 的后端地址 |
| `AMAP_API_KEY` | 高德地图 Key，需匹配包名与签名 SHA-1 |
| `WECHAT_APP_ID` | 微信 App ID |
| `WECHAT_UNIVERSAL_LINK` | 微信相关链接配置 |
| `WECHAT_APP_SCHEME` | 微信回调 Scheme，可由构建配置生成 |

当前 `applicationId` 和 `namespace` 为 `com.example.aiye`；源码路径仍有 `com/example/PeiPei`。排查 SDK 包名或签名问题时，以构建配置和实际安装包为准。

首次构建会重新生成 `.gradle/`、`build/` 等目录，并可能下载依赖。国内镜像仓库不可用时，需要检查网络或仓库配置。

## iOS 开发

直接打开已有工程，不需要重新创建 Xcode 项目：

```bash
open ios_aiye/aiye/aiye/aiye.xcodeproj
```

源码按以下层次组织：

| 目录 | 职责 |
| --- | --- |
| `App/` | 应用入口、会话容器、根路由、主 Tab |
| `Core/Config/` | 从 Info.plist 读取运行配置 |
| `Core/Network/` | API 请求与错误处理 |
| `Core/Auth/` | 登录 token 与 Keychain |
| `Core/Storage/` | CoreData 与本地缓存 |
| `Core/Support/` | 公共视觉规范与错误展示 |
| `Domain/DTO/` | 后端数据传输模型 |
| `Features/` | 首页、体验、服务、搜索、心愿单、聊天和个人中心 |

### 配置优先级

`AppConfig.swift` 从应用 `Info.plist` 读取 `AIYE_BASE_URL`；Info.plist 的值使用 `$(AIYE_BASE_URL)`，由 Xcode Build Settings 注入。

当前 Debug 和 Release 的工程设置及代码回退地址均为 `http://123.57.67.153:8000`。`ios_aiye/aiye/Config/*.xcconfig` 虽然存在，但当前 `project.pbxproj` 没有绑定它们，仅修改这些文件不会自动改变构建结果。

| 配置项 | 用途 |
| --- | --- |
| `AIYE_BASE_URL` | 后端 API 地址 |
| `AIYE_ALLOW_INSECURE_HTTPS` | 开发用的不安全 HTTPS 处理开关，不应作为生产 TLS 方案 |
| `AIYE_WECHAT_APP_ID` | iOS 微信 App ID |
| `AIYE_WECHAT_UNIVERSAL_LINK` | iOS 微信 Universal Link |

模拟器本地联调时，在 Target 的 Build Settings 中将 `AIYE_BASE_URL` 设置为 `http://127.0.0.1:8000`；真机使用 Mac 的局域网 IP。

查看工程与最终构建设置：

```bash
xcodebuild -list \
  -project ios_aiye/aiye/aiye/aiye.xcodeproj

xcodebuild -showBuildSettings \
  -project ios_aiye/aiye/aiye/aiye.xcodeproj \
  -scheme aiye -configuration Debug
```

当前工程允许任意 HTTP 加载，且 `AIYE_ALLOW_INSECURE_HTTPS` 设置为 `YES`。这属于开发配置，上线前需使用可信 HTTPS 并收紧网络安全设置。真机运行还需要配置开发团队、签名和相应设备权限。

## 多端接口地址

| 使用场景 | 建议地址 |
| --- | --- |
| 本机浏览器 / 管理网站 | `http://127.0.0.1:8000` |
| Android 模拟器 | `http://10.0.2.2:8000/` |
| iOS 模拟器 | `http://127.0.0.1:8000` |
| Android / iOS 真机 | `http://<开发电脑局域网IP>:8000`，Android 配置末尾添加 `/` |
| 正式环境 | 自有域名与可信 HTTPS，不能沿用开发安全开关 |

Android 模拟器中的 `127.0.0.1` 指向模拟器自己，而不是开发电脑。真机需要与开发电脑网络互通，且系统防火墙允许访问后端端口。`0.0.0.0` 是服务器监听地址，不是客户端请求地址。

WebSocket 使用相同服务器，HTTP 对应 `ws://`、HTTPS 对应 `wss://`，聊天入口为 `/ws/chat?token=<用户token>`。

## 微信小程序

小程序源码保留在 `wechat_aiye/`，暂不与 Android/iOS 同步更新；不要假定它已覆盖当前后端的全部功能和字段。

```bash
cd wechat_aiye
npm install
npm run dev:weapp
```

生产构建：

```bash
npm run build:weapp
```

输出目录为 `wechat_aiye/dist/`，清理后的源码工作区不包含该目录，需要先构建。微信开发者工具导入 `wechat_aiye/`，`project.config.json` 已将 `miniprogramRoot` 指向 `dist/`。

开发与生产 API 地址分别位于 `config/dev.ts`、`config/prod.ts` 的 `TARO_APP_API_BASE_URL`，当前均为 `https://123.57.67.153`。根据实际部署调整，不默认认为它与原生客户端的 `:8000` 地址是同一个服务。

项目还保留 `dev:h5` 和 `build:h5` 脚本。正式小程序需要配置有效 App ID、合法请求域名和可信 HTTPS；开发配置关闭 URL 校验不代表正式环境可跳过这些要求。

## 接口与业务规则

### 主要接口分组

完整请求结构和参数以运行中的 `/docs` 为准：

| 分组 | 代表路径 |
| --- | --- |
| 账号与用户 | `/users/register`、`/users/login`、`/users/{user_id}` |
| 用户 token 与资料 | `/auth/token`、`/auth/me` |
| 微信与绑手机 | `/auth/wechat/mobile/login`、`/auth/phone/send-code`、`/auth/wechat/bind-phone` |
| 服务 | `/services/`、`/services/discovery`、`/services/{service_id}` |
| 体验 | `/experiences/`、`/experiences/discovery`、`/experiences/{experience_id}` |
| 心愿单 | `/me/wishlist/services`、`/me/wishlist/experiences`、`/me/wishlist/profile` |
| 上传 | `/media/upload`、`/upload/avatar`、`/service/upload`、`/experience/upload`、`/chat/upload` |
| 聊天 | `/chat/conversations`、`/chat/conversations/direct/{peer_id}`、`/ws/chat` |
| 用户反馈 | `/feedbacks`、`/me/feedbacks` |
| 管理 API | `/admin/api/config`、`/admin/api/auth/login`、`/admin/api/overview`、各业务管理接口 |

`/auth/token` 接收表单，不是 JSON；`username` 字段使用手机号。开发种子账号示例：

```bash
curl -X POST http://127.0.0.1:8000/auth/token \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'username=18800000001' \
  --data-urlencode 'password=123456'
```

返回用户 token 后，受保护的用户接口使用 `Authorization: Bearer <token>`。管理接口使用 `X-Admin-Token`，可以是管理员登录返回的会话 token 或配置的固定口令；不要把普通用户 token 当作管理员 token。

开发种子密码仅用于测试，不能直接用于正式部署。

### 审核与排序

- 新发布的非草稿服务和体验进入 `pending_review`，经后台审核通过后才出现在公开发现流中。
- 服务还存在 `draft` 状态；审核状态包含 `pending_review`、`approved`、`rejected`。
- 公开发现流排除已删除内容，服务发现额外排除草稿；未通过审核内容不向匿名用户公开详情。
- 当前服务发现排序为：`sort_priority` 降序、`is_important` 降序、`updated_at` 降序、`created_at` 降序。
- 当前体验发现排序为：`updated_at` 降序、`created_at` 降序，不能假定与服务优先级排序相同。
- 首页体验卡片不显示价格和时长，这些信息保留在详情页和分类列表页。
- Android 与 iOS 的页面更新应同步考虑，iOS 公共样式以 `Core/Support/AppDesign.swift` 为统一入口。

## 数据库与媒体文件

### 初始化行为

默认数据库为 `backend/aiye.db`，SQLite 启用 WAL 模式，运行时可能出现 `aiye.db-wal`、`aiye.db-shm`。

导入 `main.py` 时会执行建表、SQLite 结构同步和 `ensure_seed_data()`。种子脚本不是纯粹的“首次空库初始化”：已有种子记录也可能被更新。

当前 `EXPERIENCE_SEEDS` 为空。只启动一个全新数据库时，首页体验列表可能为空，这不一定是网络故障；需恢复已有体验数据或发布体验并审核通过。

SQLAlchemy 连接可切换到 PostgreSQL，但 `schema_sync.py` 的同步逻辑和当前维护脚本主要针对 SQLite。切换数据库需要单独设计迁移与回归验证。

### 媒体用途

| 目录 | 内容 |
| --- | --- |
| `backend/static/avatars/` | 用户头像与少量必需种子头像 |
| `backend/static/services/` | 服务图片与种子脚本引用的图片 |
| `backend/static/experiences/` | 体验图片，运行时生成 |
| `backend/static/chat/` | 聊天媒体，运行时生成 |

数据库通常保存媒体 URL，而不是图片二进制。只恢复数据库、不恢复媒体，可能出现记录存在但图片无法加载的情况。

### 本次源码精简后的备份

本机清理时，原数据库、业务媒体、旧压缩包和调试资料已移到项目外：

```text
/Users/guocongcong/Documents/AIYE-source-backup-20261114-222423/
```

这是本机历史备份，不属于仓库内容，其他机器不会自动拥有该目录。`cleanup-manifest.json` 记录原始相对路径；`项目分析与清理报告.md` 记录清理范围。

需要恢复原有数据时：

1. 停止全部后端进程，确认目标数据库未被使用。
2. 先备份目标位置现有数据库与媒体，避免覆盖清理后新增的数据。
3. 将同一份备份中的 `aiye.db`、`aiye.db-wal`、`aiye.db-shm` 作为同组文件恢复到目标数据库位置；不要混用不同时点的文件，也不要遗漏原备份中的 WAL。
4. 按原相对路径合并恢复头像、服务、体验与聊天媒体，不要把旧 `backend/static/admin/` 恢复到后端目录。
5. 若使用外部数据库路径，检查 `LULU_DB_PATH`，并确认没有其他 `LULU_DATABASE_URL` 覆盖它。
6. 在副本上先验证数据库读取和启动时的数据同步，再启动正式使用的后端并检查接口与图片。

`aiye.db-wal` 可能包含尚未合并到主库的事务，不能当作一般缓存直接删除。制作新的在线备份时，应使用 SQLite 的一致性备份机制，不要直接复制正在变化的数据库文件。

### 维护脚本

| 脚本 | 用途 |
| --- | --- |
| `backend/scripts/migrate_media_user_dirs.py` | 将媒体路径整理为业务类型与用户目录，更新数据库 URL，并清理部分旧平铺文件 |
| `backend/scripts/repair_experience_images.py` | 从服务图片池补齐或替换需要修复的体验图片 |

这些脚本会修改数据库或媒体文件，不属于常规启动步骤。当前脚本直接使用 `backend/aiye.db` 和 `backend/static/`，不随 `LULU_DB_PATH` 自动改变目标；运行前需检查路径并备份。

## 部署注意事项

当前代码仍有开发配置和种子数据逻辑。以下是上线前需要完成的检查，不是“设置一个环境变量即可生产就绪”的承诺：

1. 设置 `LULU_ENV=production`、强随机且稳定保存的 `LULU_SECRET_KEY`，并配置管理员密码或固定口令。
2. 为用户 token 设置合理过期时间；检查所有开发种子账号、默认密码和自动补全行为，正式数据环境不应直接沿用测试数据。
3. 使用可信 HTTPS，关闭客户端不安全 HTTPS 开关，收紧 iOS 的任意 HTTP 加载设置。
4. 使用不带 `--reload` 的进程管理方式，配置服务重启、日志、持久化存储和备份。
5. 管理入口增加网络访问限制；检查接口文档是否需要限制对外访问。
6. 使用多进程时验证 Redis 聊天广播。手机验证码仍在进程内存中，不能仅配置 Redis 就认为它已跨进程共享。
7. 接入真实短信服务，完成发送频率、验证码和微信授权流程的专项验证。
8. 代理 `/ws/chat` 时正确转发 WebSocket Upgrade，且使用 `wss://`；避免在访问日志中记录完整 token 查询参数。
9. 确认代理和后端上传大小限制一致，完成 Android/iOS 正式签名与第三方 SDK 配置。

从 `backend/` 目录启动单进程服务的命令示例：

```bash
python -m uvicorn main:app --host 127.0.0.1 --port 8000 --workers 1
```

这条命令不负责进程守护、HTTPS 或环境变量配置。正式部署时应由服务管理器提供这些能力。

## 常见问题

| 问题 | 优先检查 |
| --- | --- |
| `ModuleNotFoundError` / `uvicorn 未安装` | 是否使用后端虚拟环境，是否执行 `python -m pip install -r requirements.txt` |
| SQLite 提示无法打开数据库 | `LULU_DB_PATH` 的父目录、权限，以及是否被 `LULU_DATABASE_URL` 覆盖 |
| 8000 端口被占用 | 用 `lsof -i :8000` 查看占用者，或执行 `./run_dev.sh 8001`；不要直接终止不明进程 |
| 管理页面返回 404 | 是否部署 `admin_web/index.html`，配置目录是否正确，移动目录后是否重启后端 |
| 管理页面没有样式或交互 | `/static/admin/admin.css` 和 `/static/admin/admin.js` 是否返回 200，代理映射是否正确 |
| 管理网站登录或数据请求返回 404 | `/admin/api/*` 是否被错误地映射为静态文件，或是否连到旧后端 |
| 管理接口返回 403 | 管理员 token 是否有效，是否使用 `X-Admin-Token`，是否误用了用户 token |
| 体验首页为空 | 新数据库体验种子为空、内容尚未审核，或实际连接了另一套服务器 |
| 记录存在但图片不显示 | 媒体是否随数据库恢复，`/static/*` 是否转发到正确后端 |
| Android 模拟器连不上本机 | 是否使用 `10.0.2.2` 而非 `127.0.0.1`，地址末尾是否有 `/` |
| 真机连不上后端 | 局域网 IP、网络互通、防火墙、监听地址和端口 |
| 改了 iOS xcconfig 却未生效 | 配置文件尚未绑定工程；检查 Target Build Settings 和最终 Info.plist |
| iOS 无法选择运行目标 | 当前 Deployment Target 为 26.4，检查本机 Xcode、SDK 与设备系统版本 |
| Gradle 同步失败 | JDK 21、SDK 34、Wrapper 下载及依赖镜像的网络可达性 |
| 小程序提示缺少 dist | 先运行 `npm install` 和 `npm run build:weapp` |

## 源码管理与清理

工作区主要保留源码、构建配置、界面资源和少量必需种子图片。不分发虚拟环境、构建产物、现有数据库或旧发布压缩包。

运行和构建会重新产生 `.venv/`、`__pycache__/`、Android `build/`、Xcode DerivedData、小程序 `dist/` 和媒体文件，这是正常行为。根目录与各端 `.gitignore` 已覆盖主要生成文件。

忽略规则不会自动停止跟踪以前已经提交的文件。提交前需要检查实际变更，避免带入数据库、上传媒体、密钥、机器路径或大型压缩包。

iOS 工程目录 `ios_aiye/aiye/aiye/` 目前包含独立 `.git`，尚未作为规范子模块统一管理。根仓库的提交不能视为已包含全部 iOS 工程；在不同机器上复制或同步项目时，要另外确认该目录的源码与版本记录，不要直接删除嵌套 `.git`。

保留 `.git` 是为了保留版本历史，它的体积不等于当前源码体积。本 README 更新不涉及删除 Git 历史或改变仓库结构。

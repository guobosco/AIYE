# AIYE 可信账号第一阶段交接

更新日期：2026-11-14。状态：安全基础已实现，不等于真实供应商和三端登录已上线。

## 本次边界

- 后端统一提供密码、短信、App 微信、小程序微信、运营商一键登录认证入口。
- Android、iOS 已接入短信注册/登录、可刷新会话、安全凭证存储和服务端退出。
- 根据用户最新分工，小程序前端由另一个会话负责。本会话停止写入 `wechat_aiye/`，仅提供接口约定。
- App 微信 OpenSDK 和运营商客户端 SDK 尚未集成；当前按钮明确返回不可用，不生成模拟身份。
- 未重启日常后端，未向业务数据库写测试账号；部署前需协调三个客户端升级。

## 已实现的安全规则

- `user_id` 由服务端生成，不使用客户端 ID、手机号或微信 openid 作为内部主键。
- `auth_identities` 按 provider + subject 唯一约束保存已验证身份。phone 为手机号；微信为 `wechat:{appid}` + openid。
- 只有配置 `LULU_WECHAT_OPEN_PLATFORM_ID` 后才以该范围的 unionid 关联账号；不能直接跨 AppID 使用 openid 合并账号。
- `auth_sessions` 保存 refresh token 的 HMAC 摘要。Access Token 默认 15 分钟，会话默认 30 天，到期需重新登录。
- Refresh Token 每次轮换；上一代 refresh 重放撤销整个会话。当前仅保留上一代摘要，尚无所有历史 refresh 的重放追踪。
- 退出当前会话、全部会话后，相应 Access/Refresh Token 不再有效。
- 验证码安全随机生成，摘要存储，5 分钟过期、60 秒发送间隔、最多 5 次错误，按场景和绑定账号隔离，原子消费。
- 短信手机号每小时最多 5 次、IP 每小时最多 20 次；登录和注册另有共享数据库频控。固定窗口可能在窗口边界出现短时集中请求。
- 未验证手机号账号只能使用 `/auth/` 与自身用户资源相关认证流程，不能发布、聊天等。页面导航应依服务端返回的验证状态控制。
- 用户资料更新仅允许 `backend/account_security.py` 中 `PROFILE_FIELDS`。兼容旧完整 User 请求，但忽略手机号、微信身份、实名认证、评分、ID 等禁写字段。
- 手机换绑、账号合并和爱野 ID 修改尚无可信专用接口，不能通过普通资料更新绕过。iOS 相关字段已设只读。
- 真实实名认证未接入，客户端不再自行写认证成功；旧不可达演示组件仍需后续清理。
- WebSocket 连接时验证 Access Token，存续期检查会话撤销/过期，空闲最多约 20 秒后关闭；在线连接不因原 Access Token 到期立即断开。

## 统一接口

除 `/auth/token` 使用表单外，下列 POST 参数均为 JSON；认证请求使用 `Authorization: Bearer <access_token>`。

| 接口 | 参数 | 认证 | 返回 |
| --- | --- | --- | --- |
| `POST /auth/phone/send-code` | `phone_number`, `scene` | binding 场景必须 | `success`, `cooldown_seconds`, `trace_id`, `debug_code` |
| `POST /users/register` | `phone_number`, `password`, `verify_code`，可选资料字段 | 否 | User，注册后需登录 |
| `POST /auth/token` | 表单 `username`=手机号、`password` | 否 | Tokens |
| `POST /auth/phone/login` | `phone_number`, `verify_code` | 否 | AuthSession |
| `POST /auth/phone/one-key/login` | `access_token`=运营商 SDK Token | 否 | AuthSession |
| `POST /auth/wechat/mobile/login` | `code`, `state`, `platform`=`android`或`ios` | 否 | AuthSession |
| `POST /auth/wechat/miniapp/login` | `code`=`Taro.login` 获取值 | 否 | AuthSession |
| `POST /auth/wechat/bind-phone` | `phone_number`, `verify_code` | 是 | User |
| `POST /auth/refresh` | `refresh_token` | 否 | 新 Tokens |
| `POST /auth/logout` | 无 | 是 | `{"success": true}` |
| `POST /auth/logout-all` | 无 | 是 | `{"success": true}` |
| `GET /auth/me` | 无 | 是 | User |
| `PUT /users/{id}` | 可更新资料字段 | 是，本人 | User |

`scene` 仅支持 `register`、`login`、`bind_wechat_phone`，不能混用验证码。

Tokens：`access_token`, `token_type`, `refresh_token`, `expires_in`, `session_id`。

AuthSession 还包含 `user`, `need_bind_phone`, `is_new_user`。小程序与 App 不得保存或信任客户端自造的认证状态。手机号仅支持中国大陆 `1[3-9][0-9]{9}`。

响应错误：400 验证码/输入错误，401 会话失效，403 需验证手机号，409 身份冲突或禁止换绑，429 频控，503 未配置供应商，502 供应商失败。按状态处理，不要用英文 detail 字符串作为业务协议。

原 `POST /users/login` 已返回 410，不再作为登录入口。

## 小程序接入要求

1. 调用 `Taro.login` 后，只将 code 交给 `/auth/wechat/miniapp/login`。不能提交自造 openid；后端不向客户端返回微信 session_key。
2. 保存完整 access + refresh 会话，判断 `need_bind_phone`。需绑定时先带 Bearer 发送 `bind_wechat_phone` 验证码，再调用绑定接口，使用返回 User 更新状态。
3. 认证请求遇到 401 时合并并发刷新，只刷新并重试一次；刷新成功同时替换两个 Token。刷新失败 401 清本地会话；网络错误保留会话并提示重试。
4. 退出先请求 `/auth/logout`，随后清本地会话、用户和聊天缓存。防止进行中的刷新在退出或新登录后写回旧会话。
5. 普通资料请求不得设置认证状态，不把本地资料保存视为验证成功。
6. 小程序手机号授权按钮产生的 code 与短信验证码不同；本阶段未实现微信手机号 `getPhoneNumber` code 兑换接口，不得提交到短信绑定接口。
7. 登录失败、取消授权、手机号冲突、短信发送失败都必须显示失败，不能回退为模拟登录。
8. 配置微信 HTTPS 请求合法域名，真机验证授权、绑定、刷新、退出与账号切换。小程序客户端本轮尚未验证。

## 供应商与平台配置

密钥只放部署环境，不写入客户端、Git 或日志。

| 服务 | 环境变量/平台要求 |
| --- | --- |
| 会话 | `LULU_ENV=production`，强随机 `LULU_SECRET_KEY`；可配 `LULU_ACCESS_TOKEN_EXPIRE_MINUTES`、`LULU_SESSION_EXPIRE_DAYS` |
| 阿里云短信 | `LULU_ALIYUN_ACCESS_KEY_ID`、`LULU_ALIYUN_ACCESS_KEY_SECRET`、`LULU_SMS_SIGN_NAME`、`LULU_SMS_TEMPLATE_CODE`；模板参数为 `code` |
| 阿里云一键登录 | 同上云凭证，开通号码认证服务；客户端分别接入授权 SDK、配置应用认证参数，提交 SDK Token；后端调用 `GetMobile` |
| App 微信 | `LULU_WECHAT_APP_ID`、`LULU_WECHAT_APP_SECRET`；Android 包名/签名、iOS Bundle ID/Universal Links、开放平台审核和两端 OpenSDK |
| 小程序微信 | `LULU_WECHAT_MINI_APP_ID`、`LULU_WECHAT_MINI_APP_SECRET`；合法域名、AppID 与部署一致 |
| 跨微信应用关联 | `LULU_WECHAT_OPEN_PLATFORM_ID`，必须真实绑定同一开放平台且供应商返回 unionid，不能随意填值开启合并 |
| 本地调试短信 | 仅非 production 且显式 `LULU_ENABLE_DEBUG_PHONE_CODES=true`；不发真实短信，返回 debug_code。生产即使设置 true 也禁用 |

当前 App 微信后端共用一个 AppID 配置；如果 Android 和 iOS 注册的是不同开放平台应用，需先扩展分平台配置及对应 identity 范围。

供应商调用协议已有实现，但尚未用真实凭证验证，不应称为已上线。没有配置时返回不可用。App 微信 `state` 仍需与 OpenSDK 授权会话一起完成生成、保存、回调校验和单次消费，后端参数目前不是已完成的防登录 CSRF 保证。

## 上线前必做

- SQLite 一致性备份需包含 WAL 或通过数据库备份 API 完成，不能只复制主 db。新表按现有建表流程创建；未做破坏性旧数据迁移。
- 旧无 session_id 用户 Token 会被拒绝。Android 删除旧明文 Token，不迁移旧会话；上线需提示重新登录。
- 审计旧手机号验证与实名标记。旧客户端曾能自行写 verified，现有历史 true 不等于已证明可信；本轮未批量清理，不能据此宣称历史数据已可信。
- 排查重复手机号/openid，制定人工找回和合并策略。号码回收风险、旧微信范围缺失也需迁移规则；当前冲突返回 409，不自动覆盖。
- 完成 HTTPS、网关可信代理/IP 频控配置、日志脱敏、隐私协议与运营商授权页同意流程。当前协议 UI 尚未形成完整操作门禁。
- 安卓 API 23+ 使用 Keystore AES-GCM；API 21/22 只保留内存会话。iOS Keychain 使用设备限定可访问属性，需真机测试锁屏和恢复场景。
- 会话/验证码/频控表当前无定期清理任务；上线需制定过期数据保留与清理策略。
- 后续补手机号换绑、密码找回、账号合并/注销/冻结、设备管理、审计事件以及全部 refresh 历史重放检测。
- 仍有历史 iOS Swift 6 并发隔离和系统 API 弃用告警；构建通过不等于告警全部消除。

## 验证

所有接口测试使用项目外临时数据库；iOS 接口回归还复制后端源码到临时目录隔离上传文件，并拒绝复用已占用的 18000 端口。

```bash
~/Documents/AIYE-runtime/backend-venv/bin/python -B -m unittest backend.test_account_security -v
bash ios_aiye/tests/run_api_parity.sh
```

最终验证结果：

- 后端 15 项隔离安全测试全部通过，含一键登录供应商手机号来源、缺凭证拒绝以及 WebSocket 会话撤销关闭。供应商成功路径使用 mock，不是真实外部服务验证。
- iOS 回归 23 项检查全部通过，包含实际 APIClient 的自动刷新、绑定发送认证、资料、上传、审核、聊天及退出失效。
- Android `:app:compileDevDebugKotlin` 编译通过，iOS Debug 通用模拟器目标构建通过，现有编译告警仍保留。
- 后端与安卓已修改 tracked 文件的 `git diff --check` 通过。
- 小程序客户端、真实短信、微信、运营商 SDK 与三端真机流程未验证。

## 小程序模板覆盖事故交接

初始化工具曾直接覆盖 `wechat_aiye/` 的 20 个模板文件，没有先保留未提交配置。这是本会话的操作失误。用户要求优先找回未提交版本，随后明确将小程序交给另一个会话。

停止写入前已恢复：

- `src/styles/variables.scss`：从助手本地快照恢复未提交的完整 73 行版本，含原按钮与滚动 mixin。
- `babel.config.js`、`config/dev.ts`、`config/prod.ts`、`config/index.ts`、`src/app.scss`、`src/styles/theme.scss`：恢复初始化前的 Git 版本；这些文件初始化前没有已知未提交改动。
- `src/app.config.ts` 后续已由另一个会话更新路由，本会话没有继续覆盖。

停止写入时尚待另一个会话核对：`project.config.json`（曾变成 touristappid/taro_template）、`package.json`、`tsconfig.json`，以及模板新增的 `src/app.tsx`、`types/`、`project.tt.json` 等。上述是停止时记录，不代表文件当前仍未修复；另一会话持续修改，请以当前源码及其记录为准，勿直接从 Git 整目录覆盖。

未提交变量文件来源为 Trae 快照仓库中 `05e7db7^:disk/content/wechat_aiye/src/styles/variables.scss`。快照仓库位于用户本地 Application Support/Trae 的 `ModularData/ai-agent/snapshot/6af872ba00cce8851b65ac69/v2`。它可用于必要的只读恢复查询，不是常规构建依赖。

# [OPEN] iOS chat create fail

## 问题现象
- iOS 端在用户主页点击“聊一聊”后，弹窗提示：
- `创建聊天会话失败：当前服务器未部署聊天会话接口，请先部署最新后端后再试`

## 复现路径
1. 打开 iOS App
2. 进入用户主页
3. 点击“聊一聊”
4. 观察是否弹出创建聊天会话失败提示

## 当前假设
1. iOS 当前连接的不是本仓库最新后端地址，而是旧环境。
2. 当前连接的后端地址可达，但未部署 `/chat/conversations/direct/{peerId}` 接口。
3. iOS 端 `AIYE_BASE_URL` 配置和我本地构建使用的地址不一致。
4. 服务端接口已存在，但实际返回了 404/405，前端错误映射把它翻译成“未部署接口”。
5. 当前用户鉴权或目标用户参数异常，触发了别的服务端错误，但展示文案掩盖了真实原因。

## 证据记录
- `xcodebuild -showBuildSettings` 结果：
  - `AIYE_BASE_URL = https://123.57.67.153`
  - `AIYE_ALLOW_INSECURE_HTTPS = YES`
- `curl -k -i https://123.57.67.153/healthz`
  - 返回 `200 OK`
  - 响应体：`{"status":"ok","environment":"development"}`
- `curl -k -i -X POST https://123.57.67.153/chat/conversations/direct/seed003`
  - 返回 `404 Not Found`
  - 响应体：`{"detail":"Not Found"}`
- iOS 错误映射：
  - 当 `createConversation` 场景收到 `404` 时，固定翻译为：
  - `创建聊天会话失败：当前服务器未部署聊天会话接口，请先部署最新后端后再试`

## 假设结论
1. `iOS 当前连接的不是本仓库最新后端地址，而是旧环境。`
   - 部分成立：iOS 当前实际连接的是 `https://123.57.67.153`，不是本地开发地址。
2. `当前连接的后端地址可达，但未部署 /chat/conversations/direct/{peerId} 接口。`
   - 成立。
3. `iOS 端 AIYE_BASE_URL 配置和我本地构建使用的地址不一致。`
   - 成立。
4. `服务端接口已存在，但实际返回了 404/405，前端错误映射把它翻译成“未部署接口”。`
   - 成立，实际响应为 `404 Not Found`。
5. `当前用户鉴权或目标用户参数异常，触发了别的服务端错误，但展示文案掩盖了真实原因。`
   - 不成立，当前直接命中路由不存在的 404。

## 下一步
- 部署带聊天接口的后端到 `https://123.57.67.153`
- 或把 iOS `AIYE_BASE_URL` 切到已部署聊天接口的后端环境

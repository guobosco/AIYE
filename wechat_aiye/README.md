# 爱野微信小程序

Taro 4.1.9、React 18、TypeScript、CSS Modules，与 Android/iOS 共用现有 FastAPI。
正在按 Android 当前实现完善，**尚未完成运行和视觉验收，不应视为可发布版本**。
逐页状态和限制见 [安卓对齐清单](./ANDROID_PARITY.md)。

## 已接入能力

- 四个原生 Tab：首页体验/服务、心愿单、消息、我的。
- 体验分类、搜索、服务/体验详情、行程、收藏及服务收藏分组。
- 密码/短信登录、验证码注册、微信登录、手机绑定、刷新令牌和远端退出。
- 个人资料、照片墙、隐私、发布草稿、多档价格、审核管理和删除。
- 会话历史、实时消息、文本、图片、位置、服务/体验卡片和问询。
- 浏览、问询记录、会话标记/归档和日历不可订规则按账号保存于本机。

接口失败显示错误和重试，不回落到伪造业务数据。
问询不是确认订单；不模拟支付、结算、实名通过或客服会话。

## IDE 预览

使用当前 IDE 的小程序技能预览脚本，复用已有端口：

```sh
node /Users/guocongcong/.trae/builtin_skills/TRAE-generate-mini-app/scripts/preview-server.js --framework taro /Users/guocongcong/Documents/GitHub/AIYE/AIYE/wechat_aiye
```

不要删除 `.pai/pai-preview-server.lock`。`.pai/` 为本机预览缓存，`.auth/` 为凭证目录，均不应提交。
预览控制台能打开不等于应用构建和页面验收通过。

## 接口配置

构建配置将 `AIYE_API_BASE_URL` 写入客户端 `TARO_APP_API_BASE_URL`。
当前共享默认值 `https://123.57.67.153` 尚不可达，也不是已验证的小程序合法域名。
本机 `http://127.0.0.1:8000/healthz` 健康检查通过，但云端模拟器或手机无法使用本机回环地址。

正式部署须配置证书有效的 HTTPS 域名及微信 request、uploadFile、socket 合法域名。
微信快捷登录需要后端 `LULU_WECHAT_MINI_APP_ID`、`LULU_WECHAT_MINI_APP_SECRET`；
短信登录需要服务端短信供应商配置。密钥只配置在服务端，不写入客户端源码。

## 回归检查

```sh
node wechat_aiye/regression.test.cjs
```

测试可使用项目 TypeScript，或通过 `AIYE_TYPESCRIPT_PATH` 指向 TypeScript 库。
当前 IDE 提供的 TypeScript 可作为兜底。测试在内存中隔离 Taro 请求和存储，不访问真实账号或业务数据库。
这些检查不替代微信登录、图片上传、聊天键盘、安全区和真机运行验收。

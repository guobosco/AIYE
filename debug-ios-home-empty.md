# Debug Session: ios-home-empty
- **Status**: [OPEN]
- **Issue**: iOS 首页“体验”页显示“服务暂时不可用，请稍后重试”且内容为空，但 Android 同环境下有数据，后端 `experiences/discovery` 与 `services/discovery` 公网接口可正常返回数据。
- **Debug Server**: http://192.168.43.168:7777/event
- **Log File**: .dbg/trae-debug-log-ios-home-empty.ndjson

## Reproduction Steps
1. 运行 iOS 客户端并进入首页默认“体验”页。
2. 等待首页自动刷新完成，观察顶部错误提示与空态。
3. 如有需要，切换 Tab 或下拉刷新后再次观察。

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | `experiences/discovery` 请求成功，但响应解码或赋值后没有写入 `HomeViewModel.experiences` | High | Low | Inconclusive |
| B | `/auth/me` 或其它并发请求失败，导致首页整次刷新被 `catch`，错误状态覆盖发现流 | High | Low | Inconclusive |
| C | iOS 运行时仍使用旧的 `baseURL` / 旧缓存配置，请求没有真正打到目标服务器 | Medium | Low | Inconclusive |
| D | `HomeViewModel` 已拿到非空体验数据，但 View 层仍走了空态分支 | Medium | Medium | Inconclusive |

## Log Evidence
- `.dbg/trae-debug-log-ios-home-empty.ndjson` 当前为 0 行。
- 调试服务 `http://127.0.0.1:7777/health` 返回 `log_count: 0`。
- 说明本轮 iOS 复现没有把埋点事件发送到调试收集器，暂时无法判定首页请求链路内部状态。

## Verification Conclusion
本轮证据不足。优先排查：
1. iPhone 是否能访问调试收集器地址 `http://192.168.43.168:7777/event`
2. 当前运行的 iOS 包是否已经包含本轮埋点代码

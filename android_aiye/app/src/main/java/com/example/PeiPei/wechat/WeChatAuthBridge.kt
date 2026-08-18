package com.example.Lulu.wechat

import android.content.Intent
import com.example.Lulu.BuildConfig
import java.util.UUID

data class WeChatAuthPayload(
    val code: String,
    val state: String
)

/**
 * 当前仓库先提供可联调的微信授权桥接层：
 * - 未配置微信开放平台参数时，返回 debug code，直接走后端 mock/调试链路
 * - 已配置参数后，可在这里替换为真实 OpenSDK 调起逻辑
 */
object WeChatAuthBridge {
    fun requestAuthorization(): Result<WeChatAuthPayload> {
        val state = UUID.randomUUID().toString().replace("-", "")
        if (BuildConfig.WECHAT_APP_ID.isBlank()) {
            val debugCode = "debug_wechat_android_$state"
            return Result.success(WeChatAuthPayload(code = debugCode, state = state))
        }
        return Result.failure(
            IllegalStateException("已填写微信配置，但当前工程尚未接入 Android OpenSDK。")
        )
    }

    fun parseCallbackIntent(intent: Intent?): Result<WeChatAuthPayload>? {
        intent ?: return null
        val error = intent.getStringExtra("wechat_auth_error")?.trim().orEmpty()
        if (error.isNotEmpty()) {
            return Result.failure(IllegalStateException(error))
        }
        val code = intent.getStringExtra("wechat_auth_code")?.trim().orEmpty()
        if (code.isEmpty()) {
            return null
        }
        val state = intent.getStringExtra("wechat_auth_state")?.trim().orEmpty()
        return Result.success(WeChatAuthPayload(code = code, state = state))
    }
}

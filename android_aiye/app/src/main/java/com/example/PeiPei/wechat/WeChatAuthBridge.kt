package com.example.aiye.wechat

import android.content.Intent
import com.example.aiye.BuildConfig

data class WeChatAuthPayload(
    val code: String,
    val state: String
)

/**
 * OpenSDK 接入前明确返回不可用，不生成模拟微信身份。
 */
object WeChatAuthBridge {
    fun requestAuthorization(): Result<WeChatAuthPayload> {
        if (BuildConfig.WECHAT_APP_ID.isBlank()) {
            return Result.failure(IllegalStateException("微信登录尚未配置，请使用手机号登录。"))
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

package com.example.aiye.wechat

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle

/**
 * 微信授权回调占位入口。
 * 真实接入 OpenSDK 后，可在这里将微信返回的 code/state 解析并回传主流程。
 */
class WXEntryActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        forwardToMain(intent)
        finish()
    }

    private fun forwardToMain(sourceIntent: Intent?) {
        val targetIntent = packageManager.getLaunchIntentForPackage(packageName)
            ?.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            ?: Intent(this, Class.forName("com.example.aiye.ui.MainActivity"))
        val data: Uri? = sourceIntent?.data
        targetIntent.putExtra("wechat_auth_code", sourceIntent?.getStringExtra("code") ?: data?.getQueryParameter("code"))
        targetIntent.putExtra("wechat_auth_state", sourceIntent?.getStringExtra("state") ?: data?.getQueryParameter("state"))
        targetIntent.putExtra("wechat_auth_error", sourceIntent?.getStringExtra("error"))
        startActivity(targetIntent)
    }
}

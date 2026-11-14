// 文件说明：认证会话、Token 或登录态的远程侧封装。

package com.example.aiye.data.remote

import android.content.SharedPreferences
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONObject
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

object AuthSession {
    private const val KEY_SESSION = "encrypted_auth_session"
    private const val KEY_ALIAS = "aiye_auth_session_v1"

    @Volatile
    private var accessToken: String? = null
    @Volatile
    private var refreshToken: String? = null
    private var sharedPreferences: SharedPreferences? = null
    private val _signedIn = MutableStateFlow(false)
    val signedIn = _signedIn.asStateFlow()
    private val _tokenChanges = MutableStateFlow<String?>(null)
    val tokenChanges = _tokenChanges.asStateFlow()

    @Synchronized
    fun initialize(sharedPreferences: SharedPreferences) {
        this.sharedPreferences = sharedPreferences
        accessToken = null
        refreshToken = null
        // Legacy unbounded tokens are deliberately not migrated.
        sharedPreferences.edit().remove("access_token").apply()
        if (Build.VERSION.SDK_INT >= 23) {
            runCatching {
                val encoded = sharedPreferences.getString(KEY_SESSION, null) ?: return@runCatching
                val bytes = Base64.decode(encoded, Base64.NO_WRAP)
                val cipher = Cipher.getInstance("AES/GCM/NoPadding")
                cipher.init(Cipher.DECRYPT_MODE, encryptionKey(), GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
                val payload = JSONObject(String(cipher.doFinal(bytes.copyOfRange(12, bytes.size)), Charsets.UTF_8))
                accessToken = payload.getString("access")
                refreshToken = payload.optString("refresh").takeIf { it.isNotBlank() }
            }.onFailure {
                sharedPreferences.edit().remove(KEY_SESSION).remove("current_user_id").apply()
            }
        }
        _signedIn.value = !accessToken.isNullOrEmpty()
        _tokenChanges.value = accessToken
        if (!_signedIn.value) sharedPreferences.edit().remove("current_user_id").apply()
    }

    fun getAccessToken(): String? = accessToken
    fun getRefreshToken(): String? = refreshToken

    @Synchronized
    fun updateAccessToken(token: String?) {
        updateSession(token, if (token.isNullOrEmpty()) null else refreshToken)
    }

    @Synchronized
    fun updateSession(token: String?, refresh: String?) {
        if (token.isNullOrEmpty()) {
            sharedPreferences?.edit()?.remove(KEY_SESSION)?.remove("current_user_id")?.apply()
        } else if (Build.VERSION.SDK_INT >= 23) {
            val payload = JSONObject().put("access", token).put("refresh", refresh.orEmpty())
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, encryptionKey())
            val bytes = cipher.iv + cipher.doFinal(payload.toString().toByteArray(Charsets.UTF_8))
            check(sharedPreferences?.edit()?.putString(KEY_SESSION, Base64.encodeToString(bytes, Base64.NO_WRAP))?.commit() == true) {
                "Unable to persist authentication session"
            }
        }
        // API 21/22 use an in-memory session, never plaintext persistence.
        accessToken = token
        refreshToken = refresh
        _signedIn.value = !token.isNullOrEmpty()
        _tokenChanges.value = token
    }

    private fun encryptionKey(): SecretKey {
        check(Build.VERSION.SDK_INT >= 23)
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build())
        }.generateKey()
    }
}

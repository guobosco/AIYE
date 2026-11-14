// 文件说明：手机号验证弹窗（验证码输入等）。

package com.example.aiye.ui.screen

import android.widget.Toast
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import com.example.aiye.data.local.AppDataStore

@Composable
fun VerifyPhoneDialog(
    phoneNumber: String,
    onDismiss: () -> Unit,
    onConfirm: () -> Unit
) {
    var verifyCode by remember { mutableStateOf("") }
    var isCodeSent by remember { mutableStateOf(false) }
    var countdown by remember { mutableStateOf(60) }
    var verifying by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val focusRequester = remember { FocusRequester() }

    LaunchedEffect(Unit) {
        delay(100)
        focusRequester.requestFocus()
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("验证手机号") },
        text = {
            Column {
                Text("验证码将发送至: $phoneNumber", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(modifier = Modifier.height(16.dp))
                
                Row(
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    OutlinedTextField(
                        value = verifyCode,
                        onValueChange = { if (it.length <= 6 && it.all { char -> char.isDigit() }) verifyCode = it },
                        label = { Text("验证码") },
                        modifier = Modifier.weight(1f).padding(end = 8.dp).focusRequester(focusRequester),
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number)
                    )
                    
                    Button(
                        onClick = {
                            isCodeSent = true
                            scope.launch {
                                val result = AppDataStore.getRepository()?.sendPhoneCode(phoneNumber, "bind_wechat_phone")
                                if (result == null || result.isFailure) {
                                    isCodeSent = false
                                    Toast.makeText(context, "验证码发送失败，请稍后重试", Toast.LENGTH_LONG).show()
                                    return@launch
                                }
                                countdown = result.getOrThrow().cooldownSeconds
                                while (countdown > 0) {
                                    delay(1000)
                                    countdown--
                                }
                                isCodeSent = false
                            }
                        },
                        enabled = !isCodeSent,
                        contentPadding = PaddingValues(horizontal = 8.dp)
                    ) {
                        Text(if (isCodeSent) "${countdown}s" else "获取验证码", fontSize = 12.sp)
                    }
                }
            }
        },
        confirmButton = {
            TextButton(
                onClick = {
                    if (verifyCode.length == 6 && !verifying) {
                        scope.launch {
                            verifying = true
                            val verified = AppDataStore.getRepository()?.bindWeChatPhone(phoneNumber, verifyCode)
                            verifying = false
                            if (verified != null) onConfirm()
                            else Toast.makeText(context, "验证失败，请检查验证码", Toast.LENGTH_LONG).show()
                        }
                    } else {
                        Toast.makeText(context, "请输入正确的验证码", Toast.LENGTH_SHORT).show()
                    }
                },
                enabled = !verifying
            ) {
                Text("验证")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("取消") }
        }
    )
}

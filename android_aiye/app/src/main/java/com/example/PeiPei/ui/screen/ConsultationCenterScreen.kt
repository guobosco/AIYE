package com.example.aiye.ui.screen

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.example.aiye.data.local.AppDataStore
import com.example.aiye.data.remote.*
import com.example.aiye.ui.navigation.Screen
import kotlinx.coroutines.launch

@Composable
fun ConsultationCenterScreen(nav: NavController) {
    val user by AppDataStore.currentUser.collectAsState()
    key(user.id) { ConsultationCenterContent(nav) }
}

@Composable
private fun ConsultationCenterContent(nav: NavController) {
    val user by AppDataStore.currentUser.collectAsState()
    val scope = rememberCoroutineScope()
    val api = RetrofitClient.apiService
    val tabs = listOf("问询", "提醒", "会话", "屏蔽与举报", "账号", "搜索", "处理记录")
    var tab by remember { mutableStateOf("问询") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var confirmation by remember { mutableStateOf<String?>(null) }
    var pendingAction by remember { mutableStateOf<(suspend () -> Unit)?>(null) }
    var inquiries by remember(user.id) { mutableStateOf(emptyList<ConsultationInquiry>()) }
    var notices by remember(user.id) { mutableStateOf(emptyList<ConsultationNotice>()) }
    var sessions by remember(user.id) { mutableStateOf(emptyList<LoginSession>()) }
    var blocks by remember(user.id) { mutableStateOf(emptyList<BlockedAccount>()) }
    var feedbacks by remember(user.id) { mutableStateOf(emptyList<ConsultationFeedback>()) }
    var reminders by remember(user.id) { mutableStateOf<ReminderSettings?>(null) }
    var results by remember(user.id) { mutableStateOf(emptyList<CatalogSearchItem>()) }
    var nextPage by remember { mutableStateOf(false) }
    var peer by remember { mutableStateOf("") }
    var reportKind by remember { mutableStateOf("user") }
    var reason by remember { mutableStateOf("") }
    var oldCode by remember { mutableStateOf("") }
    var newPhone by remember { mutableStateOf("") }
    var newCode by remember { mutableStateOf("") }
    var closeCode by remember { mutableStateOf("") }
    var query by remember { mutableStateOf("") }
    var city by remember { mutableStateOf("") }
    var category by remember { mutableStateOf("") }
    var kind by remember { mutableStateOf("experience") }
    var cooldowns by remember { mutableStateOf(emptyMap<String, Int>()) }
    LaunchedEffect(cooldowns) {
        if (cooldowns.values.any { it > 0 }) {
            kotlinx.coroutines.delay(1000)
            cooldowns = cooldowns.mapValues { (_, value) -> (value - 1).coerceAtLeast(0) }
        }
    }
    suspend fun load(more: Boolean = false) {
        val owner = user.id
        when (tab) {
            "问询" -> {
                val page = api.getInquiries(if (more) inquiries.size else 0)
                check(AppDataStore.currentUser.value.id == owner) { "账号已切换" }
                inquiries = if (more) inquiries + page else page
                nextPage = page.size == 100
            }
            "提醒" -> {
                val page = api.getNotices(if (more) notices.size else 0)
                val preference = api.getReminders()
                check(AppDataStore.currentUser.value.id == owner) { "账号已切换" }
                notices = if (more) notices + page else page
                reminders = preference
                nextPage = page.size == 100
            }
            "会话" -> {
                val page = api.getLoginSessions(if (more) sessions.size else 0)
                check(AppDataStore.currentUser.value.id == owner)
                sessions = if (more) sessions + page else page
                nextPage = page.size == 100
            }
            "屏蔽与举报" -> {
                val page = api.getBlockedAccounts(if (more) blocks.size else 0)
                check(AppDataStore.currentUser.value.id == owner)
                blocks = if (more) blocks + page else page
                nextPage = page.size == 100
            }
            "搜索" -> {
                val page = api.searchCatalog(kind, query.trim(), city.trim(), category.trim(), if (more) results.size else 0)
                check(AppDataStore.currentUser.value.id == owner)
                results = if (more) results + page else page
                nextPage = page.size == 30
            }
            "处理记录" -> {
                val page = api.getConsultationFeedback(if (more) feedbacks.size else 0)
                check(AppDataStore.currentUser.value.id == owner)
                feedbacks = if (more) feedbacks + page else page
                nextPage = page.size == 100
            }
            else -> nextPage = false
        }
    }
    fun run(operation: suspend () -> Unit) {
        if (busy) return
        busy = true
        error = null
        scope.launch {
            try { operation(); confirmation = null; pendingAction = null }
            catch (failure: Exception) {
                if (failure is kotlinx.coroutines.CancellationException) throw failure
                error = failure.message ?: "操作失败，请重试"
            }
            finally { busy = false }
        }
    }
    fun confirm(text: String, operation: suspend () -> Unit) {
        confirmation = text
        pendingAction = operation
    }
    fun sms(scene: String, number: String) = run {
        val response = api.sendPhoneCode(PhoneSendCodeRequest(number, scene))
        cooldowns = cooldowns + (scene to response.cooldownSeconds)
    }
    LaunchedEffect(tab, user.id) {
        if (user.id.isNotBlank() || tab == "搜索") run { load() }
    }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)) {
        TextButton(onClick = { nav.popBackStack() }) { Text("返回") }
        Text("咨询中心", style = MaterialTheme.typography.headlineSmall)
        Text("问询不是订单，不涉及站内支付、库存占位或履约承诺。")
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState())) {
            tabs.forEach { name -> TextButton(enabled = !busy, onClick = { nextPage = false; error = null; tab = name }) { Text(name) } }
        }
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
        if (user.id.isBlank() && tab != "搜索") {
            OutlinedButton(onClick = { nav.navigate(Screen.Login.createRoute()) }) { Text("登录后使用") }
        } else {
            OutlinedButton(enabled = !busy, onClick = { run { load() } }) { Text("刷新 / 重试") }
            when (tab) {
                "处理记录" -> {
                    if (feedbacks.isEmpty()) Text("暂无举报或反馈处理记录")
                    feedbacks.forEach { item ->
                        Text(if (item.category.startsWith("report_")) "举报" else "意见反馈")
                        Text(when (item.status) { "pending" -> "待处理"; "processing" -> "处理中"; else -> "已处理" })
                        if (item.adminNote.isNotBlank()) Text(item.adminNote)
                        HorizontalDivider()
                    }
                }
                "问询" -> {
                    TextButton(onClick = { nav.navigate(Screen.MyBookedServices.route) }) { Text("查看历史本机问询（未自动迁移）") }
                    if (inquiries.isEmpty() && !busy) Text("暂无问询")
                    inquiries.forEach { item ->
                        Text(item.title, style = MaterialTheme.typography.titleMedium)
                        Text("${if (item.userId == user.id) "我发出的" else "收到的"} · ${when (item.status) {
                            "pending" -> "待回复"; "replied" -> "已回复"; else -> "已结束"
                        }}")
                        val detailText = linkedMapOf(
                            "inquiry_date" to "意向日期", "guest_count" to "人数", "selected_option" to "方案",
                            "location" to "地点", "price_text" to "参考价格", "price_basis_text" to "计价方式"
                        ).mapNotNull { (key, label) ->
                            val value = item.details[key]
                            val text = if (key == "guest_count" && value is Number) value.toInt().toString() else value?.toString()
                            text?.takeIf { it.isNotBlank() }?.let { "$label：$it" }
                        }.joinToString(" · ")
                        if (detailText.isNotBlank()) Text(detailText)
                        TextButton(onClick = { nav.navigate(Screen.MessageThread.createRoute(item.conversationId)) }) { Text("打开沟通") }
                        if (item.status != "closed") {
                            if (item.hostId == user.id && item.status == "pending") OutlinedButton(enabled = !busy, onClick = {
                                confirm("标记已回复？这不表示确认订单。") {
                                    api.updateInquiry(item.id, mapOf("status" to "replied", "version" to item.version)); load()
                                }
                            }) { Text("标记已回复") }
                            TextButton(enabled = !busy, onClick = { confirm("结束这条问询？双方都能看到状态。") {
                                api.updateInquiry(item.id, mapOf("status" to "closed", "version" to item.version)); load()
                            } }) { Text("结束问询") }
                        }
                        HorizontalDivider()
                    }
                }
                "提醒" -> {
                    Text("远程推送尚未配置；以下为跨端站内提醒。")
                    reminders?.let { settings ->
                        Row {
                            Text("站内提醒")
                            Switch(settings.enabled, enabled = !busy, onCheckedChange = { enabled ->
                                run { reminders = api.updateReminders(mapOf("enabled" to enabled)) }
                            })
                        }
                    }
                    if (notices.isEmpty()) Text("暂无提醒")
                    notices.forEach { item ->
                        Text("${if (item.isRead) "已读" else "未读"} · ${item.title}")
                        TextButton(enabled = !busy, onClick = { run {
                            api.readNotice(item.id)
                            load()
                            if (item.conversationId.isNotBlank()) nav.navigate(Screen.MessageThread.createRoute(item.conversationId))
                        } }) { Text("查看并标记已读") }
                    }
                }
                "会话" -> {
                    if (sessions.isEmpty() && !busy) Text("暂无登录会话")
                    sessions.forEach { item ->
                        Text(if (item.isCurrent) "当前登录会话" else "其他登录会话")
                        Text(java.text.SimpleDateFormat("yyyy-MM-dd HH:mm", java.util.Locale.CHINA).format(java.util.Date(item.createdAt)))
                        if (!item.isCurrent) TextButton(enabled = !busy, onClick = { confirm("撤销该登录会话？该设备将需要重新登录。") {
                            api.revokeLoginSession(item.id); load()
                        } }) { Text("撤销会话") }
                    }
                }
                "屏蔽与举报" -> {
                    Text("可从搜索结果选择内容举报或屏蔽主理人；历史聊天不会被删除。")
                    OutlinedTextField(peer, { peer = it }, enabled = !busy, label = { Text("目标 ID") })
                    Row {
                        listOf("user", "service", "experience", "message").forEach { value ->
                            TextButton(enabled = !busy, onClick = { reportKind = value }) { Text(when (value) {
                                "user" -> "用户"; "service" -> "服务"; "experience" -> "体验"; else -> "消息"
                            }) }
                        }
                    }
                    Text("举报类型：$reportKind")
                    OutlinedTextField(reason, { reason = it.take(2000) }, enabled = !busy, label = { Text("举报原因") })
                    OutlinedButton(enabled = !busy && peer.isNotBlank() && reason.trim().length >= 2, onClick = {
                        confirm("提交举报至平台审核？") {
                            api.submitReport(mapOf("kind" to reportKind, "target_id" to peer.trim(), "reason" to reason.trim()))
                            reason = ""; error = "举报已提交，可在意见反馈处理记录中查看"
                        }
                    }) { Text("提交举报") }
                    if (reportKind == "user") OutlinedButton(enabled = !busy && peer.isNotBlank(), onClick = {
                        confirm("屏蔽该用户？将阻止双方新的私信。") { api.blockAccount(peer.trim()); load() }
                    }) { Text("屏蔽用户") }
                    if (blocks.isEmpty() && !busy) Text("暂无屏蔽用户")
                    blocks.forEach { item ->
                        Text(item.peerId)
                        TextButton(enabled = !busy, onClick = { confirm("解除屏蔽？") { api.unblockAccount(item.peerId); load() } }) { Text("解除屏蔽") }
                    }
                }
                "账号" -> {
                    Text("手机号换绑须验证新旧号码；成功后所有设备退出。无法使用旧号码请走人工找回。")
                    OutlinedTextField(oldCode, { oldCode = it.take(6) }, enabled = !busy, label = { Text("旧手机号验证码") })
                    TextButton(enabled = !busy && (cooldowns["change_phone_old"] ?: 0) == 0, onClick = { sms("change_phone_old", user.phoneNumber.orEmpty()) }) { Text("发送旧号码验证码") }
                    OutlinedTextField(newPhone, { newPhone = it }, enabled = !busy, label = { Text("新手机号") })
                    OutlinedTextField(newCode, { newCode = it.take(6) }, enabled = !busy, label = { Text("新手机号验证码") })
                    TextButton(enabled = !busy && (cooldowns["change_phone_new"] ?: 0) == 0, onClick = { sms("change_phone_new", newPhone) }) { Text("发送新号码验证码") }
                    OutlinedButton(enabled = !busy && oldCode.length == 6 && newCode.length == 6, onClick = { confirm("确认更换手机号并退出所有设备？") {
                        api.changePhone(mapOf("phone_number" to newPhone, "old_code" to oldCode, "new_code" to newCode))
                        AppDataStore.logout(); nav.popBackStack()
                    } }) { Text("确认换绑") }
                    HorizontalDivider()
                    Text("注销会清除个人资料、下架发布内容并撤销登录。历史沟通及必要审计记录保留匿名引用；操作不可恢复。")
                    OutlinedTextField(closeCode, { closeCode = it.take(6) }, enabled = !busy, label = { Text("注销验证码") })
                    TextButton(enabled = !busy && (cooldowns["close_account"] ?: 0) == 0, onClick = { sms("close_account", user.phoneNumber.orEmpty()) }) { Text("发送注销验证码") }
                    TextButton(enabled = !busy && closeCode.length == 6, onClick = { confirm("永久注销当前账号？此操作不可恢复。") {
                        check(api.closeAccount(mapOf("verify_code" to closeCode, "confirmation" to "注销账号"))["closed"] == true)
                        AppDataStore.logout(); nav.popBackStack()
                    } }) { Text("注销账号") }
                }
                "搜索" -> {
                    Row { listOf("experience" to "体验", "service" to "服务").forEach { (value, text) ->
                        TextButton(enabled = !busy, onClick = { kind = value; results = emptyList(); nextPage = false }) { Text(text) }
                    } }
                    OutlinedTextField(query, { query = it }, enabled = !busy, label = { Text("关键词") })
                    OutlinedTextField(city, { city = it }, enabled = !busy, label = { Text("城市") })
                    OutlinedTextField(category, { category = it }, enabled = !busy, label = { Text("分类，留空不限") })
                    OutlinedButton(enabled = !busy, onClick = { run { load() } }) { Text("搜索") }
                    if (results.isEmpty()) Text("暂无搜索结果")
                    results.forEach { item ->
                        Text("${item.title} · ${item.location}")
                        TextButton(onClick = { nav.navigate(if (item.kind == "service") Screen.ServiceDetail.createRoute(item.id) else Screen.ExperienceDetail.createRoute(item.id)) }) { Text("查看详情") }
                        if (user.id.isNotBlank()) Row {
                            TextButton(enabled = !busy, onClick = { peer = item.id; reportKind = item.kind; tab = "屏蔽与举报" }) { Text("举报内容") }
                            TextButton(enabled = !busy && item.hostId != user.id, onClick = { confirm("屏蔽该主理人？") { api.blockAccount(item.hostId); load() } }) { Text("屏蔽主理人") }
                        }
                    }
                }
            }
            if (nextPage) OutlinedButton(enabled = !busy, onClick = { run { load(true) } }) { Text("加载更多") }
        }
    }
    confirmation?.let { text -> AlertDialog(
        onDismissRequest = { if (!busy) { confirmation = null; pendingAction = null } },
        title = { Text("请确认") }, text = { Text(error ?: text) },
        confirmButton = { TextButton(enabled = !busy, onClick = { pendingAction?.let { run(it) } }) { Text("确认") } },
        dismissButton = { TextButton(enabled = !busy, onClick = { confirmation = null; pendingAction = null }) { Text("取消") } }
    ) }
}

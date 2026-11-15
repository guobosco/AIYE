package com.example.aiye.ui.screen

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import coil.compose.AsyncImage
import com.example.aiye.data.local.AppDataStore
import com.example.aiye.data.model.Experience
import com.example.aiye.data.model.ExperienceDetailStep
import com.example.aiye.data.model.hasCompletedOnboardingProfile
import com.example.aiye.data.remote.AuthSession
import com.example.aiye.data.remote.RetrofitClient
import com.example.aiye.ui.navigation.Screen
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.util.UUID

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ExperienceManagementScreen(
    navController: NavController, edit: String? = null, category: String? = null,
    favorites: Boolean = false
) {
    val user by AppDataStore.currentUser.collectAsState()
    val api = RetrofitClient.apiService
    val scope = rememberCoroutineScope()
    var items by remember(user.id) { mutableStateOf(emptyList<Experience>()) }
    var editor by remember(user.id) { mutableStateOf<Experience?>(null) }
    var loading by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var search by remember { mutableStateOf("") }
    var action by remember { mutableStateOf<Pair<Experience, String>?>(null) }
    val canUse = AuthSession.getAccessToken() != null && user.isPhoneVerified && user.hasCompletedOnboardingProfile()

    suspend fun reload() {
        loading = true
        error = null
        val owner = user.id
        try {
            val fetched = if (favorites) {
                AppDataStore.refreshFavoriteExperiences()
                AppDataStore.favoriteExperienceIds.value.mapNotNull { id ->
                    try { api.getExperienceById(id) }
                    catch (e: retrofit2.HttpException) { if (e.code() == 404) null else throw e }
                }
            } else {
                val result = mutableListOf<Experience>()
                for (skip in 0 until 10000 step 100) {
                    val page = api.getMyExperiences(skip, 100)
                    result.addAll(page)
                    if (page.size < 100) break
                }
                result
            }
            if (AppDataStore.currentUser.value.id == owner) items = fetched
        } catch (e: Exception) { error = "加载失败，请重试" }
        finally { loading = false }
    }
    LaunchedEffect(user.id, canUse) {
        if (canUse) {
            reload()
            if (edit == "new") editor = Experience(
                id = UUID.randomUUID().toString(), hostId = user.id,
                category = category ?: "其他体验", hostName = user.name, isSynced = false
            )
        }
    }
    if (editor != null) {
        ExperienceEditor(
            initial = checkNotNull(editor),
            onClose = { editor = null },
            onSaved = { editor = null; scope.launch { reload() } }
        )
        return
    }
    Scaffold(topBar = {
        CenterAlignedTopAppBar(title = { Text(if (favorites) "体验心愿单" else "我发布的体验") },
            navigationIcon = { TextButton(onClick = { navController.popBackStack() }) { Text("返回") } },
            actions = {
                if (!favorites && canUse) TextButton(onClick = {
                    editor = Experience(id = UUID.randomUUID().toString(), hostId = user.id,
                        hostName = user.name, category = "其他体验", isSynced = false)
                }) { Text("发布") }
            })
    }) { padding ->
        LazyColumn(Modifier.fillMaxSize().padding(padding).padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (!canUse) item {
                Text("请先完成账号验证和资料")
                OutlinedButton(onClick = {
                    navController.navigate(when {
                        AuthSession.getAccessToken() == null -> Screen.Login.createRoute()
                        !user.isPhoneVerified -> Screen.WeChatBindPhone.route
                        else -> Screen.CompleteProfile.route
                    })
                }) { Text("继续完善账号") }
            } else {
                item {
                    OutlinedTextField(search, { search = it }, label = { Text("搜索标题、类目或状态") },
                        modifier = Modifier.fillMaxWidth())
                    TextButton(onClick = { scope.launch { reload() } }, enabled = !loading && !busy) { Text("刷新") }
                    if (loading) CircularProgressIndicator()
                    error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                    if (!loading && items.isEmpty()) Text("暂无记录")
                }
                items(items.sortedByDescending { it.updatedAt }.filter {
                    listOf(it.title, it.category, experienceState(it)).any { value -> value.contains(search) }
                }, key = { it.id }) { experience ->
                    Card(Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text(experience.title, style = MaterialTheme.typography.titleMedium)
                            Text("${experience.category} · ${experience.location} · ${experienceState(experience)}")
                            if (experience.reviewNote.isNotBlank()) Text(experience.reviewNote)
                            if (favorites) {
                                TextButton(onClick = { navController.navigate(Screen.ExperienceDetail.createRoute(experience.id)) }) { Text("查看体验") }
                                TextButton(enabled = !busy, onClick = {
                                    busy = true
                                    scope.launch {
                                        try { AppDataStore.setFavoriteExperience(experience.id, false); reload() }
                                        catch (e: Exception) { error = "移出失败，请重试" }
                                        finally { busy = false }
                                    }
                                }) { Text("移出心愿单") }
                            } else {
                                Row {
                                    TextButton(enabled = !busy, onClick = { editor = experience }) { Text("编辑") }
                                    TextButton(enabled = !busy, onClick = { action = experience to if (experience.isDeleted) "restore" else "cancel" }) {
                                        Text(if (experience.isDeleted) "重新发布" else "取消发布")
                                    }
                                    if (experience.isDeleted || experience.isDraft) {
                                        TextButton(enabled = !busy, onClick = { action = experience to "hide" }) { Text("隐藏记录") }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    action?.let { (item, operation) ->
        AlertDialog(onDismissRequest = { if (!busy) action = null },
            title = { Text(when (operation) { "hide" -> "隐藏记录"; "restore" -> "重新提交审核"; else -> "取消发布" }) },
            text = { Text(if (operation == "hide") "仅从我的列表隐藏，服务端保留内容，不影响历史聊天引用。" else "发布与恢复需审核通过才会公开展示；取消不会撤回聊天引用。") },
            confirmButton = { TextButton(enabled = !busy, onClick = {
                busy = true
                scope.launch {
                    try {
                        when (operation) {
                            "hide" -> check(api.hideExperienceRecord(item.id)["hidden"] == true)
                            "restore" -> api.updateExperience(item.id, item.copy(isDeleted = false, isDraft = false))
                            else -> api.deleteExperience(item.id)
                        }
                        action = null
                        reload()
                    } catch (e: Exception) { error = "操作失败，请重试" }
                    finally { busy = false }
                }
            }) { Text("确定") } },
            dismissButton = { TextButton(enabled = !busy, onClick = { action = null }) { Text("取消") } })
    }
}

private fun experienceState(item: Experience) = when {
    item.isDeleted -> "已取消"
    item.isDraft -> "草稿"
    item.reviewStatus == "approved" -> "已通过"
    item.reviewStatus == "rejected" -> "未通过"
    else -> "待审核"
}

@Composable
private fun ExperienceEditor(initial: Experience, onClose: () -> Unit, onSaved: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var value by remember(initial.id) { mutableStateOf(initial) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var tags by remember { mutableStateOf(initial.tags.joinToString("、")) }
    val imagePicker = rememberLauncherForActivityResult(ActivityResultContracts.GetMultipleContents()) { uris ->
        if (uris.isNotEmpty() && !busy) {
            busy = true
            scope.launch {
                try {
                    val owner = AppDataStore.currentUser.value.id
                    val urls = mutableListOf<String>()
                    for (uri in uris.take((18 - value.imageUrls.size).coerceAtLeast(0))) {
                        val url = withContext(Dispatchers.IO) {
                            val file = File.createTempFile("experience-", ".jpg", context.cacheDir)
                            try {
                                context.contentResolver.openInputStream(uri)?.use { input ->
                                    file.outputStream().use { input.copyTo(it) }
                                } ?: error("图片不可读取")
                                AppDataStore.getRepository()?.uploadServiceFile(file)?.url ?: error("上传失败")
                            } finally { file.delete() }
                        }
                        urls.add(url)
                    }
                    if (AppDataStore.currentUser.value.id == owner) value = value.copy(imageUrls = value.imageUrls + urls)
                } catch (e: Exception) { error = "图片上传失败，请重试" }
                finally { busy = false }
            }
        }
    }
    fun save(draft: Boolean) {
        if (busy) return
        val owner = AppDataStore.currentUser.value
        if (!owner.isPhoneVerified || !owner.hasCompletedOnboardingProfile() || AuthSession.getAccessToken() == null) {
            error = "请先完成账号验证和资料"; return
        }
        if (!draft && listOf(value.title, value.description, value.category, value.location, value.priceText)
                .any { it.isBlank() } || !draft && value.imageUrls.isEmpty()) {
            error = "请填写标题、描述、类别、地点、价格并上传封面"; return
        }
        val now = System.currentTimeMillis()
        val payload = value.copy(hostId = owner.id, hostName = owner.name,
            title = value.title.trim().ifBlank { "未命名草稿" }, coverImageUrl = value.imageUrls.firstOrNull().orEmpty(),
            tags = tags.split("、", ",", "，").map { it.trim() }.filter { it.isNotEmpty() }.distinct(),
            isDraft = draft, isDeleted = false, createdAt = value.createdAt.takeIf { it > 0 } ?: now,
            updatedAt = now, isSynced = true)
        busy = true
        scope.launch {
            try {
                val api = RetrofitClient.apiService
                if (initial.isSynced) api.updateExperience(payload.id, payload) else {
                    try { api.createExperience(payload) }
                    catch (e: Exception) {
                        val existing = try { api.getExperienceById(payload.id) } catch (_: Exception) { throw e }
                        check(existing.hostId == owner.id)
                        api.updateExperience(payload.id, payload)
                    }
                }
                if (AppDataStore.currentUser.value.id == owner.id) onSaved()
            } catch (e: Exception) { error = "保存失败，填写内容已保留，请重试" }
            finally { busy = false }
        }
    }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("发布体验", style = MaterialTheme.typography.headlineSmall)
        OutlinedTextField(value.title, { value = value.copy(title = it) }, enabled = !busy, label = { Text("标题") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(value.description, { value = value.copy(description = it) }, enabled = !busy, label = { Text("描述") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(value.category, { value = value.copy(category = it) }, enabled = !busy, label = { Text("体验方向") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(value.location, { value = value.copy(location = it) }, enabled = !busy, label = { Text("集合地点") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(value.priceText, { value = value.copy(priceText = it) }, enabled = !busy, label = { Text("价格") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(value.priceBasisText, { value = value.copy(priceBasisText = it) }, enabled = !busy, label = { Text("计价说明") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(value.durationText, { value = value.copy(durationText = it) }, enabled = !busy, label = { Text("体验时长") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(value.badgeText, { value = value.copy(badgeText = it) }, enabled = !busy, label = { Text("体验徽章") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(tags, { tags = it }, enabled = !busy, label = { Text("标签，用顿号分隔") }, modifier = Modifier.fillMaxWidth())
        value.imageUrls.forEach { url ->
            AsyncImage(url, "体验图片", modifier = Modifier.fillMaxWidth().height(120.dp).clickable {
                if (!busy) value = value.copy(imageUrls = value.imageUrls - url)
            })
        }
        OutlinedButton(enabled = !busy && value.imageUrls.size < 18, onClick = { imagePicker.launch("image/*") }) { Text("上传图片，最多18张，点击可移除") }
        value.detailSteps.forEachIndexed { index, step ->
            fun updateStep(next: ExperienceDetailStep) {
                if (busy) return
                value = value.copy(detailSteps = value.detailSteps.toMutableList().also { it[index] = next })
            }
            OutlinedTextField(step.title, { updateStep(step.copy(title = it)) }, label = { Text("步骤标题") }, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(step.description, { updateStep(step.copy(description = it)) }, label = { Text("步骤说明") }, modifier = Modifier.fillMaxWidth())
            Row {
                TextButton(enabled = !busy, onClick = { updateStep(step.copy(imageUrls = value.imageUrls.take(9))) }) { Text("使用已上传图片") }
                TextButton(enabled = !busy, onClick = { value = value.copy(detailSteps = value.detailSteps.filterIndexed { i, _ -> i != index }) }) { Text("删除步骤") }
            }
        }
        OutlinedButton(enabled = !busy, onClick = { value = value.copy(detailSteps = value.detailSteps + ExperienceDetailStep()) }) { Text("添加体验步骤") }
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(enabled = !busy, onClick = onClose) { Text("返回") }
            OutlinedButton(enabled = !busy, onClick = { save(true) }) { Text("保存草稿") }
            Button(enabled = !busy, onClick = { save(false) }) { Text("提交审核") }
        }
        if (busy) CircularProgressIndicator()
    }
}

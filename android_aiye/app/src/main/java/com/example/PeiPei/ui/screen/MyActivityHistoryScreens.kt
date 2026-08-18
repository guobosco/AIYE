package com.example.Lulu.ui.screen

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.History
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.CenterAlignedTopAppBar
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavController
import coil.compose.AsyncImage
import com.example.Lulu.data.model.BookedServiceRecord
import com.example.Lulu.data.model.ViewedServiceRecord
import com.example.Lulu.data.repository.LuluRepository
import com.example.Lulu.ui.navigation.Screen
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlinx.coroutines.flow.flowOf

private val HistoryPageBg = Color.White
private val HistoryCardOutline = Color(0xFFEFEFEF)
private val HistoryTrack = Color(0xFFF2F2F2)
private val HistorySelectedBg = Color(0xFF232323)
private val HistoryMuted = Color(0xFF7A7A7A)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MyBookedServicesScreen(navController: NavController) {
    val repository = remember { runCatching { LuluRepository.get() }.getOrNull() }
    val recordsFlow = remember(repository) { repository?.bookedServices ?: flowOf(emptyList()) }
    val records by recordsFlow.collectAsState(initial = emptyList())
    var searchText by rememberSaveable { mutableStateOf("") }
    var upcomingOnly by rememberSaveable { mutableStateOf(true) }
    val todayStart = remember { todayStartMillis() }

    val filtered = remember(records, searchText, upcomingOnly, todayStart) {
        val keyword = searchText.trim()
        records.filter { record ->
            val matchKeyword = keyword.isEmpty() || listOf(
                record.title,
                record.location,
                record.category,
                record.creatorName,
            ).any { it.contains(keyword, ignoreCase = true) }
            val matchBucket = if (!upcomingOnly) {
                true
            } else {
                (record.scheduledAt ?: record.bookedAt) >= todayStart
            }
            matchKeyword && matchBucket
        }
    }

    Scaffold(
        containerColor = HistoryPageBg,
        topBar = {
            CenterAlignedTopAppBar(
                title = { Text("我预定的", fontSize = 17.sp, fontWeight = FontWeight.SemiBold) },
                navigationIcon = {
                    IconButton(onClick = { navController.popBackStack() }) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回")
                    }
                },
                colors = TopAppBarDefaults.centerAlignedTopAppBarColors(containerColor = HistoryPageBg),
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            HistorySearchBar(
                text = searchText,
                onTextChange = { searchText = it },
                placeholder = "搜索标题、地点或主理人",
            )
            HistorySegmentedRow(
                leftText = "待出行",
                rightText = "全部",
                leftSelected = upcomingOnly,
                onSelectLeft = { upcomingOnly = true },
                onSelectRight = { upcomingOnly = false },
            )
            if (filtered.isEmpty()) {
                HistoryEmptyState(
                    icon = Icons.Outlined.CalendarMonth,
                    title = "还没有预定记录",
                    subtitle = "去逛逛喜欢的服务，确认预订后会出现在这里",
                    modifier = Modifier.weight(1f),
                )
            } else {
                LazyColumn(
                    modifier = Modifier.weight(1f),
                    contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 8.dp, bottom = 28.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    items(filtered, key = { it.id }) { record ->
                        BookedServiceHistoryCard(
                            record = record,
                            onClick = {
                                navigateToHistoryTarget(
                                    navController = navController,
                                    detailId = record.serviceId,
                                    itemType = record.itemType,
                                    source = "my_booked",
                                )
                            }
                        )
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MyViewedServicesScreen(navController: NavController) {
    val repository = remember { runCatching { LuluRepository.get() }.getOrNull() }
    val recordsFlow = remember(repository) { repository?.viewedServices ?: flowOf(emptyList()) }
    val records by recordsFlow.collectAsState(initial = emptyList())
    var searchText by rememberSaveable { mutableStateOf("") }

    val filtered = remember(records, searchText) {
        val keyword = searchText.trim()
        records.filter { record ->
            keyword.isEmpty() || listOf(
                record.title,
                record.location,
                record.category,
                record.creatorName,
            ).any { it.contains(keyword, ignoreCase = true) }
        }
    }

    Scaffold(
        containerColor = HistoryPageBg,
        topBar = {
            CenterAlignedTopAppBar(
                title = { Text("我浏览的", fontSize = 17.sp, fontWeight = FontWeight.SemiBold) },
                navigationIcon = {
                    IconButton(onClick = { navController.popBackStack() }) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回")
                    }
                },
                colors = TopAppBarDefaults.centerAlignedTopAppBarColors(containerColor = HistoryPageBg),
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            HistorySearchBar(
                text = searchText,
                onTextChange = { searchText = it },
                placeholder = "搜索你看过的服务",
            )
            if (filtered.isEmpty()) {
                HistoryEmptyState(
                    icon = Icons.Outlined.History,
                    title = "还没有浏览记录",
                    subtitle = "点进服务详情看一看，这里会自动帮你记住",
                    modifier = Modifier.weight(1f),
                )
            } else {
                LazyColumn(
                    modifier = Modifier.weight(1f),
                    contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 8.dp, bottom = 28.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    items(filtered, key = { it.serviceId }) { record ->
                        ViewedServiceHistoryCard(
                            record = record,
                            onClick = {
                                navigateToHistoryTarget(
                                    navController = navController,
                                    detailId = record.serviceId,
                                    itemType = record.itemType,
                                    source = "my_viewed",
                                )
                            }
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun HistorySearchBar(
    text: String,
    onTextChange: (String) -> Unit,
    placeholder: String,
) {
    OutlinedTextField(
        value = text,
        onValueChange = onTextChange,
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 20.dp, vertical = 8.dp),
        placeholder = { Text(placeholder) },
        singleLine = true,
        leadingIcon = {
            Icon(Icons.Outlined.Search, contentDescription = null, tint = HistoryMuted)
        },
        shape = RoundedCornerShape(18.dp),
    )
}

@Composable
private fun HistorySegmentedRow(
    leftText: String,
    rightText: String,
    leftSelected: Boolean,
    onSelectLeft: () -> Unit,
    onSelectRight: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 20.dp, vertical = 4.dp)
            .clip(RoundedCornerShape(24.dp))
            .background(HistoryTrack)
            .padding(4.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        HistorySegmentChip(
            text = leftText,
            selected = leftSelected,
            onClick = onSelectLeft,
            modifier = Modifier.weight(1f),
        )
        HistorySegmentChip(
            text = rightText,
            selected = !leftSelected,
            onClick = onSelectRight,
            modifier = Modifier.weight(1f),
        )
    }
}

@Composable
private fun HistorySegmentChip(
    text: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier = modifier
            .clip(RoundedCornerShape(20.dp))
            .background(if (selected) HistorySelectedBg else Color.Transparent)
            .clickable(onClick = onClick)
            .padding(vertical = 10.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = text,
            color = if (selected) Color.White else Color(0xFF555555),
            fontSize = 15.sp,
            fontWeight = FontWeight.Medium,
        )
    }
}

@Composable
private fun ViewedServiceHistoryCard(
    record: ViewedServiceRecord,
    onClick: () -> Unit,
) {
    HistoryServiceCard(
        title = record.title.ifBlank { "未命名服务" },
        coverImageUrl = record.coverImageUrl,
        location = record.location,
        priceLine = buildPriceLine(record.priceText, record.priceBasisText),
        metaLine = "最近浏览 ${formatHistoryTime(record.viewedAt)}",
        creatorName = record.creatorName,
        tagText = record.category,
        onClick = onClick,
    )
}

@Composable
private fun BookedServiceHistoryCard(
    record: BookedServiceRecord,
    onClick: () -> Unit,
) {
    val scheduleLine = record.scheduledAt?.let {
        "预约时间 ${formatHistoryTime(it)}"
    } ?: "下单时间 ${formatHistoryTime(record.bookedAt)}"
    HistoryServiceCard(
        title = record.title.ifBlank { "未命名服务" },
        coverImageUrl = record.coverImageUrl,
        location = record.location,
        priceLine = buildPriceLine(record.priceText, record.priceBasisText),
        metaLine = scheduleLine,
        creatorName = record.creatorName,
        tagText = record.statusLabel,
        onClick = onClick,
    )
}

@Composable
private fun HistoryServiceCard(
    title: String,
    coverImageUrl: String,
    location: String,
    priceLine: String,
    metaLine: String,
    creatorName: String,
    tagText: String,
    onClick: () -> Unit,
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(18.dp),
        color = Color.White,
        border = androidx.compose.foundation.BorderStroke(1.dp, HistoryCardOutline),
        onClick = onClick,
    ) {
        Row(
            modifier = Modifier.padding(14.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.Top,
        ) {
            AsyncImage(
                model = coverImageUrl,
                contentDescription = title,
                modifier = Modifier
                    .size(width = 108.dp, height = 96.dp)
                    .clip(RoundedCornerShape(14.dp))
                    .background(Color(0xFFF4F4F4)),
                contentScale = ContentScale.Crop,
            )
            Column(modifier = Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        text = title,
                        modifier = Modifier.weight(1f),
                        fontSize = 16.sp,
                        fontWeight = FontWeight.SemiBold,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    HistoryTag(tagText)
                }
                Spacer(modifier = Modifier.height(8.dp))
                if (location.isNotBlank()) {
                    Text(
                        text = location,
                        fontSize = 13.sp,
                        color = HistoryMuted,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                if (priceLine.isNotBlank()) {
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text = priceLine,
                        fontSize = 14.sp,
                        color = Color(0xFF111111),
                        fontWeight = FontWeight.Medium,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = metaLine,
                    fontSize = 12.sp,
                    color = HistoryMuted,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                if (creatorName.isNotBlank()) {
                    Spacer(modifier = Modifier.height(2.dp))
                    Text(
                        text = "主理人 $creatorName",
                        fontSize = 12.sp,
                        color = HistoryMuted,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }
    }
}

@Composable
private fun HistoryTag(text: String) {
    Box(
        modifier = Modifier
            .clip(CircleShape)
            .background(Color(0xFFF6F2FF))
            .padding(horizontal = 10.dp, vertical = 5.dp)
    ) {
        Text(
            text = text.ifBlank { "记录" },
            fontSize = 11.sp,
            color = Color(0xFF6B4EFF),
            fontWeight = FontWeight.Medium,
        )
    }
}

@Composable
private fun HistoryEmptyState(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    title: String,
    subtitle: String,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier = modifier.fillMaxWidth(),
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(
                imageVector = icon,
                contentDescription = null,
                modifier = Modifier.size(88.dp),
                tint = Color(0xFFD4D4D4),
            )
            Spacer(modifier = Modifier.height(18.dp))
            Text(
                text = title,
                fontSize = 18.sp,
                fontWeight = FontWeight.SemiBold,
                color = Color(0xFF262626),
            )
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = subtitle,
                fontSize = 13.sp,
                color = HistoryMuted,
                modifier = Modifier.padding(horizontal = 32.dp),
            )
        }
    }
}

private fun buildPriceLine(priceText: String, priceBasisText: String): String {
    val segments = listOf(priceText, priceBasisText).filter { it.isNotBlank() }
    return segments.joinToString(" · ")
}

private fun formatHistoryTime(millis: Long): String {
    val formatter = SimpleDateFormat("M月d日 HH:mm", Locale.CHINA)
    return formatter.format(Date(millis))
}

private fun todayStartMillis(): Long {
    val now = System.currentTimeMillis()
    val formatter = SimpleDateFormat("yyyy-MM-dd", Locale.CHINA)
    return runCatching {
        formatter.parse(formatter.format(Date(now)))?.time ?: now
    }.getOrDefault(now)
}

private fun navigateToHistoryTarget(
    navController: NavController,
    detailId: String,
    itemType: String?,
    source: String,
) {
    val route = if (itemType == "experience") {
        Screen.ExperienceDetail.createRoute(detailId)
    } else {
        Screen.ServiceDetail.createRoute(detailId, from = source)
    }
    navController.navigate(route) {
        launchSingleTop = true
    }
}

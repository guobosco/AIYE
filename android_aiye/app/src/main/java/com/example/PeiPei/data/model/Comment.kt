// 文件说明：评论实体的数据模型。

package com.example.aiye.data.model

import java.util.Date

data class Comment(
    val id: String,
    val userId: String,
    val userName: String,
    val content: String,
    val timestamp: Date,
    val isEmoji: Boolean = false
)

package com.example.Lulu.data.model

data class ViewedServiceRecord(
    val serviceId: String,
    val itemType: String? = null,
    val title: String,
    val coverImageUrl: String,
    val location: String,
    val priceText: String,
    val priceBasisText: String,
    val creatorName: String,
    val category: String,
    val viewedAt: Long,
)

data class BookedServiceRecord(
    val id: String,
    val serviceId: String,
    val itemType: String? = null,
    val title: String,
    val coverImageUrl: String,
    val location: String,
    val priceText: String,
    val priceBasisText: String,
    val creatorName: String,
    val category: String,
    val bookedAt: Long,
    val scheduledAt: Long?,
    val statusLabel: String,
)

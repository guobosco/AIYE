// 文件说明：聊天消息表的 Room DAO，增删改查与 Flow 订阅。

package com.example.aiye.data.local.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction
import com.example.aiye.data.model.ChatMessage
import kotlinx.coroutines.flow.Flow

@Dao
interface ChatMessageDao {
    @Query("SELECT * FROM chat_messages WHERE conversationId = :conversationId AND currentUserId = :currentUserId ORDER BY createdAt ASC, id ASC")
    fun getMessages(conversationId: String, currentUserId: String): Flow<List<ChatMessage>>

    @Query("SELECT * FROM chat_messages WHERE id = :messageId AND currentUserId = :currentUserId LIMIT 1")
    suspend fun getMessageById(messageId: String, currentUserId: String): ChatMessage?

    @Query(
        "SELECT * FROM chat_messages " +
            "WHERE conversationId = :conversationId AND currentUserId = :currentUserId AND id NOT LIKE 'local-%' " +
            "ORDER BY createdAt DESC, id DESC LIMIT 1"
    )
    suspend fun getLatestMessageByConversation(
        conversationId: String,
        currentUserId: String
    ): ChatMessage?

    @Query(
        "SELECT * FROM chat_messages " +
            "WHERE conversationId = :conversationId AND currentUserId = :currentUserId " +
            "ORDER BY createdAt ASC, id ASC LIMIT 1"
    )
    suspend fun getFirstMessageByConversation(
        conversationId: String,
        currentUserId: String
    ): ChatMessage?

    @Query(
        "SELECT * FROM chat_messages " +
            "WHERE conversationId = :conversationId AND currentUserId = :currentUserId " +
            "AND id NOT LIKE 'local-%' AND isDeleted = 0 ORDER BY createdAt ASC, id ASC LIMIT 1"
    )
    suspend fun getOldestServerMessageByConversation(conversationId: String, currentUserId: String): ChatMessage?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertMessage(message: ChatMessage)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertMessages(messages: List<ChatMessage>)

    @Query("DELETE FROM chat_messages WHERE currentUserId = :userId AND clientMessageId = :clientId AND id LIKE 'local-%'")
    suspend fun deletePending(userId: String, clientId: String)

    @Query("SELECT COUNT(*) FROM chat_messages WHERE currentUserId = :userId AND clientMessageId = :clientId AND id NOT LIKE 'local-%'")
    suspend fun confirmedCount(userId: String, clientId: String): Int

    @Transaction
    suspend fun insertPendingIfUnconfirmed(message: ChatMessage) {
        val clientId = message.clientMessageId ?: return
        if (confirmedCount(message.currentUserId, clientId) == 0) insertMessage(message)
    }

    @Transaction
    suspend fun insertConfirmed(message: ChatMessage) {
        message.clientMessageId?.let { deletePending(message.currentUserId, it) }
        insertMessage(message)
    }

    @Transaction
    suspend fun insertConfirmedMessages(messages: List<ChatMessage>) {
        messages.forEach { insertConfirmed(it) }
    }

    @Query("DELETE FROM chat_messages WHERE conversationId = :conversationId AND currentUserId = :currentUserId")
    suspend fun deleteMessagesByConversation(conversationId: String, currentUserId: String)

    @Query("DELETE FROM chat_messages WHERE currentUserId = :currentUserId")
    suspend fun deleteByUser(currentUserId: String)

    @Query("DELETE FROM chat_messages")
    suspend fun deleteAll()
}

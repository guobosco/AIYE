package com.example.aiye.data.local.dao

import com.example.aiye.data.model.ChatMessage
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Test

class ChatMessageDaoTest {
    private val pending = ChatMessage(
        id = "local-request", conversationId = "thread", senderId = "owner",
        clientMessageId = "request", status = "sending", currentUserId = "owner"
    )

    @Test fun confirmationReplacesPending() = runBlocking {
        val dao = MemoryDao()
        dao.insertPendingIfUnconfirmed(pending)
        dao.insertConfirmed(pending.copy(id = "server", status = "sent"))
        assertEquals(listOf("server"), dao.rows.keys.toList())
    }

    @Test fun lateHttpFailureCannotResurrectConfirmedBubble() = runBlocking {
        val dao = MemoryDao()
        dao.insertConfirmed(pending.copy(id = "server", status = "sent"))
        dao.insertPendingIfUnconfirmed(pending.copy(status = "failed"))
        assertEquals(listOf("server"), dao.rows.keys.toList())
    }

    @Test fun unconfirmedFailureRemainsRetryableWithSameId() = runBlocking {
        val dao = MemoryDao()
        dao.insertPendingIfUnconfirmed(pending.copy(status = "failed"))
        dao.insertPendingIfUnconfirmed(pending)
        assertEquals(1, dao.rows.size)
        assertEquals("request", dao.rows.values.single().clientMessageId)
        assertEquals("sending", dao.rows.values.single().status)
    }

    @Test fun confirmationDoesNotRemoveAnotherAccountsPending() = runBlocking {
        val dao = MemoryDao()
        dao.insertPendingIfUnconfirmed(pending)
        dao.insertConfirmed(pending.copy(id = "other-server", currentUserId = "other"))
        assertEquals(2, dao.rows.size)
    }

    private class MemoryDao : ChatMessageDao {
        val rows = linkedMapOf<String, ChatMessage>()
        override suspend fun insertMessage(message: ChatMessage) { rows[message.id] = message }
        override suspend fun insertMessages(messages: List<ChatMessage>) { messages.forEach { insertMessage(it) } }
        override suspend fun confirmedCount(userId: String, clientId: String) = rows.values.count {
            it.currentUserId == userId && it.clientMessageId == clientId && !it.id.startsWith("local-")
        }
        override suspend fun deletePending(userId: String, clientId: String) {
            rows.entries.removeAll { (_, value) ->
                value.currentUserId == userId && value.clientMessageId == clientId && value.id.startsWith("local-")
            }
        }
        override fun getMessages(conversationId: String, currentUserId: String): Flow<List<ChatMessage>> = flowOf(
            rows.values.filter { it.conversationId == conversationId && it.currentUserId == currentUserId }
        )
        override suspend fun getMessageById(messageId: String, currentUserId: String) =
            rows[messageId]?.takeIf { it.currentUserId == currentUserId }
        override suspend fun getLatestMessageByConversation(conversationId: String, currentUserId: String) = null
        override suspend fun getFirstMessageByConversation(conversationId: String, currentUserId: String) = null
        override suspend fun getOldestServerMessageByConversation(conversationId: String, currentUserId: String) = null
        override suspend fun deleteMessagesByConversation(conversationId: String, currentUserId: String) {
            rows.entries.removeAll { it.value.conversationId == conversationId && it.value.currentUserId == currentUserId }
        }
        override suspend fun deleteByUser(currentUserId: String) {
            rows.entries.removeAll { it.value.currentUserId == currentUserId }
        }
        override suspend fun deleteAll() { rows.clear() }
    }
}

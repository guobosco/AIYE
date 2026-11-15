// 文件说明：Retrofit 接口声明，定义与后端 REST API 的契约。

package com.example.aiye.data.remote

/**
 * 远程接口契约文件。
 * 集中定义用户、好友、聊天、服务等后端 API 请求与响应模型。
 */

import com.example.aiye.data.model.User
import com.example.aiye.data.model.ChatMessage
import com.example.aiye.data.model.ChatMessageCreateRequest
import com.example.aiye.data.model.ChatReadRequest
import com.example.aiye.data.model.ChatUploadResponse
import com.example.aiye.data.model.ConversationListItem
import com.example.aiye.data.model.CreateDirectConversationResponse
import com.example.aiye.data.model.Experience
import com.example.aiye.data.model.Service
import retrofit2.http.*
import okhttp3.MultipartBody

import com.google.gson.annotations.SerializedName

data class ConsultationInquiry(
    val id: String, val title: String, val kind: String, val status: String, val version: Int,
    @SerializedName("user_id") val userId: String,
    @SerializedName("host_id") val hostId: String,
    @SerializedName("conversation_id") val conversationId: String,
    val details: Map<String, Any> = emptyMap()
)
data class ConsultationNotice(
    val id: String, val title: String,
    @SerializedName("conversation_id") val conversationId: String,
    @SerializedName("is_read") val isRead: Boolean
)
data class LoginSession(
    val id: String,
    @SerializedName("created_at") val createdAt: Long,
    @SerializedName("expires_at") val expiresAt: Long,
    @SerializedName("is_current") val isCurrent: Boolean
)
data class BlockedAccount(@SerializedName("peer_id") val peerId: String)
data class ConsultationFeedback(val id: String, val category: String, val status: String,
                                @SerializedName("admin_note") val adminNote: String)
data class ReminderSettings(val enabled: Boolean, @SerializedName("remote_push_enabled") val remotePushEnabled: Boolean)
data class CatalogSearchItem(val id: String, val kind: String, val title: String, val location: String,
                             @SerializedName("host_id") val hostId: String)

data class UploadResponse(
    val url: String
)

data class TokenResponse(
    @SerializedName("access_token") val accessToken: String,
    @SerializedName("token_type") val tokenType: String,
    @SerializedName("refresh_token") val refreshToken: String? = null
)

data class AuthSessionResponse(
    @SerializedName("access_token") val accessToken: String,
    @SerializedName("token_type") val tokenType: String,
    val user: User,
    @SerializedName("need_bind_phone") val needBindPhone: Boolean,
    @SerializedName("is_new_user") val isNewUser: Boolean,
    @SerializedName("refresh_token") val refreshToken: String? = null
)

data class PhoneLoginRequest(
    @SerializedName("phone_number") val phoneNumber: String,
    @SerializedName("verify_code") val verifyCode: String
)

data class WeChatMobileLoginRequest(
    val code: String,
    val state: String,
    val platform: String,
    @SerializedName("device_id") val deviceId: String? = null,
    @SerializedName("app_version") val appVersion: String? = null
)

data class PhoneSendCodeRequest(
    @SerializedName("phone_number") val phoneNumber: String,
    val scene: String = "bind_wechat_phone"
)

data class PhoneSendCodeResponse(
    val success: Boolean,
    @SerializedName("cooldown_seconds") val cooldownSeconds: Int,
    @SerializedName("trace_id") val traceId: String,
    @SerializedName("debug_code") val debugCode: String? = null
)

data class WeChatBindPhoneRequest(
    @SerializedName("phone_number") val phoneNumber: String,
    @SerializedName("verify_code") val verifyCode: String
)

data class FavoriteServicesPayload(
    @SerializedName("service_ids") val serviceIds: List<String>
)

data class FavoriteExperiencesPayload(
    @SerializedName("experience_ids") val experienceIds: List<String>
)

data class CalendarDayPayload(
    val allDay: Boolean = true,
    val start: String = "00:00",
    val end: String = "23:59",
    val version: Int = 0,
    val active: Boolean = true
)

data class CalendarPayload(val days: Map<String, CalendarDayPayload> = emptyMap())

data class WishlistGroupPayload(
    val name: String,
    @SerializedName("service_ids") val serviceIds: List<String>
)

data class WishlistProfilePayload(
    @SerializedName("service_ids") val serviceIds: List<String>,
    val groups: List<WishlistGroupPayload>
)

data class RegisterRequest(
    val id: String,
    val password: String,
    @SerializedName("verify_code") val verifyCode: String = "",
    @SerializedName("phone_number") val phoneNumber: String,
    val name: String = "",
    @SerializedName("pei_pei_id") val peiPeiId: String = "",
    @SerializedName("photo_url") val photoUrl: String = "",
    @SerializedName("is_profile_completed") val isProfileCompleted: Boolean = false,
    @SerializedName("created_at") val createdAt: Long = System.currentTimeMillis(),
    @SerializedName("updated_at") val updatedAt: Long = System.currentTimeMillis()
)

interface ApiService {
    @GET("me/wishlist/experiences")
    suspend fun getMyFavoriteExperiences(): FavoriteExperiencesPayload

    @PUT("me/wishlist/experiences")
    suspend fun updateMyFavoriteExperiences(@Body body: FavoriteExperiencesPayload): FavoriteExperiencesPayload

    @GET("services/{id}/calendar")
    suspend fun getCalendar(@Path("id") id: String): CalendarPayload

    @PUT("services/{id}/calendar/{day}")
    suspend fun saveCalendarDay(@Path("id") id: String, @Path("day") day: String, @Body body: CalendarDayPayload): CalendarDayPayload

    @DELETE("services/{id}/record")
    suspend fun hideServiceRecord(@Path("id") id: String): Map<String, Boolean>

    @DELETE("experiences/{id}/record")
    suspend fun hideExperienceRecord(@Path("id") id: String): Map<String, Boolean>

    @POST("experiences/")
    suspend fun createExperience(@Body experience: Experience): Experience

    @PUT("experiences/{id}")
    suspend fun updateExperience(@Path("id") id: String, @Body experience: Experience): Experience

    @GET("experiences/")
    suspend fun getMyExperiences(@Query("skip") skip: Int = 0, @Query("limit") limit: Int = 100): List<Experience>

    @DELETE("experiences/{id}")
    suspend fun deleteExperience(@Path("id") id: String): Experience

    @POST("auth/phone/login")
    suspend fun loginWithPhoneCode(@Body request: PhoneLoginRequest): AuthSessionResponse

    @POST("auth/logout")
    suspend fun logoutSession(): Map<String, Boolean>

    // User endpoints
    @Multipart
    @POST("upload/avatar")
    suspend fun uploadAvatar(
        @Part file: MultipartBody.Part,
        @Part("user_id") userId: okhttp3.RequestBody? = null
    ): UploadResponse

    @POST("users/register")
    suspend fun registerUser(@Body request: RegisterRequest): User

    @POST("auth/wechat/mobile/login")
    suspend fun loginWithWeChat(@Body request: WeChatMobileLoginRequest): AuthSessionResponse

    @POST("auth/phone/send-code")
    suspend fun sendPhoneCode(@Body request: PhoneSendCodeRequest): PhoneSendCodeResponse

    @POST("auth/wechat/bind-phone")
    suspend fun bindWeChatPhone(@Body request: WeChatBindPhoneRequest): User

    @FormUrlEncoded
    @POST("auth/token")
    suspend fun loginForAccessToken(
        @Field("username") username: String,
        @Field("password") password: String
    ): TokenResponse

    @GET("auth/me")
    suspend fun getCurrentUserProfile(): User

    @GET("me/wishlist/services")
    suspend fun getMyFavoriteServices(): FavoriteServicesPayload

    @PUT("me/wishlist/services")
    suspend fun updateMyFavoriteServices(@Body body: FavoriteServicesPayload): FavoriteServicesPayload

    @GET("me/wishlist/profile")
    suspend fun getMyWishlistProfile(): WishlistProfilePayload

    @PUT("me/wishlist/profile")
    suspend fun updateMyWishlistProfile(@Body body: WishlistProfilePayload): WishlistProfilePayload

    @PUT("users/{userId}")
    suspend fun updateUser(@Path("userId") userId: String, @Body user: User): User

    @GET("users/{userId}")
    suspend fun getUser(@Path("userId") userId: String): User

    @GET("users/search")
    suspend fun searchUser(@Query("query") query: String): User

    @POST("users/match_contacts")
    suspend fun matchContacts(@Body request: Map<String, List<String>>): List<User>

    @GET("users/discovery")
    suspend fun getDiscoveryUsers(
        @Query("limit") limit: Int = 20
    ): List<User>

    @Multipart
    @POST("service/upload")
    suspend fun uploadServiceFile(
        @Part file: MultipartBody.Part
    ): ChatUploadResponse

    @Multipart
    @POST("chat/upload")
    suspend fun uploadChatFile(
        @Part file: MultipartBody.Part
    ): ChatUploadResponse

    @POST("chat/conversations/direct/{peerId}")
    suspend fun createDirectConversation(@Path("peerId") peerId: String): CreateDirectConversationResponse

    @GET("chat/conversations")
    suspend fun getChatConversations(
        @Query("skip") skip: Int = 0,
        @Query("limit") limit: Int = 100
    ): List<ConversationListItem>

    @GET("chat/conversations/{conversationId}/messages")
    suspend fun getChatMessages(
        @Path("conversationId") conversationId: String,
        @Query("limit") limit: Int = 100,
        @Query("before") before: Long? = null,
        @Query("before_id") beforeId: String? = null
    ): List<ChatMessage>

    @POST("chat/conversations/{conversationId}/messages")
    suspend fun sendChatMessage(
        @Path("conversationId") conversationId: String,
        @Body body: ChatMessageCreateRequest
    ): ChatMessage

    @POST("chat/conversations/{conversationId}/read")
    suspend fun markConversationRead(
        @Path("conversationId") conversationId: String,
        @Body body: ChatReadRequest = ChatReadRequest()
    ): com.example.aiye.data.model.ChatConversationMember

    // Service endpoints
    @POST("services/")
    suspend fun createService(@Body service: Service): Service

    @PUT("services/{id}")
    suspend fun updateService(@Path("id") id: String, @Body service: Service): Service

    @GET("services/")
    suspend fun getMyServices(
        @Query("skip") skip: Int = 0,
        @Query("limit") limit: Int = 100
    ): List<Service>

    /** 广场发现：全站未删除服务（与后端 /services/discovery 一致） */
    @GET("services/discovery")
    suspend fun getDiscoveryServices(
        @Query("skip") skip: Int = 0,
        @Query("limit") limit: Int = 200,
        @Query("updated_after") updatedAfter: Long? = null
    ): List<Service>

    @GET("services/{id}")
    suspend fun getServiceById(@Path("id") id: String): Service

    @DELETE("services/{id}")
    suspend fun deleteService(@Path("id") id: String): Service

    @GET("experiences/discovery")
    suspend fun getDiscoveryExperiences(
        @Query("skip") skip: Int = 0,
        @Query("limit") limit: Int = 200,
        @Query("updated_after") updatedAfter: Long? = null
    ): List<Experience>

    @GET("me/inquiries")
    suspend fun getInquiries(@Query("skip") skip: Int = 0, @Query("limit") limit: Int = 100): List<ConsultationInquiry>
    @PUT("me/inquiries/{id}")
    suspend fun updateInquiry(@Path("id") id: String, @Body value: Map<String, @JvmSuppressWildcards Any>): ConsultationInquiry
    @GET("me/notices")
    suspend fun getNotices(@Query("skip") skip: Int = 0, @Query("limit") limit: Int = 100): List<ConsultationNotice>
    @GET("me/feedbacks")
    suspend fun getConsultationFeedback(@Query("skip") skip: Int = 0, @Query("limit") limit: Int = 100): List<ConsultationFeedback>
    @POST("me/notices/{id}/read")
    suspend fun readNotice(@Path("id") id: String): Map<String, Boolean>
    @GET("auth/sessions")
    suspend fun getLoginSessions(): List<LoginSession>
    @DELETE("auth/sessions/{id}")
    suspend fun revokeLoginSession(@Path("id") id: String): Map<String, Boolean>
    @GET("me/blocks")
    suspend fun getBlockedAccounts(): List<BlockedAccount>
    @PUT("me/blocks/{id}")
    suspend fun blockAccount(@Path("id") id: String): Map<String, Boolean>
    @DELETE("me/blocks/{id}")
    suspend fun unblockAccount(@Path("id") id: String): Map<String, Boolean>
    @POST("reports")
    suspend fun submitReport(@Body value: Map<String, String>): Map<String, @JvmSuppressWildcards Any>
    @GET("me/reminders")
    suspend fun getReminders(): ReminderSettings
    @PUT("me/reminders")
    suspend fun updateReminders(@Body value: Map<String, Boolean>): ReminderSettings
    @POST("auth/phone/change")
    suspend fun changePhone(@Body value: Map<String, String>): User
    @POST("auth/account/close")
    suspend fun closeAccount(@Body value: Map<String, String>): Map<String, Boolean>
    @GET("catalog/search")
    suspend fun searchCatalog(@Query("kind") kind: String, @Query("q") q: String,
                             @Query("city") city: String, @Query("category") category: String,
                             @Query("skip") skip: Int = 0): List<CatalogSearchItem>

    @GET("experiences/{id}")
    suspend fun getExperienceById(@Path("id") id: String): Experience

}

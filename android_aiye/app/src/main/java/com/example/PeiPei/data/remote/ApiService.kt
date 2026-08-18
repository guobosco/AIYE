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

data class UploadResponse(
    val url: String
)

data class TokenResponse(
    @SerializedName("access_token") val accessToken: String,
    @SerializedName("token_type") val tokenType: String
)

data class AuthSessionResponse(
    @SerializedName("access_token") val accessToken: String,
    @SerializedName("token_type") val tokenType: String,
    val user: User,
    @SerializedName("need_bind_phone") val needBindPhone: Boolean,
    @SerializedName("is_new_user") val isNewUser: Boolean
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
    @SerializedName("phone_number") val phoneNumber: String,
    val name: String = "",
    @SerializedName("pei_pei_id") val peiPeiId: String = "",
    @SerializedName("photo_url") val photoUrl: String = "",
    @SerializedName("is_profile_completed") val isProfileCompleted: Boolean = false,
    @SerializedName("created_at") val createdAt: Long = System.currentTimeMillis(),
    @SerializedName("updated_at") val updatedAt: Long = System.currentTimeMillis()
)

interface ApiService {
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
    suspend fun getChatConversations(): List<ConversationListItem>

    @GET("chat/conversations/{conversationId}/messages")
    suspend fun getChatMessages(
        @Path("conversationId") conversationId: String,
        @Query("limit") limit: Int = 100,
        @Query("before") before: Long? = null
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

    @GET("experiences/{id}")
    suspend fun getExperienceById(@Path("id") id: String): Experience

}

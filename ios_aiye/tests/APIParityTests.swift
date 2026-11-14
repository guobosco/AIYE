import Combine
import Foundation

final class MemoryTokenStore: TokenStore, @unchecked Sendable {
    private let lock = NSLock()
    private var token: String?
    private var refresh: String?
    func readAccessToken() -> String? {
        lock.lock()
        defer { lock.unlock() }
        return token
    }
    func writeAccessToken(_ token: String) throws {
        lock.lock()
        defer { lock.unlock() }
        self.token = token
    }
    func deleteAccessToken() throws {
        lock.lock()
        defer { lock.unlock() }
        token = nil
    }
    func readRefreshToken() -> String? {
        lock.lock()
        defer { lock.unlock() }
        return refresh
    }
    func writeRefreshToken(_ token: String) throws {
        lock.lock()
        defer { lock.unlock() }
        refresh = token
    }
    func deleteRefreshToken() throws {
        lock.lock()
        defer { lock.unlock() }
        refresh = nil
    }
}

@main
struct APIParityTests {
    static func check(_ condition: Bool, _ label: String) throws {
        guard condition else {
            throw NSError(domain: "APIParityTests", code: 1, userInfo: [NSLocalizedDescriptionKey: label])
        }
        print("PASS: \(label)")
    }

    @MainActor
    static func checkLocalSignOut() throws {
        let suite = "aiye-logout-tests-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let tokens = MemoryTokenStore()
        let users = UserDefaultsCurrentUserStore(defaults: defaults)
        let appSession = AppSession(tokenStore: tokens, currentUserStore: users, defaults: defaults)
        try tokens.writeRefreshToken("local-refresh")
        try appSession.completeWeChatSignIn(
            accessToken: "local-access", userId: "local-user", requiresPhoneBinding: true
        )
        var changes = 0
        let subscription = appSession.objectWillChange.sink { changes += 1 }
        appSession.signOut()
        try check(!appSession.isAuthenticated && appSession.currentUserId == nil &&
                  !appSession.requiresPhoneBinding && tokens.readAccessToken() == nil &&
                  tokens.readRefreshToken() == nil && users.readCurrentUserId() == nil && changes > 0,
                  "local logout immediately clears credentials, user, binding state and publishes changes")
        try appSession.signIn(accessToken: "new-local-access")
        try check(appSession.isAuthenticated, "sign in works again after local logout")
        subscription.cancel()
        appSession.signOut()
    }

    static func main() async throws {
        try await checkLocalSignOut()
        // Never write test accounts or uploads to the user's normal backend.
        let baseURL = URL(string: "http://127.0.0.1:18000")!
        let prefixedBase = URL(string: "http://127.0.0.1:18000/api/v1/")!
        try check(AppMediaURL.resolve(" static/avatars/test.png ", baseURL: prefixedBase)?.absoluteString ==
                  "http://127.0.0.1:18000/static/avatars/test.png", "relative media ignores an API path prefix")
        try check(AppMediaURL.resolve("/static/test.png?version=2", baseURL: prefixedBase)?.absoluteString ==
                  "http://127.0.0.1:18000/static/test.png?version=2", "root-relative media preserves query parameters")
        try check(AppMediaURL.resolve("https://cdn.example.com/test.png", baseURL: prefixedBase)?.absoluteString ==
                  "https://cdn.example.com/test.png", "external image origins remain unchanged")
        try check(AppMediaURL.resolve(" \n ", baseURL: baseURL) == nil &&
                  AppMediaURL.resolve("javascript:alert(1)", baseURL: baseURL) == nil, "empty and unsupported media URLs are rejected")
        let tokenStore = MemoryTokenStore()
        let configuration = URLSessionConfiguration.ephemeral
        configuration.connectionProxyDictionary = [:]
        let session = URLSession(configuration: configuration)
        let api = APIClient(baseURL: baseURL, tokenStore: tokenStore, session: session)
        let phone = "199\(Int.random(in: 10000000...99999999))"
        let password = "parity+&=2026"
        let registration = try await api.sendPhoneCode(phoneNumber: phone, scene: "register")
        guard let code = registration.debugCode else {
            fatalError("This test requires an isolated server with debug phone codes enabled")
        }
        var user = try await api.register(phoneNumber: phone, password: password, verifyCode: code)
        let token = try await api.authToken(username: phone, password: password)
        try check(tokenStore.readRefreshToken() == token.refreshToken && token.refreshToken != nil, "refresh token is persisted")
        try tokenStore.writeAccessToken(token.accessToken)
        let me = try await api.getMe()
        try check(me.id == user.id, "register and sign in with special-character password")
        try tokenStore.writeAccessToken("expired-access-token")
        let refreshedMe = try await api.getMe()
        try check(refreshedMe.id == user.id && tokenStore.readRefreshToken() != token.refreshToken, "401 automatically refreshes and retries once")
        let refreshBeforeConcurrentRequests = tokenStore.readRefreshToken()
        try tokenStore.writeAccessToken("expired-concurrent-access-token")
        let concurrentIDs = try await withThrowingTaskGroup(of: String.self) { group in
            for _ in 0..<6 {
                group.addTask { try await api.getMe().id }
            }
            var ids: [String] = []
            for try await id in group { ids.append(id) }
            return ids
        }
        try check(concurrentIDs.count == 6 && concurrentIDs.allSatisfy { $0 == user.id } &&
                  tokenStore.readRefreshToken() != refreshBeforeConcurrentRequests,
                  "concurrent 401 responses share one refresh and retain the session")
        let binding = try await api.sendPhoneCode(phoneNumber: phone, scene: "bind_wechat_phone")
        guard let bindingCode = binding.debugCode else { fatalError("Missing isolated binding code") }
        let bound = try await api.bindWeChatPhone(phoneNumber: phone, verifyCode: bindingCode)
        try check(bound.isPhoneVerified == true, "binding code request carries authenticated session")
        let loginCodeResponse = try await api.sendPhoneCode(phoneNumber: phone, scene: "login")
        guard let loginCode = loginCodeResponse.debugCode else { fatalError("Missing isolated login code") }
        let smsLogin = try await api.phoneCodeLogin(phoneNumber: phone, verifyCode: loginCode)
        try check(smsLogin.user.id == user.id && smsLogin.user.isPhoneVerified == true &&
                  tokenStore.readRefreshToken() == smsLogin.refreshToken, "SMS login restores the verified account and refresh credentials")
        let credentialsBeforeReplay = tokenStore.readAccessToken()
        do {
            _ = try await api.phoneCodeLogin(phoneNumber: phone, verifyCode: loginCode)
            throw NSError(domain: "APIParityTests", code: 1, userInfo: [NSLocalizedDescriptionKey: "used SMS code was accepted"])
        } catch let error as APIError {
            guard case .server(let status, _) = error else { throw error }
            try check(status == 400 && tokenStore.readAccessToken() == credentialsBeforeReplay,
                      "SMS code replay is rejected without clearing a valid session")
        }
        user.name = "Parity test user"
        user.weightKg = 65.5
        user.middleSchoolFavoriteSong = "Test song"
        let updatedUser = try await api.updateUser(user)
        try check(updatedUser.name == user.name, "profile update persists remotely")
        try check(updatedUser.weightKg == 65.5 && updatedUser.middleSchoolFavoriteSong == "Test song", "fractional weight and extended profile fields")

        let png = Data(base64Encoded: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=")!
        let upload = try await api.uploadMedia(data: png, filename: "parity.png", mimeType: "image/png", business: "service")
        let (imageData, imageResponse) = try await session.data(from: URL(string: upload.url, relativeTo: baseURL)!)
        try check((imageResponse as? HTTPURLResponse)?.statusCode == 200 && imageData == png, "multipart upload and media retrieval")
        let avatar = try await api.uploadMedia(data: png, filename: "avatar.png", mimeType: "image/png", business: "avatar")
        user.photoUrl = avatar.url
        user.profileImageUrls = [avatar.url]
        let savedAvatar = try await api.updateUser(user)
        try check(savedAvatar.photoUrl == avatar.url && savedAvatar.profileImageUrls == [avatar.url], "avatar and photo wall update")

        let now = Int64(Date().timeIntervalSince1970 * 1000)
        var service = ServiceDTO(
            id: UUID().uuidString.lowercased(), creatorId: user.id,
            title: "Parity service", description: "Integration test",
            coverImageUrl: upload.url, imageUrls: [upload.url], location: "海南省三亚市",
            priceText: "99", priceBasisText: "每次", prepaymentPercent: 30,
            fullRefundCancelLeadDays: 1, category: "摄影摄像", serviceMode: "线下",
            serviceTime: 60, bookingTimeRangesJson: "", bookingLeadHours: 0,
            bookingFutureOpenDays: 30, autoAcceptAfterPayment: true, syncToSquare: false,
            participantIds: [user.id], serviceFeatureTags: [], serviceDeclarationsExtra: [],
            creator: user.name ?? "", isImportant: false, isDeleted: false, isDraft: true,
            isSynced: true, createdAt: now, updatedAt: now,
            serviceExtraFeeTags: ["交通费"]
        )
        service = try await api.saveService(service, creating: true)
        try check(service.isDraft == true && service.reviewStatus == "draft", "draft persists remotely without publishing")
        service.isDraft = false
        service = try await api.saveService(service, creating: false)
        try check(service.reviewStatus == "pending_review", "published service enters review")
        let discovery = try await api.discoverServices(limit: 200)
        try check(!discovery.contains { $0.id == service.id }, "pending service is absent from discovery")
        let owned = try await api.myServices()
        try check(owned.contains { $0.id == service.id }, "owner list includes pending service")
        try tokenStore.deleteAccessToken()
        do {
            _ = try await api.getService(serviceId: service.id)
            throw NSError(domain: "APIParityTests", code: 1, userInfo: [NSLocalizedDescriptionKey: "anonymous access was accepted"])
        } catch let error as APIError {
            guard case .server(let status, _) = error else { throw error }
            try check(status == 404, "pending service is not anonymously accessible")
        }
        try tokenStore.writeAccessToken(token.accessToken)
        service.title = "Updated parity service"
        service = try await api.saveService(service, creating: false)
        try check(service.title == "Updated parity service" && service.serviceExtraFeeTags == ["交通费"], "edit and extended fields persist")
        let deleted = try await api.deleteService(serviceId: service.id)
        try check(deleted.isDeleted == true, "cancel service remotely")
        service.isDeleted = false
        service = try await api.saveService(service, creating: false)
        try check(service.isDeleted == false && service.reviewStatus == "pending_review", "republish cancelled service returns to review")

        let peerPhone = "198\(Int.random(in: 10000000...99999999))"
        let peerRegistration = try await api.sendPhoneCode(phoneNumber: peerPhone, scene: "register")
        guard let peerCode = peerRegistration.debugCode else {
            fatalError("Missing isolated registration code")
        }
        let peer = try await api.register(phoneNumber: peerPhone, password: password, verifyCode: peerCode)
        service.participantIds = [user.id, peer.id]
        service = try await api.saveService(service, creating: false)
        let reloadedService = try await api.getService(serviceId: service.id)
        try check(reloadedService.participantIds == [user.id, peer.id], "service participants persist and reload")
        let groupSuite = "aiye.parity.groups.\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: groupSuite) else { fatalError("Cannot create isolated group preferences") }
        defer { defaults.removePersistentDomain(forName: groupSuite) }
        let groupData = ContactGroupData(groups: ["朋友": [peer.id]], contacts: [peer])
        try groupData.save(userID: user.id, defaults: defaults)
        let restoredGroup = ContactGroupData.load(userID: user.id, defaults: defaults)
        try check(restoredGroup.groups["朋友"] == [peer.id] && restoredGroup.contacts.first?.id == peer.id,
                  "contact groups preserve membership and cached profiles")
        try check(ContactGroupData.load(userID: peer.id, defaults: defaults).groups.isEmpty,
                  "contact group preferences are isolated per account")
        let conversation = try await api.createDirectConversation(peerId: peer.id)
        let conversations = try await api.getChatConversations()
        try check(conversations.contains { $0.id == conversation.id }, "paginated conversation list decodes")
        let chatUpload = try await api.uploadMedia(data: png, filename: "chat.png", mimeType: "image/png", business: "chat")
        let message = try await api.sendChatMessage(
            conversationId: conversation.id, content: "[图片]", type: "image",
            attachmentUrl: chatUpload.url, attachmentName: "chat.png",
            attachmentSize: png.count, objectKey: chatUpload.objectKey ?? "",
            extra: ["mime_type": "image/png"], clientMessageId: UUID().uuidString
        )
        try check(message.type == "image" && message.attachmentUrl == chatUpload.url, "image chat message")
        let location = try await api.sendChatMessage(
            conversationId: conversation.id, content: "三亚", type: "location",
            extra: ["latitude": "18.25", "longitude": "109.51", "name": "三亚", "address": "海南省三亚市"]
        )
        try check(location.extra?["latitude"] == "18.25", "location chat payload")
        try check(location.clientMessageId?.isEmpty == false, "message API supplies a default request ID")
        let retriedLocation = try await api.sendChatMessage(
            conversationId: conversation.id, content: "三亚", type: "location",
            extra: ["latitude": "18.25", "longitude": "109.51", "name": "三亚", "address": "海南省三亚市"],
            clientMessageId: location.clientMessageId
        )
        try check(retriedLocation.id == location.id, "message retry returns the original server message")
        let card = try await api.sendChatMessage(
            conversationId: conversation.id, content: service.title, type: "service_card",
            extra: ["service_id": service.id, "title": service.title, "cover_image": upload.url, "item_type": "service"]
        )
        try check(card.extra?["service_id"] == service.id, "service card chat payload")
        let encodedLocation = "海南省三亚市|||PEIPEI_GEO1|||{\"points\":[[18.25,109.51],[18.26,109.51],[18.26,109.52]]}"
        service.location = encodedLocation
        service = try await api.saveService(service, creating: false)
        try check(service.location == encodedLocation && service.displayLocation == "海南省三亚市", "Android-compatible polygon payload and display label")
        let messages = try await api.getChatMessages(conversationId: conversation.id)
        try check(messages.contains { $0.id == message.id } && messages.contains { $0.id == card.id }, "chat history retrieval")
        _ = try await api.markConversationRead(conversationId: conversation.id, messageId: card.id)

        let peerToken = try await api.authToken(username: peerPhone, password: password)
        try tokenStore.writeAccessToken(peerToken.accessToken)
        do {
            _ = try await api.saveService(service, creating: false)
            throw NSError(domain: "APIParityTests", code: 1, userInfo: [NSLocalizedDescriptionKey: "non-owner edit was accepted"])
        } catch let error as APIError {
            guard case .server(let status, _) = error else { throw error }
            try check(status == 403, "non-owner edit is rejected")
        }
        let accessBeforeRevocation = tokenStore.readAccessToken()
        let refreshBeforeRevocation = tokenStore.readRefreshToken()
        try await api.logout()
        do {
            _ = try await api.getMe()
            throw NSError(domain: "APIParityTests", code: 1, userInfo: [NSLocalizedDescriptionKey: "revoked session was accepted"])
        } catch let error as APIError {
            guard case .server(let status, _) = error else { throw error }
            try check(status == 401 && tokenStore.readAccessToken() == nil && tokenStore.readRefreshToken() == nil, "logout revokes session and clears expired credentials")
        }
        try tokenStore.writeAccessToken(accessBeforeRevocation ?? "")
        try tokenStore.writeRefreshToken(refreshBeforeRevocation ?? "")
        do {
            _ = try await api.getMe()
            throw NSError(domain: "APIParityTests", code: 1, userInfo: [NSLocalizedDescriptionKey: "restored revoked credentials were accepted"])
        } catch let error as APIError {
            guard case .server(let status, _) = error else { throw error }
            try check(status == 401 && tokenStore.readRefreshToken() == nil,
                      "revoked credentials remain rejected after local restoration")
        }
        let logoutToken = try await api.authToken(username: peerPhone, password: password)
        try tokenStore.deleteAccessToken()
        try tokenStore.deleteRefreshToken()
        try await api.logout(accessToken: logoutToken.accessToken)
        try check(tokenStore.readAccessToken() == nil && tokenStore.readRefreshToken() == nil,
                  "remote logout works after immediate local credential removal")
        let newLogin = try await api.authToken(username: peerPhone, password: password)
        do {
            try await api.logout(accessToken: logoutToken.accessToken)
            throw NSError(domain: "APIParityTests", code: 1, userInfo: [NSLocalizedDescriptionKey: "revoked logout token was accepted"])
        } catch let error as APIError {
            guard case .server(let status, _) = error else { throw error }
            try check(status == 401 && tokenStore.readAccessToken() == newLogin.accessToken &&
                      tokenStore.readRefreshToken() == newLogin.refreshToken,
                      "late logout failure neither refreshes nor clears a new login")
        }
        let stillLoggedIn = try await api.getMe()
        try check(stillLoggedIn.id == peer.id, "new login remains usable after an old logout fails")
        try await api.logout()
        print("All iOS API parity tests passed.")
    }
}

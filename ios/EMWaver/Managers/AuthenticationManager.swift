import Foundation

@MainActor
final class AuthenticationManager: ObservableObject {
    @Published private(set) var isAuthenticated: Bool
    @Published private(set) var accessToken: String?
    @Published private(set) var refreshToken: String?
    @Published private(set) var userJSON: String?
    @Published private(set) var entitlementJSON: String?

    private let backendClient: BackendClient
    private let defaults: UserDefaults

    private let accessTokenKey = "auth.access_token"
    private let refreshTokenKey = "auth.refresh_token"
    private let userJSONKey = "auth.user_json"
    private let entitlementJSONKey = "auth.entitlement_json"

    init(backendClient: BackendClient = .shared, defaults: UserDefaults = .standard) {
        self.backendClient = backendClient
        self.defaults = defaults

        let storedAccessToken = defaults.string(forKey: accessTokenKey)
        let storedRefreshToken = defaults.string(forKey: refreshTokenKey)
        let storedUserJSON = defaults.string(forKey: userJSONKey)
        let storedEntitlementJSON = defaults.string(forKey: entitlementJSONKey)

        self.accessToken = storedAccessToken
        self.refreshToken = storedRefreshToken
        self.userJSON = storedUserJSON
        self.entitlementJSON = storedEntitlementJSON
        self.isAuthenticated = !(storedAccessToken?.isEmpty ?? true)
    }

    func login(email: String, password: String) async throws {
        let result = try await backendClient.login(email: email, password: password)
        store(result: result)
    }

    func register(
        email: String,
        username: String,
        password: String,
        firstName: String?,
        lastName: String?,
        accessCode: String?
    ) async throws {
        let result = try await backendClient.register(
            email: email,
            username: username,
            password: password,
            firstName: firstName,
            lastName: lastName,
            accessCode: accessCode
        )
        store(result: result)
    }

    func logout() {
        accessToken = nil
        refreshToken = nil
        userJSON = nil
        entitlementJSON = nil
        isAuthenticated = false

        defaults.removeObject(forKey: accessTokenKey)
        defaults.removeObject(forKey: refreshTokenKey)
        defaults.removeObject(forKey: userJSONKey)
        defaults.removeObject(forKey: entitlementJSONKey)
    }

    private func store(result: BackendLoginResult) {
        accessToken = result.accessToken
        refreshToken = result.refreshToken
        userJSON = result.userJSON
        entitlementJSON = result.entitlementJSON
        isAuthenticated = true

        defaults.set(result.accessToken, forKey: accessTokenKey)
        defaults.set(result.refreshToken, forKey: refreshTokenKey)
        defaults.set(result.userJSON, forKey: userJSONKey)
        defaults.set(result.entitlementJSON, forKey: entitlementJSONKey)
    }
}

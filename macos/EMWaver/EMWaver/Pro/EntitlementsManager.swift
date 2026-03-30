import Combine
import Foundation

@MainActor
final class EntitlementsManager: ObservableObject {
    struct Entitlements: Codable {
        struct Features: Codable {
            var cloudHosts: Bool
            var cloudFiles: Bool
            var agent: Bool
        }

        var pro: Bool
        var expires_at_ms: Int?
        var features: Features
        var server_time_ms: Int?
    }

    struct PurchaseEligibility: Codable {
        var canPurchasePro: Bool
        var reason: String?
        var requiresDeviceAttached: Bool
        var hasDeviceAttached: Bool
    }

    @Published private(set) var entitlements: Entitlements?
    @Published private(set) var eligibility: PurchaseEligibility?
    @Published private(set) var lastError: String?

    private let urlSession: URLSession
    private var lastFetchAt: Date?

    init(urlSession: URLSession = .shared) {
        self.urlSession = urlSession
    }

    var isPro: Bool { entitlements?.pro ?? false }

    func refresh(auth: AuthenticationManager, force: Bool = false) async {
        // Cheap throttle.
        if !force, let t = lastFetchAt, Date().timeIntervalSince(t) < 10 {
            return
        }
        lastFetchAt = Date()
        lastError = nil

        guard let base = BackendUrl.resolve() else {
            entitlements = nil
            eligibility = nil
            return
        }

        // In dev we sometimes run with auth disabled.
        let allowAnon = (ProcessInfo.processInfo.environment["EMWAVER_ALLOW_ANON_SYNC"] == "1")
        let token = auth.accessToken

        // If we're not signed in, we can still show a predictable state.
        if token.isEmpty, !allowAnon {
            entitlements = nil
            eligibility = nil
            return
        }

        do {
            // --- Entitlements ---
            var entURL = base
            entURL.appendPathComponent("v1/entitlements")

            var entReq = URLRequest(url: entURL)
            entReq.httpMethod = "GET"
            entReq.setValue("application/json", forHTTPHeaderField: "Accept")
            if !token.isEmpty {
                entReq.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            }

            let (entData, entRes) = try await urlSession.data(for: entReq)
            if let http = entRes as? HTTPURLResponse, http.statusCode >= 400 {
                if http.statusCode == 401 {
                    auth.handleUnauthorizedResponse()
                }
                let text = String(data: entData, encoding: .utf8) ?? ""
                throw NSError(domain: "Entitlements", code: http.statusCode, userInfo: [NSLocalizedDescriptionKey: text.isEmpty ? "HTTP \(http.statusCode)" : text])
            }
            entitlements = try JSONDecoder().decode(Entitlements.self, from: entData)

            // --- Eligibility ---
            var elURL = base
            elURL.appendPathComponent("v1/billing/eligibility")

            var elReq = URLRequest(url: elURL)
            elReq.httpMethod = "GET"
            elReq.setValue("application/json", forHTTPHeaderField: "Accept")
            if !token.isEmpty {
                elReq.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            }

            let (elData, elRes) = try await urlSession.data(for: elReq)
            if let http = elRes as? HTTPURLResponse, http.statusCode >= 400 {
                if http.statusCode == 401 {
                    auth.handleUnauthorizedResponse()
                }
                let text = String(data: elData, encoding: .utf8) ?? ""
                throw NSError(domain: "Eligibility", code: http.statusCode, userInfo: [NSLocalizedDescriptionKey: text.isEmpty ? "HTTP \(http.statusCode)" : text])
            }
            eligibility = try JSONDecoder().decode(PurchaseEligibility.self, from: elData)
        } catch {
            lastError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
    }
}

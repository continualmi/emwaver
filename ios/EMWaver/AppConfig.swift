/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * All rights reserved.
 */

import Foundation

enum AppConfig {
    // Local-only mode: use operouter/localhost URLs
    static var backendBaseURL: URL {
        if let rawValue = Bundle.main.object(forInfoDictionaryKey: "OperouterBaseURL") as? String,
           let url = URL(string: rawValue.trimmingCharacters(in: .whitespacesAndNewlines)),
           !rawValue.isEmpty {
            return url
        }
        // Default to localhost for iOS simulator, operouter for device
        return URL(string: "http://localhost:8000")!
    }
}

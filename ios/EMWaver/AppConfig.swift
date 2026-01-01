/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
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

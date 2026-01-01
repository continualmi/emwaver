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

@MainActor
final class AuthenticationManager: ObservableObject {
    @Published private(set) var isAuthenticated: Bool
    @Published private(set) var accessToken: String?

    init() {
        // Local-only mode: always authenticated with a local token
        self.isAuthenticated = true
        self.accessToken = "local-only-token"
    }

    func logout() {
        // No-op in local-only mode
    }
}

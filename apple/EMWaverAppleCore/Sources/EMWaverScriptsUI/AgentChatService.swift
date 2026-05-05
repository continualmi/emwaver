/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

import Foundation

// NOTE: Agent chat is now implemented against the API-key Agent endpoint
// configured by the host app. The open client sends local context only;
// production prompts and private `.emw` instructions stay server-side.
// See AgentChatBackend.swift.

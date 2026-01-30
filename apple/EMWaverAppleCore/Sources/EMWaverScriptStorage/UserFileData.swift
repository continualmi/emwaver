/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * All rights reserved.
 */

import Foundation

public struct UserFileData {
    public let metadata: UserFileMetadata
    public let textContent: String?
    public let binaryContent: Data?

    public var hasTextContent: Bool { textContent != nil }
    public var hasBinaryContent: Bool { binaryContent != nil }

    public init(metadata: UserFileMetadata, textContent: String?, binaryContent: Data?) {
        self.metadata = metadata
        self.textContent = textContent
        self.binaryContent = binaryContent
    }
}

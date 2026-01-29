/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
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

public struct UserFileMetadata: Identifiable, Equatable {
    public let id: String
    public let name: String
    public let fileExtension: String
    public let kind: String
    public let etag: String?
    public let sizeBytes: Int64
    public let contentType: String?

    public init(
        id: String,
        name: String,
        fileExtension: String,
        kind: String,
        etag: String?,
        sizeBytes: Int64,
        contentType: String?
    ) {
        self.id = id
        self.name = name
        self.fileExtension = fileExtension
        self.kind = kind
        self.etag = etag
        self.sizeBytes = sizeBytes
        self.contentType = contentType
    }

    public func updating(name: String? = nil, etag: String? = nil, sizeBytes: Int64? = nil) -> UserFileMetadata {
        UserFileMetadata(
            id: id,
            name: name ?? self.name,
            fileExtension: fileExtension,
            kind: kind,
            etag: etag ?? self.etag,
            sizeBytes: sizeBytes ?? self.sizeBytes,
            contentType: contentType
        )
    }
}

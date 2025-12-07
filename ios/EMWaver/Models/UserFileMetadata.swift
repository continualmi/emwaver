import Foundation

struct UserFileMetadata: Identifiable, Equatable {
    let id: String
    let name: String
    let fileExtension: String
    let kind: String
    let etag: String?
    let sizeBytes: Int64
    let contentType: String?

    init(
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

    init(json: [String: Any]) {
        id = json["id"] as? String ?? ""
        name = json["name"] as? String ?? ""
        fileExtension = json["extension"] as? String ?? ""
        kind = json["kind"] as? String ?? "file"
        etag = json["etag"] as? String
        if let value = json["size_bytes"] as? Int64 {
            sizeBytes = value
        } else if let value = json["size_bytes"] as? NSNumber {
            sizeBytes = value.int64Value
        } else if let value = json["sizeBytes"] as? NSNumber {
            sizeBytes = value.int64Value
        } else if let value = json["sizeBytes"] as? Int64 {
            sizeBytes = value
        } else {
            sizeBytes = 0
        }
        contentType = json["content_type"] as? String
    }

    func updating(name: String? = nil, etag: String? = nil, sizeBytes: Int64? = nil) -> UserFileMetadata {
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

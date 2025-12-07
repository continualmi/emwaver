import Foundation

struct UserFileData {
    let metadata: UserFileMetadata
    let textContent: String?
    let binaryContent: Data?

    var hasTextContent: Bool { textContent != nil }
    var hasBinaryContent: Bool { binaryContent != nil }
}

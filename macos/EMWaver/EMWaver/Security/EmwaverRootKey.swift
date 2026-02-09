import Foundation
import CryptoKit

enum EmwaverRootKey {
    /// Base64-encoded 32-byte Ed25519 public key.
    ///
    /// Set via Info.plist key `EMWAVER_ROOT_PUBLIC_KEY_B64` (preferred) or as an environment variable
    /// (handy for Xcode Run scheme during development).
    static var publicKey: Curve25519.Signing.PublicKey? {
        let plistB64 = (Bundle.main.object(forInfoDictionaryKey: "EMWAVER_ROOT_PUBLIC_KEY_B64") as? String)
        let envB64 = ProcessInfo.processInfo.environment["EMWAVER_ROOT_PUBLIC_KEY_B64"]

        let rawB64 = (plistB64 ?? envB64 ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !rawB64.isEmpty else { return nil }
        guard let raw = Data(base64Encoded: rawB64), raw.count == 32 else { return nil }
        return try? Curve25519.Signing.PublicKey(rawRepresentation: raw)
    }
}

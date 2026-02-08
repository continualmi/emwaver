import Foundation
import CryptoKit

enum EmwaverRootKey {
    /// Base64-encoded 32-byte Ed25519 public key.
    ///
    /// Set via Info.plist key `EMWAVER_ROOT_PUBLIC_KEY_B64` (preferred) or hardcode here for dev.
    static var publicKey: Curve25519.Signing.PublicKey? {
        let b64 = (Bundle.main.object(forInfoDictionaryKey: "EMWAVER_ROOT_PUBLIC_KEY_B64") as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
        let rawB64 = (b64?.isEmpty == false) ? b64! : ""
        guard !rawB64.isEmpty else { return nil }
        guard let raw = Data(base64Encoded: rawB64), raw.count == 32 else { return nil }
        return try? Curve25519.Signing.PublicKey(rawRepresentation: raw)
    }
}

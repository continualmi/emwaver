import Foundation
import CryptoKit

/// Root public key used to verify per-device identity Proofs (ed25519 signature over 16-byte DeviceID).
///
/// iOS version is intentionally hardcoded (no update-mode / provisioning flows here).
///
/// EMWAVER_ROOT_PUBLIC_KEY_B64 = Hc1UAlc+CXh9bLPLWCqV3I8FyQVKxr7U7S+L7Nycm4s=
enum EmwaverRootKey {
    private static let publicKeyB64 = "Hc1UAlc+CXh9bLPLWCqV3I8FyQVKxr7U7S+L7Nycm4s="

    static var publicKey: Curve25519.Signing.PublicKey? {
        let rawB64 = publicKeyB64.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let raw = Data(base64Encoded: rawB64), raw.count == 32 else { return nil }
        return try? Curve25519.Signing.PublicKey(rawRepresentation: raw)
    }
}

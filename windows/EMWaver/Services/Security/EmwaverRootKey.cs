using System;

namespace EMWaver.Services.Security;

// Root public key used to verify per-device identity proofs.
// Windows equivalent of macOS EmwaverRootKey.swift.
internal static class EmwaverRootKey
{
    // Base64-encoded 32-byte Ed25519 public key.
    internal static byte[]? GetPublicKeyRaw()
    {
        try
        {
            var b64 = (Environment.GetEnvironmentVariable("EMWAVER_ROOT_PUBLIC_KEY_B64") ?? "").Trim();
            if (string.IsNullOrWhiteSpace(b64)) return null;
            var raw = Convert.FromBase64String(b64);
            return raw.Length == 32 ? raw : null;
        }
        catch
        {
            return null;
        }
    }
}

using System;
using System.Security.Cryptography;
using System.Text;

namespace EMWaver.Services.Cloud;

internal static class PkceUtil
{
    internal static string CreateCodeVerifier()
    {
        // RFC 7636: code_verifier length 43-128 chars.
        var bytes = RandomNumberGenerator.GetBytes(64);
        return Base64UrlEncode(bytes);
    }

    internal static string CreateCodeChallenge(string verifier)
    {
        var bytes = SHA256.HashData(Encoding.ASCII.GetBytes(verifier));
        return Base64UrlEncode(bytes);
    }

    internal static string Base64UrlEncode(byte[] bytes)
    {
        return Convert.ToBase64String(bytes)
            .TrimEnd('=')
            .Replace('+', '-')
            .Replace('/', '_');
    }
}

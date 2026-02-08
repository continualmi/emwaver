using System;

namespace EMWaver.Services.Cloud;

internal sealed record CloudConfig(
    string BackendBaseUrl,
    string FirebaseWebApiKey,
    string GoogleClientId,
    string GoogleClientSecret)
{
    internal static CloudConfig FromEnvironment()
    {
        // Backend base URL is controlled by Settings (local vs Azure prod).
        var backend = BackendUrl.Resolve().Trim();

        var firebaseKey = (Environment.GetEnvironmentVariable("EMWAVER_FIREBASE_WEB_API_KEY") ?? "").Trim();
        var googleClientId = (Environment.GetEnvironmentVariable("EMWAVER_GOOGLE_CLIENT_ID") ?? "").Trim();
        var googleClientSecret = (Environment.GetEnvironmentVariable("EMWAVER_GOOGLE_CLIENT_SECRET") ?? "").Trim();

        return new CloudConfig(
            BackendBaseUrl: backend.TrimEnd('/'),
            FirebaseWebApiKey: firebaseKey,
            GoogleClientId: googleClientId,
            GoogleClientSecret: googleClientSecret
        );
    }
}

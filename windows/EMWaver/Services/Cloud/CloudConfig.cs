using System;

namespace EMWaver.Services.Cloud;

internal sealed record CloudConfig(
    string BackendBaseUrl,
    string FirebaseWebApiKey,
    string GoogleClientId)
{
    internal static CloudConfig FromEnvironment()
    {
        // Keep env-based config for dev. In Store builds, you will likely hardcode
        // the Firebase web api key + Google client id (or load from packaged config).
        var backend = (Environment.GetEnvironmentVariable("EMWAVER_BACKEND_URL") ?? "").Trim();
        if (string.IsNullOrWhiteSpace(backend))
        {
            backend = "http://127.0.0.1:8787";
        }

        var firebaseKey = (Environment.GetEnvironmentVariable("EMWAVER_FIREBASE_WEB_API_KEY") ?? "").Trim();
        var googleClientId = (Environment.GetEnvironmentVariable("EMWAVER_GOOGLE_CLIENT_ID") ?? "").Trim();

        return new CloudConfig(
            BackendBaseUrl: backend.TrimEnd('/'),
            FirebaseWebApiKey: firebaseKey,
            GoogleClientId: googleClientId
        );
    }
}

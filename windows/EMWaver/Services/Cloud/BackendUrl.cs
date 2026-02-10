namespace EMWaver.Services.Cloud;

internal static class BackendUrl
{
    internal const string AzureProduction = "https://emwaver-backend.delightfuldune-64bd11df.westeurope.azurecontainerapps.io";
    internal const string Localhost = "http://localhost:8787";

    internal static string Resolve()
    {
        // Hard switch controlled by app settings.
        if (AppServices.Settings.UseProductionBackend)
        {
            return AzureProduction;
        }

        // Local mode is intentionally fixed to localhost to avoid stale/cached custom URLs.
        return Localhost;
    }
}

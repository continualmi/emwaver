namespace EMWaver.Services.Cloud;

internal static class FrontendUrl
{
    internal const string AzureProduction = "https://emwaver-frontend.delightfuldune-64bd11df.westeurope.azurecontainerapps.io";
    internal const string Localhost = "http://localhost:3000";

    internal static string Resolve()
    {
        if (AppServices.Settings.UseProductionFrontend)
        {
            return AzureProduction;
        }

        // Local mode is intentionally fixed to localhost to avoid stale/cached custom URLs
        // and ensure consistent web handoff behavior.
        return Localhost;
    }
}

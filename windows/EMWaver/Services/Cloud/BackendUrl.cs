using System;

namespace EMWaver.Services.Cloud;

internal static class BackendUrl
{
    internal const string AzureProduction = "https://emwaver-backend.delightfuldune-64bd11df.westeurope.azurecontainerapps.io";

    internal static string Resolve()
    {
        // Hard switch controlled by app settings.
        if (AppServices.Settings.UseProductionBackend)
        {
            return AzureProduction;
        }

        var local = (AppServices.Settings.LocalBackendUrl ?? "").Trim();
        if (!string.IsNullOrWhiteSpace(local))
        {
            return local;
        }

        return AzureProduction;
    }
}

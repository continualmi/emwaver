using System;

namespace EMWaver.Services.Cloud;

internal static class FrontendUrl
{
    internal const string AzureProduction = "https://emwaver-frontend.delightfuldune-64bd11df.westeurope.azurecontainerapps.io";

    internal static string Resolve()
    {
        if (AppServices.Settings.UseProductionFrontend)
        {
            return AzureProduction;
        }

        var local = (AppServices.Settings.LocalFrontendUrl ?? "").Trim();
        if (!string.IsNullOrWhiteSpace(local))
        {
            return local;
        }

        var env = (Environment.GetEnvironmentVariable("EMWAVER_FRONTEND_URL") ?? "").Trim();
        if (!string.IsNullOrWhiteSpace(env))
        {
            return env;
        }

        return "http://localhost:3000";
    }
}

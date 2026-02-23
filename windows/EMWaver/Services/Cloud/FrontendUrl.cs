namespace EMWaver.Services.Cloud;

internal static class FrontendUrl
{
    internal static string Cloud =>
        (System.Environment.GetEnvironmentVariable("EMWAVER_FRONTEND_URL_CLOUD") ?? "https://emwaver-frontend.delightfuldune-64bd11df.westeurope.azurecontainerapps.io").Trim();

    internal static string Local =>
        (System.Environment.GetEnvironmentVariable("EMWAVER_FRONTEND_URL_LOCAL") ?? "http://127.0.0.1:3000").Trim();

    internal static string Resolve()
    {
        if (AppServices.Settings.UseProductionFrontend)
        {
            return Cloud;
        }

        return Local;
    }
}

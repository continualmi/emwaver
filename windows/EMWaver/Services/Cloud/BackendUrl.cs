namespace EMWaver.Services.Cloud;

internal static class BackendUrl
{
    internal static string Cloud =>
        (System.Environment.GetEnvironmentVariable("EMWAVER_BACKEND_URL_CLOUD") ?? "https://emwaver-backend.delightfuldune-64bd11df.westeurope.azurecontainerapps.io").Trim();

    internal static string Local =>
        (System.Environment.GetEnvironmentVariable("EMWAVER_BACKEND_URL_LOCAL") ?? "http://127.0.0.1:3920").Trim();

    internal static string Resolve()
    {
        // Hard switch controlled by settings (staff-only section).
        if (AppServices.Settings.UseProductionBackend)
        {
            return Cloud;
        }

        return Local;
    }
}

const DEFAULT_SOCIETY_SITE_URL = "https://continualmi.com";

export function societySiteUrl(): string {
  const value =
    process.env.NEXT_PUBLIC_SOCIETY_SITE_URL ||
    process.env.SOCIETY_SITE_URL ||
    DEFAULT_SOCIETY_SITE_URL;

  return value.trim().replace(/\/+$/, "");
}

export function societyRouteUrl(path = "/society"): string {
  const base = societySiteUrl();
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${base}${suffix}`;
}

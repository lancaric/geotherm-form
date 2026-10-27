export function resolveApiBaseUrl(configuredUrl: string | undefined, isDevelopment: boolean): string {
  const base = (configuredUrl?.trim() || (isDevelopment ? "http://localhost:4000" : ""))
    .replace(/\/+$/, "");
  return base.endsWith("/api") ? base : `${base}/api`;
}

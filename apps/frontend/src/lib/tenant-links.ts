/** Keep the development tenant selector when following an internal link. */
export function tenantAwarePath(path: string, sourceUrl: URL): string {
  const tenant = sourceUrl.searchParams.get("__tenant");
  if (!tenant) return path;
  return `${path}${path.includes("?") ? "&" : "?"}__tenant=${encodeURIComponent(tenant)}`;
}

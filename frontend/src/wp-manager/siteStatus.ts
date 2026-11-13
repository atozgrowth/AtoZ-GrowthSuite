/** The connected-sites endpoint historically returns only id and site_url. */
export function isConnectedSite(site: { status?: unknown }) {
  return site.status === undefined || site.status === "connected";
}

import { useEffect, useState } from "react";
import type {
  WordPressContentInventoryItem,
  WordPressInventory,
  WordPressInventoryResource,
  WordPressMediaInventoryItem,
  WordPressPluginInventoryItem,
  WordPressThemeInventoryItem,
} from "../types/wordpress";
import { ApiError, getWordPressInventory } from "./api";
import { decodeDisplayText } from "./displayText";

const resources: Array<{ value: WordPressInventoryResource; label: string }> = [
  { value: "posts", label: "Posts" }, { value: "pages", label: "Pages" },
  { value: "media", label: "Media" }, { value: "plugins", label: "Plugins" }, { value: "themes", label: "Themes" },
];
function safePublicUrl(value: string | null) {
  if (!value) return null;
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null; }
  catch { return null; }
}
function dateLabel(value: string | null) {
  if (!value) return "Not available";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : "Not available";
}

export function WordPressInventoryPanel({ accessToken, connectionId }: { accessToken: string; connectionId: string }) {
  const [resource, setResource] = useState<WordPressInventoryResource>("posts");
  const [page, setPage] = useState(1);
  const [inventory, setInventory] = useState<WordPressInventory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true); setError(""); setInventory(null);
    void getWordPressInventory(accessToken, connectionId, resource, page).then((value) => {
      if (active) setInventory(value);
    }).catch((caught) => {
      if (active) setError(caught instanceof ApiError ? caught.message : "The WordPress inventory could not be loaded.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [accessToken, connectionId, resource, page, refreshKey]);

  function choose(next: WordPressInventoryResource) { setResource(next); setPage(1); }
  const pagination = inventory?.pagination;

  return (
    <section className="panel inventory-panel" aria-labelledby="inventory-title">
      <div className="panel-heading"><div><h2 id="inventory-title">Read-only inventory</h2><p>Allowlisted metadata only. No content or settings can be changed.</p></div></div>
      <div className="inventory-tabs" role="tablist" aria-label="WordPress inventory">
        {resources.map((item) => <button key={item.value} className={`button ${resource === item.value ? "primary" : "secondary"}`} type="button" role="tab" aria-selected={resource === item.value} onClick={() => choose(item.value)}>{item.label}</button>)}
      </div>
      {loading && <div className="state-box" role="status"><span className="spinner" /><h3>Loading {resource}</h3><p>Requesting safe metadata through the paired read-only connection…</p></div>}
      {!loading && error && <div className="state-box error-state" role="alert"><span className="state-icon">!</span><h3>Inventory unavailable</h3><p>{error}</p><button className="button secondary" type="button" onClick={() => setRefreshKey((current) => current + 1)}>Try again</button></div>}
      {!loading && inventory && inventory.items.length === 0 && <div className="state-box"><h3>No {resource} found</h3><p>This connected site reported no items for this page.</p></div>}
      {!loading && inventory && inventory.items.length > 0 && resource !== "plugins" && resource !== "themes" && (
        <div className="inventory-list">
          {resource === "media" ? (inventory.items as WordPressMediaInventoryItem[]).map((item) => {
            const url = safePublicUrl(item.public_url);
            return <article className="inventory-row" key={item.id}><div><strong>{decodeDisplayText(item.title)}</strong><small>{item.media_type || "media"} · {item.mime_type || "unknown type"}{item.width !== null && item.height !== null ? ` · ${item.width}×${item.height}` : ""}</small></div><div><span>{dateLabel(item.uploaded_at)}</span>{url && <a href={url} target="_blank" rel="noreferrer">Open media</a>}</div></article>;
          }) : (inventory.items as WordPressContentInventoryItem[]).map((item) => {
            const url = safePublicUrl(item.public_url);
            return <article className="inventory-row" key={item.id}><div><strong>{decodeDisplayText(item.title)}</strong><small>{item.status} · /{item.slug || "(no slug)"}</small></div><div><span>{item.author_display_name ? decodeDisplayText(item.author_display_name) : "Author unavailable"}</span><small>Published {dateLabel(item.published_at)}</small><small>Modified {dateLabel(item.modified_at)}</small>{url && <a href={url} target="_blank" rel="noreferrer">View public item</a>}</div></article>;
          })}
        </div>
      )}
      {!loading && inventory && resource === "plugins" && inventory.items.length > 0 && (
        <div className="inventory-list">{(inventory.items as WordPressPluginInventoryItem[]).map((item, index) => <article className="inventory-row" key={`${item.name}-${index}`}><div><strong>{decodeDisplayText(item.name)}</strong><small>Version {item.version || "Not reported"}</small></div><span className={`status-pill ${item.active ? "success" : "readonly"}`}>{item.active ? "Active" : "Inactive"}</span></article>)}</div>
      )}
      {!loading && inventory && resource === "themes" && inventory.items.length > 0 && (
        <div className="inventory-list">{(inventory.items as WordPressThemeInventoryItem[]).map((item, index) => <article className="inventory-row" key={`${item.name}-${index}`}><div><strong>{decodeDisplayText(item.name)}</strong><small>Version {item.version || "Not reported"}{item.parent ? ` · Parent: ${decodeDisplayText(item.parent)}` : ""}</small><small>{item.update_available === null ? "Update status unknown or stale" : item.update_available ? "Update reported by recent cache" : "No update reported by recent cache"}</small></div><span className={`status-pill ${item.active ? "success" : "readonly"}`}>{item.active ? "Active" : "Inactive"}</span></article>)}</div>
      )}
      {!loading && pagination && <div className="inventory-pagination"><button className="button secondary" type="button" disabled={pagination.page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</button><span>Page {pagination.page} of {Math.max(1, pagination.total_pages)} · {pagination.total_items} items</span><button className="button secondary" type="button" disabled={pagination.total_pages === 0 || pagination.page >= pagination.total_pages} onClick={() => setPage((current) => current + 1)}>Next</button></div>}
    </section>
  );
}

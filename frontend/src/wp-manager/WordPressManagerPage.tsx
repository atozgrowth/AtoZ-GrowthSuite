import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useAuth } from "../auth/useAuth";
import { Icon } from "../components/Icon";
import type { WordPressPairing, WordPressSite, WordPressSiteInspection } from "../types/wordpress";
import { decodeDisplayText } from "./displayText";
import { WordPressDraftPanel } from "./WordPressDraftPanel";
import { WordPressInventoryPanel } from "./WordPressInventoryPanel";
import { WordPressActionApprovalPanel } from "./WordPressActionApprovalPanel";
import {
  ApiError,
  getWordPressSiteInspection,
  getWordPressSites,
  initiateWordPressPairing,
  revokeWordPressConnection,
} from "./api";

type PairingPhase = "idle" | "starting" | "pending" | "success" | "expired" | "error";

const CONTROLLED_ACTION_UI_ENABLED =
  import.meta.env.VITE_WP_CONTROLLED_ACTION_UI_ENABLED === "true";

function host(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function normalizeSiteUrl(value: string) {
  const url = new URL(value.trim());
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("Enter the HTTPS site address without credentials, query parameters, or fragments.");
  }
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url.toString().replace(/\/$/, "");
}

function sameSite(left: string, right: string) {
  try {
    return normalizeSiteUrl(left) === normalizeSiteUrl(right);
  } catch {
    return false;
  }
}

export function WordPressManagerPage() {
  const { session } = useAuth();
  const [sites, setSites] = useState<WordPressSite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [authRequired, setAuthRequired] = useState(false);
  const [pairingOpen, setPairingOpen] = useState(false);
  const [siteUrl, setSiteUrl] = useState("");
  const [pairing, setPairing] = useState<WordPressPairing | null>(null);
  const [pairingPhase, setPairingPhase] = useState<PairingPhase>("idle");
  const [pairingMessage, setPairingMessage] = useState("");
  const [checking, setChecking] = useState(false);
  const [copied, setCopied] = useState<"connection" | "challenge" | null>(null);
  const [inspection, setInspection] = useState<WordPressSiteInspection | null>(null);
  const [inspectedSiteId, setInspectedSiteId] = useState<string | null>(null);
  const [inspectionLoading, setInspectionLoading] = useState(false);
  const [inspectionError, setInspectionError] = useState("");
  const inspectionGeneration=useRef(0);
  const [confirmRevoke,setConfirmRevoke]=useState(false),[revokeAgreed,setRevokeAgreed]=useState(false),[revokeBusy,setRevokeBusy]=useState(false),[revokeError,setRevokeError]=useState('');
  const revokeLock=useRef(false);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError("");
      setAuthRequired(false);
      try {
        setSites(await getWordPressSites(session?.access_token ?? "", signal));
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setAuthRequired(caught instanceof ApiError && caught.status === 401);
        setError(
          caught instanceof ApiError
            ? caught.message
            : "Something went wrong while loading your sites.",
        );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [session?.access_token],
  );

  useEffect(() => {
    document.title = "WordPress Manager · A to Z Growth";
    const controller = new AbortController();
    void load(controller.signal);
    return () => { controller.abort(); inspectionGeneration.current++; };
  }, [load]);

  useEffect(() => {
    if (pairingPhase !== "pending" || !pairing) return;
    const expire = () => {
      if (Date.now() < new Date(pairing.expires_at).getTime()) return;
      setPairingPhase("expired");
      setPairingMessage("This pairing code has expired. Start again to generate a fresh one.");
      setPairing((current) => (current ? { ...current, challenge: "" } : null));
    };
    expire();
    const timer = window.setInterval(expire, 1000);
    return () => window.clearInterval(timer);
  }, [pairing, pairingPhase]);

  async function startPairing(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPairingMessage("");
    setCopied(null);

    let normalized: string;
    try {
      normalized = normalizeSiteUrl(siteUrl);
    } catch (caught) {
      setPairingPhase("error");
      setPairingMessage(
        caught instanceof Error ? caught.message : "Enter a valid HTTPS WordPress site address.",
      );
      return;
    }

    setPairingPhase("starting");
    try {
      const result = await initiateWordPressPairing(session?.access_token ?? "", normalized);
      setPairing(result);
      setSiteUrl(result.site_url);
      setPairingPhase("pending");
      setPairingMessage(
        "Pairing is pending. Approve it from the A to Z Growth page in WordPress Admin before the code expires.",
      );
    } catch (caught) {
      setPairing(null);
      setPairingPhase("error");
      setPairingMessage(
        caught instanceof ApiError
          ? caught.message
          : "The pairing request could not be started.",
      );
    }
  }

  async function copyValue(value: string, type: "connection" | "challenge") {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(type);
    } catch {
      setPairingMessage("Copy failed. Select the value manually and paste it into WordPress Admin.");
    }
  }

  async function checkConnection() {
    if (!pairing) return;
    if (Date.now() >= new Date(pairing.expires_at).getTime()) {
      setPairingPhase("expired");
      setPairingMessage("This pairing code has expired. Start again to generate a fresh one.");
      setPairing((current) => (current ? { ...current, challenge: "" } : null));
      return;
    }

    setChecking(true);
    setPairingMessage("");
    try {
      const currentSites = await getWordPressSites(session?.access_token ?? "");
      setSites(currentSites);
      if (currentSites.some((site) => sameSite(site.site_url, pairing.site_url))) {
        setPairing((current) => (current ? { ...current, challenge: "" } : null));
        setPairingPhase("success");
        setPairingMessage("Connection confirmed. The site is now available in read-only mode.");
      } else {
        setPairingPhase("pending");
        setPairingMessage("Still waiting for approval in WordPress Admin.");
      }
    } catch (caught) {
      setPairingMessage(
        caught instanceof ApiError
          ? caught.message
          : "The connection status could not be checked.",
      );
    } finally {
      setChecking(false);
    }
  }

  async function inspectSite(site: WordPressSite) {
    if (typeof site.id !== "string") {
      setInspectionError("The connected site identifier is unavailable.");
      return;
    }

    const generation=++inspectionGeneration.current;
    setConfirmRevoke(false);setRevokeAgreed(false);setRevokeError('');
    setInspectedSiteId(site.id);
    setInspection(null);
    setInspectionError("");
    setInspectionLoading(true);
    try {
      const result=await getWordPressSiteInspection(session?.access_token ?? "",site.id);
      if(generation===inspectionGeneration.current)setInspection(result);
    } catch (caught) {
      if(generation!==inspectionGeneration.current)return;
      setInspectionError(
        caught instanceof ApiError
          ? caught.message
          : "The connected WordPress site could not be inspected.",
      );
    } finally {
      if(generation===inspectionGeneration.current)setInspectionLoading(false);
    }
  }

  async function revokeSelectedConnection() {
    if(!inspectedSiteId||!revokeAgreed||revokeLock.current)return;
    revokeLock.current=true;setRevokeBusy(true);setRevokeError('');const id=inspectedSiteId;
    try{await revokeWordPressConnection(session?.access_token??'',id);setSites(current=>current.filter(site=>site.id!==id));inspectionGeneration.current++;setInspectedSiteId(null);setInspection(null);setInspectionError('');setConfirmRevoke(false);setRevokeAgreed(false);}
    catch(caught){setRevokeError(caught instanceof Error?caught.message:'Connection revocation could not be verified.');}
    finally{revokeLock.current=false;setRevokeBusy(false);}
  }

  function resetPairing() {
    setPairing(null);
    setPairingPhase("idle");
    setPairingMessage("");
    setCopied(null);
    setSiteUrl("");
    setPairingOpen(true);
  }

  const inspectedSite = sites.find((site) => site.id === inspectedSiteId) ?? null;

  return (
    <div className="page-stack">
      <header className="page-header split">
        <div>
          <span className="eyebrow">Site management</span>
          <div className="title-row">
            <h1>WordPress Manager</h1>
            <span className="status-pill readonly">
              <Icon name="shield" size={14} />
              Read-only by default
            </span>
          </div>
          <p>View and securely pair WordPress sites with your authenticated account.</p>
        </div>
        <div className="header-actions">
          <button
            className="button primary"
            onClick={() => setPairingOpen(true)}
            disabled={pairingPhase === "starting"}
          >
            Connect a site
          </button>
          <button className="button secondary" onClick={() => void load()} disabled={loading}>
            <Icon name="refresh" size={18} />
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>

      <div className="readonly-banner">
        <Icon name="shield" />
        <div>
          <strong>Safe access by default</strong>
          <p>Inventory remains read-only. Draft operations require explicit isolated-test configuration and exact owner approval. Publishing and unrestricted administration are unavailable.</p>
        </div>
      </div>

      {(pairingOpen || pairing) && (
        <section className="panel pairing-panel" aria-labelledby="pairing-title">
          <div className="panel-heading">
            <div>
              <h2 id="pairing-title">Connect a WordPress site</h2>
              <p>Generate a short-lived code, then approve it from that site’s WordPress Admin.</p>
            </div>
            {pairingPhase === "pending" && <span className="status-pill pending"><i />Pending</span>}
            {pairingPhase === "success" && <span className="status-pill success"><i />Connected</span>}
            {pairingPhase === "expired" && <span className="status-pill expired"><i />Expired</span>}
          </div>

          {!pairing && (
            <form className="pairing-form" onSubmit={startPairing}>
              <label htmlFor="pairing-site-url">WordPress site URL</label>
              <div className="pairing-form-row">
                <input
                  id="pairing-site-url"
                  type="url"
                  inputMode="url"
                  autoComplete="url"
                  placeholder="https://example.com"
                  value={siteUrl}
                  onChange={(event) => setSiteUrl(event.target.value)}
                  disabled={pairingPhase === "starting"}
                  required
                />
                <button
                  className="button primary"
                  type="submit"
                  disabled={pairingPhase === "starting"}
                >
                  {pairingPhase === "starting" ? "Generating…" : "Generate pairing code"}
                </button>
              </div>
              <p className="field-help">
                Enter the exact HTTPS address shown by the plugin. Your account ownership is applied
                by the authenticated backend.
              </p>
            </form>
          )}

          {pairing && pairingPhase !== "success" && pairingPhase !== "expired" && (
            <div className="pairing-details">
              <ol className="pairing-steps">
                <li>Open <strong>A to Z Growth</strong> in the site’s WordPress Admin.</li>
                <li>Paste the connection ID and one-time pairing code shown below.</li>
                <li>Approve the connection, then return here and check its status.</li>
              </ol>
              <div className="pairing-value">
                <span>Connection ID</span>
                <code>{pairing.connection_id}</code>
                <button
                  className="button secondary"
                  type="button"
                  onClick={() => void copyValue(pairing.connection_id, "connection")}
                >
                  {copied === "connection" ? "Copied" : "Copy"}
                </button>
              </div>
              <div className="pairing-value sensitive">
                <span>One-time pairing code</span>
                <code>{pairing.challenge}</code>
                <button
                  className="button secondary"
                  type="button"
                  onClick={() => void copyValue(pairing.challenge, "challenge")}
                >
                  {copied === "challenge" ? "Copied" : "Copy"}
                </button>
              </div>
              <p className="pairing-expiry">
                Expires {new Date(pairing.expires_at).toLocaleString()}. Treat this code like a
                temporary password; it is single-use and is not stored in plaintext by A to Z Growth.
              </p>
              <div className="pairing-actions">
                <button
                  className="button primary"
                  type="button"
                  onClick={() => void checkConnection()}
                  disabled={checking}
                >
                  {checking ? "Checking…" : "Check connection"}
                </button>
                <button className="button secondary" type="button" onClick={resetPairing}>
                  Start over
                </button>
              </div>
            </div>
          )}

          {pairingPhase === "success" && (
            <div className="pairing-result success" role="status">
              <strong>Pairing successful</strong>
              <p>{pairingMessage}</p>
              <button className="button secondary" type="button" onClick={resetPairing}>
                Connect another site
              </button>
            </div>
          )}

          {pairingPhase === "expired" && (
            <div className="pairing-result error" role="alert">
              <strong>Pairing code expired</strong>
              <p>{pairingMessage}</p>
              <button className="button primary" type="button" onClick={resetPairing}>
                Generate a new code
              </button>
            </div>
          )}

          {pairingMessage &&
            pairingPhase !== "success" &&
            pairingPhase !== "expired" && (
              <div
                className={`alert ${pairingPhase === "error" ? "error" : "warning"}`}
                role={pairingPhase === "error" ? "alert" : "status"}
              >
                {pairingMessage}
              </div>
            )}
        </section>
      )}

      <section className="panel sites-panel" aria-labelledby="sites-title" aria-busy={loading}>
        <div className="panel-heading">
          <div>
            <h2 id="sites-title">Connected sites</h2>
            <p>Properties available only to your authenticated account.</p>
          </div>
          {!loading && !error && (
            <span className="count-badge">
              {sites.length} {sites.length === 1 ? "site" : "sites"}
            </span>
          )}
        </div>
        {loading && (
          <State loading title="Loading connected sites" text="Securely requesting your site directory…" />
        )}
        {!loading && error && (
          <div className="state-box error-state" role="alert">
            <span className="state-icon">!</span>
            <h3>{authRequired ? "Authentication required" : "We couldn’t load your sites"}</h3>
            <p>{error}</p>
            <button className="button secondary" onClick={() => void load()}>
              <Icon name="refresh" size={17} />
              {authRequired ? "Retry session" : "Try again"}
            </button>
          </div>
        )}
        {!loading && !error && sites.length === 0 && (
          <State
            title="No connected sites yet"
            text="Generate a pairing code above, then approve it from the site’s WordPress Admin."
          />
        )}
        {!loading && !error && sites.length > 0 && (
          <div className="site-list">
            {sites.map((site, index) => (
              <article className="site-row" key={String(site.id ?? `${site.site_url}-${index}`)}>
                <span className="site-logo">
                  <Icon name="wordpress" size={25} />
                </span>
                <div className="site-details">
                  <h3>{host(site.site_url)}</h3>
                  <a href={site.site_url} target="_blank" rel="noreferrer">
                    {site.site_url}
                  </a>
                </div>
                <button
                  className="button secondary inspect-button"
                  type="button"
                  onClick={() => void inspectSite(site)}
                  disabled={revokeBusy || typeof site.id !== "string" || (inspectionLoading && site.id === inspectedSiteId)}
                >
                  {inspectionLoading && site.id === inspectedSiteId ? "Inspecting…" : "Inspect site"}
                </button>
                <span className="status-pill success">
                  <i />
                  Connected
                </span>
              </article>
            ))}
          </div>
        )}
      </section>
      {inspectedSite && (
        <section className="panel inspection-panel" aria-labelledby="inspection-title">
          <div className="panel-heading">
            <div>
              <h2 id="inspection-title">Site inspection</h2>
              <p>{host(inspectedSite.site_url)} · safe metadata only</p>
            </div>
            <button
              className="button secondary"
              type="button"
              onClick={() => void inspectSite(inspectedSite)}
              disabled={inspectionLoading}
            >
              <Icon name="refresh" size={17} />
              {inspectionLoading ? "Inspecting…" : "Refresh inspection"}
            </button>
          </div>

          {inspectionLoading && (
            <State loading title="Inspecting connected site" text="Requesting current read-only metadata…" />
          )}

          {!inspectionLoading && inspectionError && (
            <div className="state-box error-state" role="alert">
              <span className="state-icon">!</span>
              <h3>Inspection unavailable</h3>
              <p>{inspectionError}</p>
              <button className="button secondary" onClick={() => void inspectSite(inspectedSite)}>
                Try again
              </button>
            </div>
          )}

          {!inspectionLoading && inspection && (
            <div className="inspection-content">
              <div className="inspection-summary">
                <div>
                  <span>Site title</span>
                  <strong>{decodeDisplayText(inspection.site.title)}</strong>
                  {inspection.site.description && (
                    <small>{decodeDisplayText(inspection.site.description)}</small>
                  )}
                </div>
                <div>
                  <span>WordPress</span>
                  <strong>{inspection.site.wordpress_version}</strong>
                  <small>PHP {inspection.site.php_version}</small>
                </div>
                <div>
                  <span>Active theme</span>
                  <strong>{decodeDisplayText(inspection.theme.name)}</strong>
                  <small>Version {inspection.theme.version}</small>
                </div>
                <div>
                  <span>Plugins</span>
                  <strong>{inspection.plugins.active} active</strong>
                  <small>{inspection.plugins.total} installed · {inspection.plugins.inactive} inactive</small>
                </div>
              </div>

              <div className="inspection-counts" aria-label="Content counts">
                <div><strong>{inspection.content.posts}</strong><span>Posts</span></div>
                <div><strong>{inspection.content.pages}</strong><span>Pages</span></div>
                <div><strong>{inspection.content.media}</strong><span>Media items</span></div>
              </div>

              <dl className="inspection-details">
                <div><dt>Site URL</dt><dd><a href={inspection.site.url} target="_blank" rel="noreferrer">{inspection.site.url}</a></dd></div>
                <div><dt>Language</dt><dd>{inspection.site.language}</dd></div>
                <div><dt>Timezone</dt><dd>{inspection.site.timezone || "Not configured"}</dd></div>
                <div><dt>Multisite</dt><dd>{inspection.site.multisite ? "Yes" : "No"}</dd></div>
                <div><dt>HTTPS</dt><dd>{inspection.site.https ? "Enabled" : "Not reported"}</dd></div>
                <div><dt>Theme stylesheet</dt><dd>{inspection.theme.stylesheet}</dd></div>
                <div><dt>Parent theme</dt><dd>{inspection.theme.parent ? decodeDisplayText(inspection.theme.parent) : "None"}</dd></div>
                <div><dt>Network-active plugins</dt><dd>{inspection.plugins.network_active}</dd></div>
                <div><dt>Inspected</dt><dd>{new Date(inspection.inspected_at).toLocaleString()}</dd></div>
              </dl>
              <div className="readonly-banner compact">
                <Icon name="shield" size={18} />
                <div>
                  <strong>Read-only inspection</strong>
                  <p>No content, settings, themes, or plugins can be changed from this view.</p>
                </div>
              </div>
            </div>
          )}
        </section>
      )}
      {inspectedSite && typeof inspectedSite.id === "string" && session?.access_token && <section className="panel connection-management" aria-labelledby="connection-management-title"><div className="panel-heading"><div><h2 id="connection-management-title">Connection management</h2><p>{host(inspectedSite.site_url)}</p></div><button className="button secondary" disabled={revokeBusy} onClick={()=>{setConfirmRevoke(true);setRevokeAgreed(false);setRevokeError('');}}>Revoke this connection</button></div>{confirmRevoke&&<div><p>Revocation removes this account’s access and invalidates pending grants. Reconnection requires a fresh pairing and WordPress approval.</p><label className="draft-approval-check"><input type="checkbox" checked={revokeAgreed} onChange={e=>setRevokeAgreed(e.target.checked)} disabled={revokeBusy}/>I want to revoke access to {host(inspectedSite.site_url)}.</label><div className="header-actions"><button className="button primary" disabled={!revokeAgreed||revokeBusy} onClick={()=>void revokeSelectedConnection()}>{revokeBusy?'Revoking…':'Confirm revocation'}</button><button className="button secondary" disabled={revokeBusy} onClick={()=>setConfirmRevoke(false)}>Keep connection</button></div></div>}{revokeError&&<p role="alert">{revokeError}</p>}</section>}
      {inspectedSite && typeof inspectedSite.id === "string" && session?.access_token && <WordPressDraftPanel key={inspectedSite.id} accessToken={session.access_token} connectionId={inspectedSite.id} siteUrl={inspectedSite.site_url}/>}
      {inspectedSite && typeof inspectedSite.id === "string" && session?.access_token && (
        <WordPressInventoryPanel accessToken={session.access_token} connectionId={inspectedSite.id} />
      )}
      {CONTROLLED_ACTION_UI_ENABLED && inspectedSite && typeof inspectedSite.id === "string" && session?.access_token && (
        <WordPressActionApprovalPanel
          accessToken={session.access_token}
          connectionId={inspectedSite.id}
          siteUrl={inspectedSite.site_url}
        />
      )}
    </div>
  );
}

function State({
  loading,
  title,
  text,
}: {
  loading?: boolean;
  title: string;
  text: string;
}) {
  return (
    <div className="state-box" role={loading ? "status" : undefined}>
      {loading ? (
        <span className="spinner" />
      ) : (
        <span className="state-icon site">
          <Icon name="site" size={29} />
        </span>
      )}
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}

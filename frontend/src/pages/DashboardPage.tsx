import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { Icon } from "../components/Icon";
import { getWordPressSites } from "../wp-manager/api";
import type { WordPressSite } from "../types/wordpress";
import { modules, workspacePath } from "../workspace/policy";
import { workspaceRequest } from "../workspace/api";

export function DashboardPage() {
  const { user, session } = useAuth();
  const [sites, setSites] = useState<WordPressSite[] | null>(null);
  const [error, setError] = useState("");
  const [workspaceError, setWorkspaceError] = useState("");
  const [verified, setVerified] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => { document.title = "Overview · A2Z GrowthSuite"; }, []);
  useEffect(() => {
    const controller = new AbortController();
    setSites(null); setError(""); setWorkspaceError(""); setVerified(false);
    void workspaceRequest<{ workspace: { id: string } }>(`/workspaces/${encodeURIComponent(user!.id)}`, session!.access_token, controller.signal)
      .then(data => { if (!controller.signal.aborted) { if (data.workspace.id !== user!.id) throw new Error("Workspace identity did not match your account."); setVerified(true); } })
      .catch(() => { if (!controller.signal.aborted) setWorkspaceError("Workspace access could not be verified. Please retry or sign in again."); });
    void getWordPressSites(session!.access_token, controller.signal).then(data => { if (!controller.signal.aborted) setSites(data); })
      .catch(() => { if (!controller.signal.aborted) setError("Connected sites could not be loaded. Your totals are unavailable."); });
    return () => controller.abort();
  }, [user!.id, session!.access_token, reload]);
  const path = (page: string) => workspacePath(user!.id, page);
  const name = typeof user?.user_metadata?.full_name === "string" ? user.user_metadata.full_name.trim().split(" ")[0] : "there";
  const connected = sites?.filter(site => site.status === "connected").length;
  return <div className="page-stack dashboard-page">
    <header className="page-header"><div><span className="eyebrow">Workspace overview</span><h1>Welcome back, {name || "there"}.</h1><p>A clear view of your properties. A focused place to grow.</p></div><button className="button secondary" onClick={() => setReload(value => value + 1)}><Icon name="refresh" size={17} />Refresh</button></header>
    <section className="dashboard-hero"><div><span className="hero-label">YOUR NEXT STEP</span><h2>Build your digital<br />home base.</h2><p>Connect your WordPress sites, review their health, and keep your work in one secure place.</p><Link className="button hero-button" to={path("wordpress")}>Open WordPress Manager <Icon name="arrow" size={17} /></Link></div><div className="hero-art" aria-hidden="true"><span className="orbit orbit-one" /><span className="orbit orbit-two" /><div className="hero-tile"><Icon name="wordpress" size={52} /></div><span className="hero-satellite"><Icon name="shield" size={22} /></span><span className="hero-caption">Connected. Organized. Yours.</span></div></section>
    {workspaceError && <div className="alert error" role="alert">{workspaceError}</div>}
    {error && <div className="alert warning" role="alert">{error}</div>}
    <section className="metric-grid" aria-label="Workspace status"><Metric label="Site connections" value={sites ? String(sites.length) : "—"} detail={error ? "Unavailable · retry to load" : sites ? "From your account inventory" : "Loading your inventory…"} icon="site" /><Metric label="Connected sites" value={connected === undefined ? "—" : String(connected)} detail="Confirmed connections only" icon="wordpress" /><Metric label="Workspace access" value={verified ? "Verified" : workspaceError ? "Unavailable" : "Checking"} detail="Personal · account-scoped" icon="shield" /></section>
    <div className="dashboard-columns"><section className="panel dashboard-panel"><div className="panel-heading"><div><span className="eyebrow">Your properties</span><h2>Connected workspace</h2></div><Link to={path("wordpress")} className="text-link">View manager →</Link></div>{sites?.length ? <div className="property-list">{sites.slice(0, 4).map((site, index) => <Link className="property-row" to={path("wordpress")} key={site.id ?? index}><span className="property-icon"><Icon name="wordpress" /></span><div><strong>{site.site_url}</strong><small>{site.status === "connected" ? "Connected" : site.status === "pending" ? "Pairing pending" : "Review in manager"}</small></div><Icon name="arrow" size={16} /></Link>)}</div> : <div className="dashboard-empty"><span className="empty-icon"><Icon name="site" size={30} /></span><h3>{error ? "Inventory unavailable" : sites ? "Your first connection starts here" : "Loading your properties…"}</h3><p>{error ? "We’ll only show totals when your inventory is available." : "Add a WordPress site to start reviewing it from your workspace."}</p><Link className="button secondary" to={path("wordpress")}>Manage sites</Link></div>}</section><section className="panel dashboard-panel"><div className="panel-heading"><div><span className="eyebrow">Getting started</span><h2>Make yourself at home</h2></div></div><ol className="onboarding-list"><li><span>01</span><div><strong>Your account is ready</strong><p>Signed in with your verified identity.</p><Link to={path("account")}>Review account →</Link></div></li><li><span>02</span><div><strong>Connect a digital property</strong><p>Use the manager’s secure pairing flow.</p><Link to={path("wordpress")}>Open manager →</Link></div></li><li><span>03</span><div><strong>Explore what’s next</strong><p>Future modules are listed below. They’re not available yet.</p></div></li></ol></section></div>
    <section><div className="section-heading"><div><span className="eyebrow">Room to grow</span><h2>Your future toolkit</h2></div><span className="muted">Planned modules · not yet available</span></div><div className="module-grid">{modules.map(module => <article className="module-card" key={module.id}><div className="module-card-top"><Icon name="site" /><span className="unavailable-badge">Unavailable</span></div><h3>{module.name}</h3><p>{module.description}</p><Link to={path(`modules/${module.id}`)}>View availability <Icon name="arrow" size={14} /></Link></article>)}</div></section>
  </div>;
}
function Metric({ label, value, detail, icon }: { label: string; value: string; detail: string; icon: "site" | "wordpress" | "shield" }) {
  return <article className="metric-card"><div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div><span className="metric-icon"><Icon name={icon} /></span></article>;
}

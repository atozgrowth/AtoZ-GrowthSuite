import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { Icon } from "../components/Icon";
import { workspaceRequest } from "../workspace/api";
import { workspacePath } from "../workspace/policy";
interface Overview { service: string; status: string; checkedAt: string; administrator: { id: string; email?: string }; modules: { name: string; available: boolean; detail: string }[] }
export function AdminDashboardPage() {
  const { session, user } = useAuth();
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => { document.title = "Administration · A2Z GrowthSuite"; }, []);
  useEffect(() => {
    const controller = new AbortController(); setData(null); setError("");
    void workspaceRequest<{ overview: Overview }>("/admin/overview", session!.access_token, controller.signal)
      .then(result => { if (!controller.signal.aborted) setData(result.overview); })
      .catch(caught => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "The administration service is unavailable."); });
    return () => controller.abort();
  }, [session!.access_token, reload]);
  return <div className="page-stack"><header className="page-header"><div><span className="eyebrow">Administration</span><h1>Platform overview</h1><p>Verify access and review the application’s available capabilities.</p></div><button className="button secondary" onClick={() => setReload(value => value + 1)}><Icon name="refresh" size={17} />Refresh status</button></header><section className="admin-banner"><Icon name="shield" size={28} /><div><strong>Administrator workspace</strong><p>Access is checked by the API. Platform-wide data and management actions are not implemented.</p></div></section>{error && <div className="alert error" role="alert">{error}</div>}<div className="metric-grid"><article className="metric-card"><div><span>API status</span><strong>{data ? data.status : error ? "Unavailable" : "Checking…"}</strong><small>Liveness only · not database readiness</small></div><Icon name="site" /></article><article className="metric-card"><div><span>Administrator access</span><strong>{data ? "Verified" : error ? "Unverified" : "Checking…"}</strong><small>{data ? "Confirmed by the API" : "Awaiting server authorization"}</small></div><Icon name="shield" /></article><article className="metric-card"><div><span>Organizations</span><strong>Unavailable</strong><small>Shared tenant management is not implemented</small></div><Icon name="account" /></article></div>{data && <section className="panel dashboard-panel"><div className="panel-heading"><div><span className="eyebrow">Capability directory</span><h2>Application modules</h2></div><small className="muted">Checked {new Date(data.checkedAt).toLocaleTimeString()}</small></div><div className="capability-list">{data.modules.map(module => <div key={module.name}><span className={`capability-dot ${module.available ? "available" : ""}`} /><div><strong>{module.name}</strong><p>{module.detail}</p></div><span className={module.available ? "status-pill success" : "unavailable-badge"}>{module.available ? "Available" : "Unavailable"}</span></div>)}</div></section>}<section className="panel session-panel"><div><h2>Your personal workspace</h2><p>Administrative access does not grant access to another account’s private workspace.</p></div><Link className="button secondary" to={workspacePath(user!.id)}>Open workspace <Icon name="arrow" size={16} /></Link></section></div>;
}

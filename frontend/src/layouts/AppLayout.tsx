import { useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { Brand } from "../components/Brand";
import { Icon } from "../components/Icon";
import { useAuth } from "../auth/useAuth";
import { isAdministrator, modules, workspacePath } from "../workspace/policy";

export function AppLayout() {
  const [open, setOpen] = useState(false);
  const { user, signOut } = useAuth();
  const [error, setError] = useState("");
  const [signingOut, setSigningOut] = useState(false);
  const location = useLocation();
  const path = (page: string) => workspacePath(user!.id, page);
  const admin = location.pathname.startsWith("/admin");
  const items = [{ to: path("dashboard"), label: "Overview", icon: "dashboard" as const }, { to: path("wordpress"), label: "WordPress Manager", icon: "wordpress" as const }, { to: path("account"), label: "Account settings", icon: "account" as const }];
  async function logout() {
    setSigningOut(true); setError("");
    try { await signOut(); } catch { setError("Sign out failed. Please try again."); setSigningOut(false); }
  }
  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Skip to content</a>
    <aside id="app-navigation" className={`sidebar ${open ? "is-open" : ""}`}>
      <div className="sidebar-brand"><Brand /></div>
      <div className="workspace-label"><span className="workspace-monogram">P</span><div><strong>Personal workspace</strong><small>Your account · {user!.id.slice(0, 8)}</small></div></div>
      <nav className="main-nav" aria-label="Main navigation"><p className="nav-label">Workspace</p>
        {items.map(item => <NavLink key={item.to} to={item.to} onClick={() => setOpen(false)} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}><Icon name={item.icon} /><span>{item.label}</span></NavLink>)}
        {isAdministrator(user) && <><p className="nav-label upcoming-label">Administration</p><NavLink to="/admin" onClick={() => setOpen(false)} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}><Icon name="shield" /><span>Admin overview</span></NavLink></>}
        <p className="nav-label upcoming-label">Explore modules</p>
        {modules.map(module => <NavLink key={module.id} to={path(`modules/${module.id}`)} onClick={() => setOpen(false)} className={({ isActive }) => `nav-link module-nav ${isActive ? "active" : ""}`}><Icon name="site" /><span>{module.name}</span><small>Unavailable</small></NavLink>)}

      </nav>
      <div className="sidebar-note"><Icon name="shield" /><div><strong>Account-scoped access</strong><span>Shared workspaces are not available yet.</span></div></div>
    </aside>
    {open && <button className="sidebar-scrim" aria-label="Close navigation" onClick={() => setOpen(false)} />}
    <div className="app-main"><header className="topbar"><button className="icon-button menu-button" aria-label={open ? "Close navigation menu" : "Open navigation"} aria-expanded={open} aria-controls="app-navigation" onClick={() => setOpen(!open)}><Icon name="menu" /></button><div className="mobile-brand"><Brand /></div><div className="topbar-context"><span className="live-dot" />{admin ? "Administration" : "Your growth workspace"}</div><div className="topbar-actions"><Link to={path("account")} className="user-chip" aria-label="Open account"><span className="avatar">{(user?.email?.[0] ?? "A").toUpperCase()}</span><span className="user-email">{user?.email}</span></Link><button className="signout-button" aria-label="Sign out" disabled={signingOut} onClick={logout}><Icon name="logout" size={18} /></button></div></header>
      <main id="main-content" className="content">{error && <div className="alert error" role="alert">{error}</div>}<Outlet /></main>
    </div>
  </div>;
}

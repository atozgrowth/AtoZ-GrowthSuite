import { Link, Navigate, Outlet, useParams } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { isAdministrator, workspacePath } from "./policy";

export function WorkspaceRedirect({ page = "dashboard" }: { page?: string }) {
  const { user } = useAuth();
  return <Navigate to={user ? workspacePath(user.id, page) : "/login"} replace />;
}
export function WorkspaceBoundary() {
  const { user } = useAuth();
  const { workspaceId } = useParams();
  if (workspaceId !== user?.id) return <main className="not-found"><span className="eyebrow">Access restricted</span><h1>Workspace unavailable</h1><p>This workspace is not available to your account.</p><Link className="button primary" to="/dashboard">Return to your workspace</Link></main>;
  return <Outlet />;
}
export function AdminBoundary() {
  const { user } = useAuth();
  if (!isAdministrator(user)) return <section className="panel access-panel"><span className="eyebrow">Access restricted</span><h1>Administrator access required</h1><p>Your account does not have access to the administration area.</p><Link className="button primary" to="/dashboard">Back to your workspace</Link></section>;
  return <Outlet />;
}

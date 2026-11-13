import { Link, useParams } from "react-router-dom";
import { modules, workspacePath } from "../workspace/policy";
import { useAuth } from "../auth/useAuth";
import { Icon } from "../components/Icon";
export function ModulePage() {
  const { moduleId } = useParams();
  const { user } = useAuth();
  const module = modules.find(value => value.id === moduleId);
  return <section className="panel module-placeholder"><span className="placeholder-icon"><Icon name="site" size={36} /></span><span className="unavailable-badge">Unavailable</span><h1>{module?.name ?? "Module not found"}</h1><p>{module?.detail ?? "This module does not exist in your workspace."}</p><p className="muted">No service is connected and no actions can be performed here.</p><Link className="button primary" to={workspacePath(user!.id)}>Back to overview</Link></section>;
}

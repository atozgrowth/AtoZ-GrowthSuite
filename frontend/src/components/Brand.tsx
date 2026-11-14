import { Link } from "react-router-dom";

/** Text identity until the original, verified logo assets are available locally. */
export function Brand() {
  return <Link className="brand" to="/dashboard" aria-label="A to Z Growth Suite dashboard">
    <span className="brand-name">A to Z <strong>Growth Suite</strong></span>
  </Link>;
}

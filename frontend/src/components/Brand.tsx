import { Link } from "react-router-dom";
export function Brand() { return <Link className="brand" to="/dashboard" aria-label="A to Z Growth dashboard"><span className="brand-mark" aria-hidden="true"><span>A</span><i>→</i><span>Z</span></span><span className="brand-name">A to Z <strong>Growth</strong></span></Link>; }

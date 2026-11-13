export function LoadingScreen({ label = "Loading…" }: { label?: string }) { return <div className="loading-screen" role="status"><span className="spinner" aria-hidden="true" />{label}</div>; }

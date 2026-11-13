import { resolveApiBase } from "../lib/apiBase";
export async function workspaceRequest<T>(path: string, token: string, signal?: AbortSignal): Promise<T> {
  if (!token) throw new Error("Please sign in to continue.");
  const response = await fetch(`${resolveApiBase(import.meta.env.VITE_API_BASE_URL)}${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, signal });
  if (!response.ok) throw new Error(response.status === 401 ? "Your session could not be verified. Please sign out and sign in again." : response.status === 403 ? "Your account does not have access to this information." : "We couldn’t load this information. Please try again.");
  return response.json() as Promise<T>;
}

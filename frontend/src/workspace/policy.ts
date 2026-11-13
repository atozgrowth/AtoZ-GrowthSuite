export function isAdministrator(user: { app_metadata?: Record<string, unknown> } | null | undefined) {
  return user?.app_metadata?.role === "admin";
}
export function workspacePath(userId: string, page = "dashboard") {
  return `/workspace/${encodeURIComponent(userId)}/${page}`;
}
export function safeDestination(value: unknown) {
  if (typeof value !== "string" || /[\\?#\s]/.test(value)) return "/dashboard";
  return /^\/(workspace\/[a-fA-F0-9]{8}-(?:[a-fA-F0-9]{4}-){3}[a-fA-F0-9]{12}\/(dashboard|wordpress|account|modules\/[a-z-]+)|admin|dashboard|wordpress|account)$/.test(value) ? value : "/dashboard";
}
export const modules = [
  { id: "analytics", name: "Analytics", description: "Understand performance across your digital properties.", detail: "Reporting pipelines and metric collection are not connected yet." },
  { id: "campaigns", name: "Campaigns", description: "Plan and manage your next growth initiative.", detail: "Campaign scheduling and delivery are not implemented yet." },
  { id: "team", name: "Team", description: "Collaborate with the people behind your business.", detail: "Shared workspaces, invitations and role management are not available yet." },
  { id: "billing", name: "Billing", description: "Review plans, subscriptions and invoices.", detail: "No payment provider or subscription system is connected yet." },
] as const;

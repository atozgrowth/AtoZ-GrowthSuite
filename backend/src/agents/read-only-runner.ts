/** Offline integration seam only: no HTTP route, model client, credentials or live adapters. */
import { randomUUID } from 'node:crypto';
export type Principal = Readonly<{
  userId: string;
  workspaceId: string;
  /** Supplied by server-owned resource bindings, never by model or client metadata. */
  siteIds: readonly string[];
  adsCustomerIds: readonly string[];
}>;
export type ToolName = 'wordpress.inventory' | 'googleAds.campaignReport';
export type ReadPlan = { tool: ToolName; resourceId: string };
export interface InterpretationProvider {
  interpret(untrustedRequest: string, signal: AbortSignal): Promise<unknown>;
}
export type ReadAdapter = (resourceId: string, signal: AbortSignal) => Promise<unknown>;
export class TransientReadError extends Error {}
export type Execution = {
  id: string;
  status: 'completed' | 'denied' | 'failed' | 'timed_out';
  attempts: number;
  durationMs: number;
  tool?: ToolName;
  result?: unknown;
};
export type AuditEvent = Pick<Execution, 'id' | 'status' | 'attempts' | 'tool'>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function parsePlan(value: unknown, principal: Principal): ReadPlan | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const plan = value as Record<string, unknown>;
  if (Object.keys(plan).sort().join(',') !== 'resourceId,tool' || typeof plan.resourceId !== 'string') return null;
  if (plan.tool === 'wordpress.inventory' && uuid.test(plan.resourceId) && principal.siteIds.includes(plan.resourceId)) return plan as ReadPlan;
  if (plan.tool === 'googleAds.campaignReport' && /^\d{10}$/.test(plan.resourceId) && principal.adsCustomerIds.includes(plan.resourceId)) return plan as ReadPlan;
  return null;
}
/** One deadline covers interpretation + bounded retry. Authorization never retries. */
export async function runReadOnlyAgent(input: {
  request: string;
  principal: Principal;
  provider: InterpretationProvider;
  adapters: Record<ToolName, ReadAdapter>;
  audit: (event: Readonly<AuditEvent>) => void;
  timeoutMs?: number;
}): Promise<Execution> {
  const started = Date.now();
  const id = randomUUID();
  let attempts = 0;
  let tool: ToolName | undefined;
  const finish = (status: Execution['status'], result?: unknown): Execution => {
    const execution = { id, status, attempts, durationMs: Date.now() - started, ...(tool ? { tool } : {}), ...(status === 'completed' ? { result } : {}) };
    // Caller owns persistence. Only bounded metadata is emitted, never prompt/results/errors/tokens.
    try { input.audit(Object.freeze({ id, status, attempts, ...(tool ? { tool } : {}) })); } catch { return { id, status: 'failed', attempts, durationMs: Date.now() - started }; }
    return execution;
  };
  const p = input.principal;
  if (!uuid.test(p.userId) || p.workspaceId !== p.userId || typeof input.request !== 'string' || !input.request.trim() || input.request.length > 8000) return finish('denied');
  // Copy server-owned bindings before asynchronous interpretation to avoid mutable-context races.
  const principal: Principal = Object.freeze({ ...p, siteIds: Object.freeze([...p.siteIds]), adsCustomerIds: Object.freeze([...p.adsCustomerIds]) });
  const timeoutMs = input.timeoutMs ?? 3000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) return finish('denied');
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = Symbol('deadline');
  const expired = new Promise<typeof timedOut>(resolve => {
    timer = setTimeout(() => { controller.abort(); resolve(timedOut); }, timeoutMs);
  });
  const work = async () => {
    const proposed = await input.provider.interpret(input.request, controller.signal);
    if (controller.signal.aborted) return timedOut;
    const plan = parsePlan(proposed, principal);
    if (!plan) return 'denied' as const;
    tool = plan.tool;
    for (let count = 0; count < 2; count++) {
      if (controller.signal.aborted) return timedOut;
      attempts++;
      try {
        const result = await input.adapters[plan.tool](plan.resourceId, controller.signal);
        if (controller.signal.aborted) return timedOut;
        // Bound detached JSON output; adapters must already sanitize provider fields.
        const encoded = JSON.stringify(result);
        if (!encoded || Buffer.byteLength(encoded) > 65536) throw new Error('Invalid result');
        return { result: JSON.parse(encoded) as unknown };
      } catch (error) {
        if (!(error instanceof TransientReadError) || count === 1 || controller.signal.aborted) throw error;
      }
    }
    throw new Error('Unreachable');
  };
  try {
    const outcome = await Promise.race([work(), expired]);
    if (outcome === timedOut) return finish('timed_out');
    if (outcome === 'denied') return finish('denied');
    return finish('completed', outcome.result);
  } catch { return finish(controller.signal.aborted ? 'timed_out' : 'failed'); }
  finally { if (timer) clearTimeout(timer); controller.abort(); }
}

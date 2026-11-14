/** Synthetic demonstration only; never import into the production server. */
import { runReadOnlyAgent, type AuditEvent } from './read-only-runner.js';
import { parseCampaignReport } from '../integrations/google-ads-report.js';
const userId = '10000000-0000-4000-8000-000000000001';
const siteId = '20000000-0000-4000-8000-000000000001';
const customerId = '1234567890';
const audit: AuditEvent[] = [];
const principal = { userId, workspaceId: userId, siteIds: [siteId], adsCustomerIds: [customerId] };
const adapters = {
  'wordpress.inventory': async () => ({ sites: [{ id: siteId, status: 'synthetic-fixture' }] }),
  'googleAds.campaignReport': async () => parseCampaignReport([{ campaign: { id: '101', name: 'Synthetic campaign', status: 'PAUSED' }, metrics: { impressions: '10', clicks: '1', costMicros: '1234567', conversions: '0' } }]),
};
const plans = [
  { tool: 'wordpress.inventory', resourceId: siteId },
  { tool: 'googleAds.campaignReport', resourceId: customerId },
  { tool: 'wordpress.inventory', resourceId: '20000000-0000-4000-8000-000000000002' },
  { tool: 'shell.exec', resourceId: siteId },
];
const executions = [];
for (const plan of plans) executions.push(await runReadOnlyAgent({
  request: 'Synthetic offline interpretation fixture', principal, adapters,
  provider: { interpret: async () => plan }, audit: event => { audit.push(event); },
}));
if (executions.map(e => e.status).join(',') !== 'completed,completed,denied,denied') throw new Error('Offline proof failed');
console.log(JSON.stringify({ synthetic: true, liveApiCalls: 0, modelApiCalls: 0, productionWritesEnabled: false, executions, audit }, null, 2));

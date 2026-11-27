import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCampaignReport } from './google-ads-report.js';
const row = { campaign: { id: '123', name: 'Synthetic campaign', status: 'PAUSED' }, metrics: { impressions: '100', clicks: '2', costMicros: '9007199254740993', conversions: '1.5' }, customer: { secret: 'never propagate' } };
test('selected report fields preserve int64 micros and exclude raw provider objects', () => {
  const [report] = parseCampaignReport([row]); assert.equal(report.costMicros, '9007199254740993'); assert.equal(report.conversions, 1.5);
  assert.ok(!JSON.stringify(report).includes('secret')); assert.deepEqual(parseCampaignReport([]), []);
});
test('malformed reports and duplicate IDs fail as a whole instead of partial totals', () => {
  for (const input of [null, {}, [null], [row,row], Array(501).fill(row), [{ ...row, metrics: { ...row.metrics, costMicros: 9007199254740993 } }], [{ ...row, metrics: { ...row.metrics, conversions: 'Infinity' } }], [{ ...row, campaign: { ...row.campaign, status: 'IMPORTED' } }], [{ ...row, metrics: { ...row.metrics, conversions: '0x10' } }]]) assert.throws(() => parseCampaignReport(input));
});

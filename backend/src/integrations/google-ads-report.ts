/** Offline parser for selected official Google Ads Search response fields. No OAuth/network. */
export type CampaignReport = {
  id: string; name: string; status: string;
  impressions: string; clicks: string; costMicros: string; conversions: number;
};
const integer = (value: unknown): string => {
  if (typeof value !== 'string' || !/^\d{1,30}$/.test(value)) throw new Error('Invalid report integer');
  return value;
};
export function parseCampaignReport(value: unknown): CampaignReport[] {
  if (!Array.isArray(value) || value.length > 500) throw new Error('Invalid report envelope');
  const seen = new Set<string>();
  return value.map(row => {
    if (!row || typeof row !== 'object' || !row.campaign || !row.metrics) throw new Error('Invalid report row');
    const { campaign, metrics } = row;
    const id = integer(campaign.id);
    if (seen.has(id) || typeof campaign.name !== 'string' || campaign.name.length > 500 || !['ENABLED','PAUSED','REMOVED','UNKNOWN','UNSPECIFIED'].includes(campaign.status)) throw new Error('Invalid campaign');
    seen.add(id);
    const conversions = Number(metrics.conversions);
    if (!['string','number'].includes(typeof metrics.conversions) || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(String(metrics.conversions)) || String(metrics.conversions).length > 40 || !Number.isFinite(conversions) || conversions < 0) throw new Error('Invalid conversions');
    // int64 values stay strings, preserving micros beyond JS safe integer precision.
    return { id, name: campaign.name, status: campaign.status, impressions: integer(metrics.impressions), clicks: integer(metrics.clicks), costMicros: integer(metrics.costMicros), conversions };
  });
}

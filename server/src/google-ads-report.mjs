import { normalizeAdPerformanceRows } from "./ad-performance.mjs";

export function buildGoogleAdsQuery({ since, until }) {
  return `SELECT customer.id, customer.currency_code, campaign.id, campaign.name, segments.date, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value FROM campaign WHERE segments.date BETWEEN '${since}' AND '${until}' LIMIT 500`;
}

export function mapGoogleAdsSearchStream(response) {
  const chunks = Array.isArray(response) ? response : [response];
  const rows = chunks.flatMap(chunk => Array.isArray(chunk?.results) ? chunk.results : []);
  return normalizeAdPerformanceRows(rows.map(row => ({
    platform: "google-ads",
    accountId: row.customer?.id,
    campaignId: row.campaign?.id,
    campaignName: row.campaign?.name,
    adGroupId: row.adGroup?.id,
    adGroupName: row.adGroup?.name,
    adId: row.adGroupAd?.ad?.id,
    adName: row.adGroupAd?.ad?.name,
    date: row.segments?.date,
    currency: row.customer?.currencyCode,
    impressions: row.metrics?.impressions,
    clicks: row.metrics?.clicks,
    cost: row.metrics?.costMicros === undefined ? null : Number(row.metrics.costMicros) / 1_000_000,
    conversions: row.metrics?.conversions,
    revenue: row.metrics?.conversionsValue
  })));
}

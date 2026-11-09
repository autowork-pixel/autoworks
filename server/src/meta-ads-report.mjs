import { normalizeAdPerformanceRows } from "./ad-performance.mjs";

const purchaseTypes = ["omni_purchase", "purchase", "offsite_conversion.fb_pixel_purchase"];

function actionValue(items, field = "value") {
  if (!Array.isArray(items)) return null;
  for (const type of purchaseTypes) {
    const item = items.find(candidate => candidate?.action_type === type);
    if (item?.[field] !== undefined && item?.[field] !== null) return item[field];
  }
  return null;
}

export function mapMetaAdsInsights(response, { accountId = null, currency = null } = {}) {
  const rows = Array.isArray(response) ? response : response?.data;
  return normalizeAdPerformanceRows((rows || []).map(row => ({
    platform: "meta-ads",
    accountId: row.account_id || accountId,
    campaignId: row.campaign_id,
    campaignName: row.campaign_name,
    adGroupId: row.adset_id,
    adGroupName: row.adset_name,
    adId: row.ad_id,
    adName: row.ad_name,
    date: row.date_start,
    currency: row.account_currency || currency,
    impressions: row.impressions,
    clicks: row.clicks,
    cost: row.spend,
    conversions: actionValue(row.actions),
    revenue: actionValue(row.action_values),
    attributionWindow: row.attribution_setting
  })));
}

export function buildMetaAdsInsightsUrl({ graphVersion = "v24.0", adAccountId, since, until }) {
  const account = String(adAccountId || "").replace(/^act_/, "");
  const url = new URL(`https://graph.facebook.com/${graphVersion}/act_${account}/insights`);
  url.searchParams.set("level", "ad");
  url.searchParams.set("fields", "account_id,account_currency,campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,date_start,impressions,clicks,spend,actions,action_values,attribution_setting");
  url.searchParams.set("time_range", JSON.stringify({ since, until }));
  return url;
}

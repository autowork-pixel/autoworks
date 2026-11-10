import { normalizeAdPerformanceRows } from "./ad-performance.mjs";

export function buildKakaoMomentReportUrl({ level = "CAMPAIGN", since, until }) {
  const url = new URL("https://apis.moment.kakao.com/openapi/v4/adAccounts/report");
  url.searchParams.set("level", level);
  url.searchParams.set("metricsGroup", "BASIC");
  url.searchParams.set("start", String(since).replaceAll("-", ""));
  url.searchParams.set("end", String(until).replaceAll("-", ""));
  return url;
}

export function mapKakaoMomentReport(response, { accountId = null, currency = "KRW" } = {}) {
  const rows = Array.isArray(response) ? response : response?.data;
  return normalizeAdPerformanceRows((rows || []).map(row => {
    const dimensions = row.dimensions || row.dimension || {};
    const metrics = row.metrics || {};
    return {
      platform: "kakao-moment",
      accountId: dimensions.ad_account_id || dimensions.adAccountId || accountId,
      campaignId: dimensions.campaign_id || dimensions.campaignId,
      campaignName: dimensions.campaign_name || dimensions.campaignName,
      adGroupId: dimensions.ad_group_id || dimensions.adGroupId,
      adGroupName: dimensions.ad_group_name || dimensions.adGroupName,
      adId: dimensions.creative_id || dimensions.creativeId,
      adName: dimensions.creative_name || dimensions.creativeName,
      date: dimensions.date || row.start || row.date,
      currency,
      impressions: metrics.imp,
      clicks: metrics.click,
      cost: metrics.cost,
      conversions: null,
      revenue: null
    };
  }));
}

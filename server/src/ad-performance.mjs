import { ApiError } from "./domain.mjs";

const platforms = new Set(["meta-ads", "google-ads", "kakao-moment"]);

function optionalText(value, name, maximum = 160) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" && typeof value !== "number") {
    throw new ApiError("INVALID_PROVIDER_RESPONSE", `${name} 형식이 올바르지 않습니다.`);
  }
  const normalized = String(value).trim();
  if (!normalized || normalized.length > maximum || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new ApiError("INVALID_PROVIDER_RESPONSE", `${name} 형식이 올바르지 않습니다.`);
  }
  return normalized;
}

function optionalMetric(value, name) {
  if (value === undefined || value === null || value === "") return null;
  const normalized = typeof value === "number" ? value : Number(String(value).replaceAll(",", ""));
  if (!Number.isFinite(normalized) || normalized < 0 || normalized > 1e15) {
    throw new ApiError("INVALID_PROVIDER_RESPONSE", `${name} 수치가 올바르지 않습니다.`);
  }
  return normalized;
}

function ratio(numerator, denominator, multiplier = 1) {
  return numerator === null || denominator === null || denominator <= 0 ? null : numerator / denominator * multiplier;
}

export function normalizeAdPerformanceRow(row) {
  if (!row || typeof row !== "object" || Array.isArray(row) || !platforms.has(row.platform)) {
    throw new ApiError("INVALID_PROVIDER_RESPONSE", "광고 성과 행 형식이 올바르지 않습니다.");
  }
  const impressions = optionalMetric(row.impressions, "impressions");
  const clicks = optionalMetric(row.clicks, "clicks");
  const cost = optionalMetric(row.cost, "cost");
  const conversions = optionalMetric(row.conversions, "conversions");
  const revenue = optionalMetric(row.revenue, "revenue");
  return {
    platform: row.platform,
    accountId: optionalText(row.accountId, "accountId", 128),
    campaignId: optionalText(row.campaignId, "campaignId", 128),
    campaignName: optionalText(row.campaignName, "campaignName"),
    adGroupId: optionalText(row.adGroupId, "adGroupId", 128),
    adGroupName: optionalText(row.adGroupName, "adGroupName"),
    adId: optionalText(row.adId, "adId", 128),
    adName: optionalText(row.adName, "adName"),
    date: optionalText(row.date, "date", 10),
    currency: optionalText(row.currency, "currency", 8),
    impressions, clicks, cost, conversions, revenue,
    ctr: ratio(clicks, impressions, 100),
    cpc: ratio(cost, clicks),
    cvr: ratio(conversions, clicks, 100),
    roas: ratio(revenue, cost, 100),
    attributionWindow: optionalText(row.attributionWindow, "attributionWindow", 80)
  };
}

export function normalizeAdPerformanceRows(rows) {
  if (!Array.isArray(rows) || rows.length > 10000) {
    throw new ApiError("INVALID_PROVIDER_RESPONSE", "광고 성과 행 개수가 올바르지 않습니다.");
  }
  return rows.map(normalizeAdPerformanceRow);
}

export function summarizeAdPerformance(rows) {
  const normalized = normalizeAdPerformanceRows(rows);
  const sum = key => normalized.reduce((total, row) => total + (row[key] ?? 0), 0);
  const present = key => normalized.some(row => row[key] !== null);
  const totals = {
    impressions: present("impressions") ? sum("impressions") : null,
    clicks: present("clicks") ? sum("clicks") : null,
    cost: present("cost") ? sum("cost") : null,
    conversions: present("conversions") ? sum("conversions") : null,
    revenue: present("revenue") ? sum("revenue") : null
  };
  return { rowCount: normalized.length, total: normalizeAdPerformanceRow({ platform: normalized[0]?.platform || "meta-ads", ...totals }) };
}

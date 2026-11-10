import assert from "node:assert/strict";
import test from "node:test";
import { normalizeAdPerformanceRow, summarizeAdPerformance } from "../src/ad-performance.mjs";

test("공통 광고 성과 스키마는 비율을 계산하고 미제공 지표를 구분한다", () => {
  const row = normalizeAdPerformanceRow({
    platform: "meta-ads", campaignName: "가을 캠페인", impressions: "1,000", clicks: "50", cost: "25000"
  });
  assert.equal(row.ctr, 5);
  assert.equal(row.cpc, 500);
  assert.equal(row.conversions, null);
  assert.equal(row.cvr, null);
  assert.equal(row.roas, null);
});

test("합계는 제공되지 않은 전환·매출을 0으로 오인하지 않는다", () => {
  const summary = summarizeAdPerformance([
    { platform: "google-ads", impressions: 100, clicks: 10, cost: 1000, conversions: null, revenue: null },
    { platform: "google-ads", impressions: 200, clicks: 20, cost: 3000, conversions: null, revenue: null }
  ]);
  assert.equal(summary.rowCount, 2);
  assert.equal(summary.total.impressions, 300);
  assert.equal(summary.total.conversions, null);
  assert.equal(summary.total.roas, null);
});

test("음수·무한대·지원하지 않는 매체를 거부한다", () => {
  for (const row of [
    { platform: "unknown", cost: 1 },
    { platform: "meta-ads", cost: -1 },
    { platform: "meta-ads", clicks: Number.POSITIVE_INFINITY }
  ]) assert.throws(() => normalizeAdPerformanceRow(row), error => error.code === "INVALID_PROVIDER_RESPONSE");
});

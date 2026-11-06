import assert from "node:assert/strict";
import test from "node:test";
import { mapAdProviderResponse } from "../src/ad-provider-registry.mjs";
import { buildGoogleAdsQuery, mapGoogleAdsSearchStream } from "../src/google-ads-report.mjs";
import { buildKakaoMomentReportUrl, mapKakaoMomentReport } from "../src/kakao-moment-report.mjs";
import { buildMetaAdsInsightsUrl, mapMetaAdsInsights } from "../src/meta-ads-report.mjs";

test("Meta Insights 응답을 공통 스키마로 변환한다", () => {
  const [row] = mapMetaAdsInsights({ data: [{
    account_id: "11", campaign_id: "22", campaign_name: "Meta A", adset_id: "33", ad_id: "44",
    date_start: "2026-11-01", account_currency: "KRW", impressions: "1000", clicks: "30", spend: "12000",
    actions: [{ action_type: "purchase", value: "2" }],
    action_values: [{ action_type: "purchase", value: "36000" }]
  }] });
  assert.deepEqual([row.platform, row.campaignName, row.conversions, row.roas], ["meta-ads", "Meta A", 2, 300]);
  assert.equal(buildMetaAdsInsightsUrl({ adAccountId: "act_11", since: "2026-11-01", until: "2026-11-06" }).searchParams.get("level"), "ad");
});

test("Google Ads searchStream 응답과 costMicros를 변환한다", () => {
  const response = [{ results: [{
    customer: { id: "1", currencyCode: "KRW" }, campaign: { id: "2", name: "Search" },
    adGroup: { id: "3", name: "Group" }, adGroupAd: { ad: { id: "4", name: "Ad" } },
    segments: { date: "2026-11-05" }, metrics: { impressions: "500", clicks: "25", costMicros: "1250000000", conversions: 3, conversionsValue: 5000 }
  }] }];
  const [row] = mapGoogleAdsSearchStream(response);
  assert.equal(row.cost, 1250);
  assert.equal(row.cvr, 12);
  assert.match(buildGoogleAdsQuery({ since: "2026-11-01", until: "2026-11-06" }), /segments\.date BETWEEN/);
});

test("카카오모먼트 BASIC 응답은 전환 미제공 상태를 보존한다", () => {
  const [row] = mapKakaoMomentReport({ data: [{
    start: "2026-11-06", dimensions: { campaign_id: 7, creative_id: 8 },
    metrics: { imp: 300, click: 6, cost: 9000 }
  }] }, { accountId: "99" });
  assert.equal(row.accountId, "99");
  assert.equal(row.campaignId, "7");
  assert.equal(row.date, "2026-11-06");
  assert.equal(row.conversions, null);
  assert.equal(row.roas, null);
  const url = buildKakaoMomentReportUrl({ since: "2026-11-01", until: "2026-11-06" });
  assert.equal(url.searchParams.get("metricsGroup"), "BASIC");
  assert.equal(url.searchParams.get("level"), "CAMPAIGN");
  assert.equal(url.searchParams.get("start"), "20261101");
});

test("레지스트리는 공급자별 변환기만 노출하고 비밀값을 결과에 섞지 않는다", () => {
  const [row] = mapAdProviderResponse("meta-ads", { data: [{ impressions: 1, clicks: 0, spend: 0, access_token: "secret" }] });
  assert.equal("access_token" in row, false);
  assert.throws(() => mapAdProviderResponse("naver-gfa", {}), /Unsupported ad provider/);
});

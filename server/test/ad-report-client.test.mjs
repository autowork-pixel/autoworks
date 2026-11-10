import assert from "node:assert/strict";
import test from "node:test";
import { fetchAdReport } from "../src/ad-report-client.mjs";

const input = { since: "2026-10-01", until: "2026-10-07" };
const response = body => ({ ok: true, status: 200, json: async () => body });

test("Meta 토큰은 URL이 아닌 인증 헤더에만 넣는다", async () => {
  let request;
  const rows = await fetchAdReport({ provider: "meta-ads", input, credentials: { accessToken: "meta-secret", adAccountId: "123" },
    fetchImpl: async (url, options) => { request = { url: String(url), options }; return response({ data: [{ impressions: "10", clicks: "2", spend: "3" }] }); } });
  assert.equal(request.options.headers.authorization, "Bearer meta-secret");
  assert.equal(request.url.includes("meta-secret"), false);
  assert.equal(rows[0].platform, "meta-ads");
});

test("Google OAuth 갱신 뒤 v26 searchStream을 호출한다", async () => {
  const requests = [];
  const rows = await fetchAdReport({ provider: "google-ads", input, credentials: { developerToken: "dev", clientId: "client", clientSecret: "secret",
    refreshToken: "refresh", customerId: "123-456", loginCustomerId: "999-000" }, fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      if (requests.length === 1) return response({ access_token: "short-lived" });
      return response([{ results: [{ customer: { id: "123456", currencyCode: "KRW" }, campaign: { id: "1", name: "검색" }, metrics: { impressions: "5", clicks: "1", costMicros: "1000000" } }] }]);
    } });
  assert.equal(requests[0].url, "https://oauth2.googleapis.com/token");
  assert.match(requests[1].url, /v26\/customers\/123456\/googleAds:searchStream$/);
  assert.equal(requests[1].options.headers["login-customer-id"], "999000");
  assert.equal(requests[1].options.body.includes("2026-10-01"), true);
  assert.equal(rows[0].cost, 1);
  assert.equal(JSON.stringify(rows).includes("short-lived"), false);
});

test("카카오 비즈니스 토큰과 광고계정은 헤더로 전달한다", async () => {
  let request;
  const rows = await fetchAdReport({ provider: "kakao-moment", input, credentials: { businessAccessToken: "kakao-secret", adAccountId: "77" },
    fetchImpl: async (url, options) => { request = { url: String(url), options }; return response({ data: [{ start: "2026-10-01", dimensions: { campaign_id: "1" }, metrics: { imp: 4, click: 1, cost: 100 } }] }); } });
  assert.equal(request.options.headers.authorization, "Bearer kakao-secret");
  assert.equal(request.options.headers.adAccountId, "77");
  assert.equal(request.url.includes("kakao-secret"), false);
  assert.equal(rows[0].conversions, null);
});

test("제공자 오류 본문과 인증정보를 노출하지 않는다", async () => {
  await assert.rejects(() => fetchAdReport({ provider: "meta-ads", input, credentials: { accessToken: "secret", adAccountId: "1" },
    fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ detail: "secret provider detail" }) }) }), error => {
      assert.equal(error.code, "PROVIDER_AUTH_FAILED");
      assert.equal(error.message.includes("secret"), false);
      return true;
    });
});

import { ApiError } from "./domain.mjs";
import { buildGoogleAdsQuery, mapGoogleAdsSearchStream } from "./google-ads-report.mjs";
import { buildKakaoMomentReportUrl, mapKakaoMomentReport } from "./kakao-moment-report.mjs";
import { buildMetaAdsInsightsUrl, mapMetaAdsInsights } from "./meta-ads-report.mjs";

async function providerJson(url, options, fetchImpl) {
  let response;
  try { response = await fetchImpl(url, { ...options, redirect: "error", signal: AbortSignal.timeout(20_000) }); }
  catch { throw new ApiError("PROVIDER_UNAVAILABLE", "광고 매체 API에 연결하지 못했습니다.", 503); }
  if (!response.ok) {
    const code = [400, 401, 403].includes(response.status) ? "PROVIDER_AUTH_FAILED" : response.status === 429 ? "PROVIDER_RATE_LIMIT" : "PROVIDER_UNAVAILABLE";
    throw new ApiError(code, "광고 매체 보고서를 불러오지 못했습니다.", response.status === 429 ? 429 : 502);
  }
  try { return await response.json(); }
  catch { throw new ApiError("PROVIDER_INVALID_RESPONSE", "광고 매체 응답을 읽지 못했습니다.", 502); }
}

async function meta({ input, credentials, fetchImpl }) {
  const url = buildMetaAdsInsightsUrl({ adAccountId: credentials.adAccountId, since: input.since, until: input.until });
  const payload = await providerJson(url, { headers: { accept: "application/json", authorization: `Bearer ${credentials.accessToken}` } }, fetchImpl);
  return mapMetaAdsInsights(payload, { accountId: credentials.adAccountId });
}

async function google({ input, credentials, fetchImpl }) {
  const tokenBody = new URLSearchParams({ client_id: credentials.clientId, client_secret: credentials.clientSecret,
    refresh_token: credentials.refreshToken, grant_type: "refresh_token" });
  const token = await providerJson("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body: tokenBody }, fetchImpl);
  if (typeof token.access_token !== "string" || !token.access_token) throw new ApiError("PROVIDER_AUTH_FAILED", "Google Ads 인증을 갱신하지 못했습니다.", 502);
  const customerId = credentials.customerId.replaceAll("-", "");
  const headers = { accept: "application/json", "content-type": "application/json", authorization: `Bearer ${token.access_token}`,
    "developer-token": credentials.developerToken };
  if (credentials.loginCustomerId) headers["login-customer-id"] = credentials.loginCustomerId.replaceAll("-", "");
  const payload = await providerJson(`https://googleads.googleapis.com/v26/customers/${customerId}/googleAds:searchStream`, {
    method: "POST", headers, body: JSON.stringify({ query: buildGoogleAdsQuery(input) })
  }, fetchImpl);
  return mapGoogleAdsSearchStream(payload);
}

async function kakao({ input, credentials, fetchImpl }) {
  const url = buildKakaoMomentReportUrl(input);
  const payload = await providerJson(url, { headers: { accept: "application/json", authorization: `Bearer ${credentials.businessAccessToken}`,
    adAccountId: credentials.adAccountId } }, fetchImpl);
  return mapKakaoMomentReport(payload, { accountId: credentials.adAccountId });
}

const clients = Object.freeze({ "meta-ads": meta, "google-ads": google, "kakao-moment": kakao });

export async function fetchAdReport({ provider, input, credentials, fetchImpl = fetch }) {
  const client = clients[provider];
  if (!client) throw new ApiError("INVALID_INPUT", "지원하지 않는 광고 매체입니다.");
  const rows = await client({ input, credentials, fetchImpl });
  if (!rows.length) throw new ApiError("PROVIDER_NO_DATA", "선택한 기간에 광고 성과 데이터가 없습니다.", 404);
  return rows;
}

import { ApiError } from "./domain.mjs";

const endpoint = "https://naverapihub.apigw.ntruss.com/search-trend/v1/search";

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}
function shiftDate(value, days) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
}
function providerError(status) {
  if (status === 401 || status === 403) return new ApiError("PROVIDER_AUTH_FAILED", "NAVER API HUB 인증 또는 검색어 트렌드 권한을 확인해 주세요.", 409);
  if (status === 429) return new ApiError("PROVIDER_RATE_LIMIT", "NAVER API HUB 호출 한도를 초과했습니다.", 429);
  return new ApiError("PROVIDER_UNAVAILABLE", "NAVER API HUB 검색어 트렌드를 조회하지 못했습니다.", 502);
}
export function trendDateRange({ now = new Date(), displayPeriodDays }) {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const today = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()));
  today.setUTCDate(today.getUTCDate() - 1);
  const endDate = isoDate(today);
  const queryDays = Math.max(30, Number(displayPeriodDays) || 0);
  return { startDate: shiftDate(endDate, -(queryDays - 1)), endDate };
}
export async function fetchSearchTrends({ credentials, keywords, startDate, endDate, fetchImpl = fetch }) {
  if (!credentials?.clientId || !credentials?.clientSecret) throw new ApiError("PROVIDER_CREDENTIAL_REQUIRED", "NAVER API HUB 검색어 트렌드 연결이 필요합니다.", 409);
  const values = new Map();
  for (let index = 0; index < keywords.length; index += 5) {
    const batch = keywords.slice(index, index + 5);
    let response;
    try {
      response = await fetchImpl(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", "x-ncp-apigw-api-key-id": credentials.clientId, "x-ncp-apigw-api-key": credentials.clientSecret },
        body: JSON.stringify({ startDate, endDate, timeUnit: "date", keywordGroups: batch.map(keyword => ({ groupName: keyword, keywords: [keyword] })) }),
        signal: AbortSignal.timeout(15_000)
      });
    } catch {
      throw new ApiError("PROVIDER_UNAVAILABLE", "NAVER API HUB 검색어 트렌드에 연결하지 못했습니다.", 503);
    }
    if (!response.ok) throw providerError(response.status);
    let payload;
    try { payload = await response.json(); }
    catch { throw new ApiError("PROVIDER_INVALID_RESPONSE", "검색어 트렌드 응답을 읽지 못했습니다.", 502); }
    if (!Array.isArray(payload?.results)) throw new ApiError("PROVIDER_INVALID_RESPONSE", "검색어 트렌드 응답 형식이 올바르지 않습니다.", 502);
    for (const result of payload.results) {
      const keyword = String(result?.title || "");
      const data = Array.isArray(result?.data) ? result.data.map(item => ({ date: String(item?.period || ""), ratio: Number(item?.ratio) })).filter(item => /^\d{4}-\d{2}-\d{2}$/.test(item.date) && Number.isFinite(item.ratio) && item.ratio >= 0) : [];
      if (keyword && data.length) values.set(keyword, data);
    }
  }
  return values;
}
export function estimateDailyVolumes({ volume, trend, displayPeriodDays, roundingUnit, endDate }) {
  if (!Array.isArray(trend) || !trend.length) throw new ApiError("PROVIDER_NO_DATA", "데이터랩 일별 추이를 찾지 못했습니다.", 404);
  const byDate = new Map(trend.map(item => [item.date, item.ratio]));
  const calibrationStart = shiftDate(endDate, -29);
  const ratioSum = [...byDate].filter(([date]) => date >= calibrationStart && date <= endDate).reduce((sum, [, ratio]) => sum + ratio, 0);
  if (!(ratioSum > 0)) throw new ApiError("PROVIDER_NO_DATA", "데이터랩 최근 30일 추이를 찾지 못했습니다.", 404);
  const unit = [1, 10, 100].includes(roundingUnit) ? roundingUnit : 1;
  const round = value => Math.round(value / unit) * unit;
  const startDate = shiftDate(endDate, -(displayPeriodDays - 1));
  const rows = [];
  for (let date = startDate; date <= endDate; date = shiftDate(date, 1)) {
    const ratio = Number(byDate.get(date) || 0);
    const pc = round(volume.pc * ratio / ratioSum);
    const mobile = round(volume.mobile * ratio / ratioSum);
    rows.push({ date, ratio, pc, mobile, total: pc + mobile });
  }
  return rows;
}

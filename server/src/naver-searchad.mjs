import { createHmac } from "node:crypto";
import { ApiError } from "./domain.mjs";

const baseUrl = "https://api.searchad.naver.com";
const keywordToolPath = "/keywordstool";

export function createSearchAdSignature({ timestamp, method, path, secretKey }) {
  return createHmac("sha256", secretKey)
    .update(`${timestamp}.${method.toUpperCase()}.${path}`, "utf8")
    .digest("base64");
}

export function createSearchAdHeaders({ apiKey, secretKey, customerId, timestamp = Date.now() }) {
  const value = String(timestamp);
  return {
    "content-type": "application/json; charset=UTF-8",
    "x-timestamp": value,
    "x-api-key": apiKey,
    "x-customer": String(customerId),
    "x-signature": createSearchAdSignature({ timestamp: value, method: "GET", path: keywordToolPath, secretKey })
  };
}

function monthlyCount(value) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === "string") {
    const normalized = value.trim().replaceAll(",", "");
    if (/^<\s*10$/.test(normalized)) return 0;
    if (/^\d+$/.test(normalized)) return Number(normalized);
  }
  throw new ApiError("PROVIDER_INVALID_RESPONSE", "검색광고 응답 형식이 올바르지 않습니다.", 502);
}

export function mapKeywordToolResponse(payload, requestedKeyword) {
  if (!payload || !Array.isArray(payload.keywordList)) {
    throw new ApiError("PROVIDER_INVALID_RESPONSE", "검색광고 응답 형식이 올바르지 않습니다.", 502);
  }
  const compact = value => String(value || "").replaceAll(" ", "").toLowerCase();
  const row = payload.keywordList.find(item => compact(item?.relKeyword) === compact(requestedKeyword));
  if (!row) throw new ApiError("PROVIDER_NO_DATA", "요청한 키워드의 검색량을 찾지 못했습니다.", 404);
  const pc = monthlyCount(row.monthlyPcQcCnt);
  const mobile = monthlyCount(row.monthlyMobileQcCnt);
  return { keyword: String(row.relKeyword), pc, mobile, total: pc + mobile };
}

export async function fetchKeywordVolume({ credentials, keyword, fetchImpl = fetch, timestamp = Date.now() }) {
  const query = new URLSearchParams({ hintKeywords: keyword, showDetail: "1" });
  const response = await fetchImpl(`${baseUrl}${keywordToolPath}?${query}`, {
    method: "GET",
    headers: createSearchAdHeaders({ ...credentials, timestamp }),
    signal: AbortSignal.timeout(10_000)
  });
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new ApiError("PROVIDER_INVALID_RESPONSE", "검색광고 응답을 읽지 못했습니다.", 502);
  }
  if (!response.ok) {
    const status = response.status === 401 || response.status === 403 ? 409 : response.status === 429 ? 429 : 502;
    const code = status === 409 ? "PROVIDER_AUTH_FAILED" : status === 429 ? "PROVIDER_RATE_LIMIT" : "PROVIDER_UNAVAILABLE";
    throw new ApiError(code, "검색광고 제공자 요청에 실패했습니다.", status);
  }
  return mapKeywordToolResponse(payload, keyword);
}

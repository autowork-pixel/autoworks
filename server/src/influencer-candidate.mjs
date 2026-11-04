import { createHash } from "node:crypto";
import { ApiError } from "./domain.mjs";

function text(value, label, maximum) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) throw new ApiError("INVALID_INPUT", `${label} 값이 올바르지 않습니다.`);
  return value.trim();
}

export function normalizeInfluencerCandidateInput(body) {
  if (!body || typeof body !== "object" || Array.isArray(body) || !/^[A-Za-z0-9_-]{1,128}$/.test(body.projectId || "") || !/^[A-Za-z0-9_-]{16,128}$/.test(body.idempotencyKey || "")) throw new ApiError("INVALID_INPUT", "인플루언서 후보 요청 정보가 올바르지 않습니다.");
  if (!Array.isArray(body.keywords) || body.keywords.length < 1 || body.keywords.length > 5) throw new ApiError("INVALID_INPUT", "키워드는 1~5개여야 합니다.");
  const keywords = [...new Set(body.keywords.map(value => text(value, "키워드", 80)))];
  if (!Number.isSafeInteger(body.subscriberMin) || !Number.isSafeInteger(body.subscriberMax) || body.subscriberMin < 0 || body.subscriberMax < body.subscriberMin || body.subscriberMax > 1_000_000_000) throw new ApiError("INVALID_INPUT", "구독자 범위가 올바르지 않습니다.");
  if (!Number.isInteger(body.candidateCount) || body.candidateCount < 5 || body.candidateCount > 25) throw new ApiError("INVALID_INPUT", "후보 수는 5~25여야 합니다.");
  return { projectId: body.projectId, brand: text(body.brand, "브랜드", 80), keywords, subscriberMin: body.subscriberMin, subscriberMax: body.subscriberMax, candidateCount: body.candidateCount, idempotencyKey: body.idempotencyKey };
}

export function influencerCandidateDigest(input) {
  const { idempotencyKey, ...stable } = input;
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

function count(value) {
  if (value == null) return null;
  if (!/^\d+$/.test(String(value))) throw new ApiError("PROVIDER_INVALID_RESPONSE", "YouTube 채널 지표 형식이 올바르지 않습니다.", 502);
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new ApiError("PROVIDER_INVALID_RESPONSE", "YouTube 채널 지표 범위를 초과했습니다.", 502);
  return number;
}

async function youtubeJson(endpoint, fetchImpl) {
  let response;
  try { response = await fetchImpl(endpoint, { redirect: "error", signal: AbortSignal.timeout(15_000), headers: { accept: "application/json" } }); }
  catch { throw new ApiError("PROVIDER_UNAVAILABLE", "YouTube API에 연결하지 못했습니다.", 503); }
  if (!response.ok) {
    const code = [400, 401, 403].includes(response.status) ? "PROVIDER_AUTH_FAILED" : response.status === 429 ? "PROVIDER_RATE_LIMIT" : "PROVIDER_UNAVAILABLE";
    throw new ApiError(code, "YouTube 채널 검색에 실패했습니다.", response.status === 429 ? 429 : 502);
  }
  try { return await response.json(); }
  catch { throw new ApiError("PROVIDER_INVALID_RESPONSE", "YouTube 응답을 읽지 못했습니다.", 502); }
}

export async function searchInfluencerCandidates({ input, apiKey, fetchImpl = fetch, now = () => new Date() }) {
  if (typeof apiKey !== "string" || !apiKey) throw new ApiError("PROVIDER_CREDENTIAL_REQUIRED", "YouTube API 키 연결이 필요합니다.", 409);
  const capturedAt = now().toISOString(), query = [input.brand, ...input.keywords].join(" ").slice(0, 500);
  const searchEndpoint = new URL("https://www.googleapis.com/youtube/v3/search");
  searchEndpoint.search = new URLSearchParams({ part: "snippet", type: "channel", maxResults: "50", q: query, regionCode: "KR", relevanceLanguage: "ko", safeSearch: "moderate", key: apiKey }).toString();
  const searchPayload = await youtubeJson(searchEndpoint, fetchImpl);
  const ids = [...new Set((Array.isArray(searchPayload?.items) ? searchPayload.items : []).map(item => item?.id?.channelId).filter(id => typeof id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(id)))];
  if (!ids.length) throw new ApiError("PROVIDER_NO_DATA", "조건에 맞는 공개 채널을 찾지 못했습니다.", 404);
  const channelsEndpoint = new URL("https://www.googleapis.com/youtube/v3/channels");
  channelsEndpoint.search = new URLSearchParams({ part: "snippet,statistics", id: ids.join(","), key: apiKey }).toString();
  const payload = await youtubeJson(channelsEndpoint, fetchImpl);
  const rows = (Array.isArray(payload?.items) ? payload.items : []).map(item => {
    const hidden = item?.statistics?.hiddenSubscriberCount === true, subscribers = hidden ? null : count(item?.statistics?.subscriberCount);
    return { platform: "YouTube", channelId: String(item?.id || ""), channelTitle: String(item?.snippet?.title || "제목 없음").slice(0, 200), description: String(item?.snippet?.description || "").slice(0, 1000), channelUrl: `https://www.youtube.com/channel/${encodeURIComponent(String(item?.id || ""))}`, thumbnailUrl: String(item?.snippet?.thumbnails?.medium?.url || item?.snippet?.thumbnails?.default?.url || "").slice(0, 1000), subscriberCount: subscribers, subscriberCountHidden: hidden, videoCount: count(item?.statistics?.videoCount), viewCount: count(item?.statistics?.viewCount), contactStatus: "공개 API는 이메일을 제공하지 않음 · 연락 전 사람이 검토", capturedAt };
  }).filter(item => item.channelId && item.subscriberCount != null && item.subscriberCount >= input.subscriberMin && item.subscriberCount <= input.subscriberMax)
    .sort((a, b) => b.subscriberCount - a.subscriberCount).slice(0, input.candidateCount);
  if (!rows.length) throw new ApiError("PROVIDER_NO_DATA", "구독자 범위에 맞는 공개 채널을 찾지 못했습니다.", 404);
  return { query, capturedAt, rows };
}

import { createHash } from "node:crypto";
import { ApiError } from "./domain.mjs";

const periods = new Set([7, 28, 90, 180]);

function cleanText(value, label, maximum) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new ApiError("INVALID_INPUT", `${label} 값이 올바르지 않습니다.`);
  }
  return value.trim();
}

function cleanList(value, label, maximum = 5) {
  if (!Array.isArray(value) || value.length < 1 || value.length > maximum) throw new ApiError("INVALID_INPUT", `${label}은 1~${maximum}개여야 합니다.`);
  const result = [...new Set(value.map(item => cleanText(item, label, 80)))];
  if (!result.length) throw new ApiError("INVALID_INPUT", `${label} 값이 필요합니다.`);
  return result;
}

export function normalizeContentReferenceInput(body) {
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(body.projectId || "") ||
      !/^[A-Za-z0-9_-]{16,128}$/.test(body.idempotencyKey || "")) {
    throw new ApiError("INVALID_INPUT", "콘텐츠 레퍼런스 요청 정보가 올바르지 않습니다.");
  }
  const strengths = body.strengths == null || body.strengths.length === 0 ? [] : cleanList(body.strengths, "강점");
  if (!periods.has(body.periodDays) || !Number.isInteger(body.collectCount) || body.collectCount < 5 || body.collectCount > 25) {
    throw new ApiError("INVALID_INPUT", "기간 또는 수집 개수가 올바르지 않습니다.");
  }
  return {
    projectId: body.projectId,
    brand: cleanText(body.brand, "브랜드", 80),
    category: cleanText(body.category, "카테고리", 80),
    keywords: cleanList(body.keywords, "키워드"),
    target: cleanText(body.target, "타깃 고객", 120),
    strengths,
    periodDays: body.periodDays,
    collectCount: body.collectCount,
    idempotencyKey: body.idempotencyKey
  };
}

export function contentReferenceDigest(input) {
  const { idempotencyKey, ...stable } = input;
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

function count(value) {
  if (value == null) return null;
  if (!/^\d+$/.test(String(value))) throw new ApiError("PROVIDER_INVALID_RESPONSE", "YouTube 지표 형식이 올바르지 않습니다.", 502);
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new ApiError("PROVIDER_INVALID_RESPONSE", "YouTube 지표 범위를 초과했습니다.", 502);
  return number;
}

async function youtubeJson(endpoint, fetchImpl) {
  let response;
  try { response = await fetchImpl(endpoint, { redirect: "error", signal: AbortSignal.timeout(15_000), headers: { accept: "application/json" } }); }
  catch { throw new ApiError("PROVIDER_UNAVAILABLE", "YouTube API에 연결하지 못했습니다.", 503); }
  if (!response.ok) {
    const code = [400, 401, 403].includes(response.status) ? "PROVIDER_AUTH_FAILED" : response.status === 429 ? "PROVIDER_RATE_LIMIT" : "PROVIDER_UNAVAILABLE";
    throw new ApiError(code, "YouTube 콘텐츠 검색에 실패했습니다.", response.status === 429 ? 429 : 502);
  }
  try { return await response.json(); }
  catch { throw new ApiError("PROVIDER_INVALID_RESPONSE", "YouTube 응답을 읽지 못했습니다.", 502); }
}

export async function searchContentReferences({ input, apiKey, fetchImpl = fetch, now = () => new Date() }) {
  if (typeof apiKey !== "string" || !apiKey) throw new ApiError("PROVIDER_CREDENTIAL_REQUIRED", "YouTube API 키 연결이 필요합니다.", 409);
  const capturedAt = now();
  const publishedAfter = new Date(capturedAt.getTime() - input.periodDays * 86_400_000).toISOString();
  const query = [input.brand, input.category, ...input.keywords].join(" ").slice(0, 500);
  const searchEndpoint = new URL("https://www.googleapis.com/youtube/v3/search");
  searchEndpoint.search = new URLSearchParams({ part: "snippet", type: "video", order: "viewCount", maxResults: String(input.collectCount), q: query,
    publishedAfter, regionCode: "KR", relevanceLanguage: "ko", safeSearch: "moderate", key: apiKey }).toString();
  const searchPayload = await youtubeJson(searchEndpoint, fetchImpl);
  const ids = [...new Set((Array.isArray(searchPayload?.items) ? searchPayload.items : []).map(item => item?.id?.videoId)
    .filter(id => /^[A-Za-z0-9_-]{11}$/.test(id)))].slice(0, input.collectCount);
  if (!ids.length) throw new ApiError("PROVIDER_NO_DATA", "조건에 맞는 공개 영상을 찾지 못했습니다.", 404);
  const videosEndpoint = new URL("https://www.googleapis.com/youtube/v3/videos");
  videosEndpoint.search = new URLSearchParams({ part: "snippet,statistics", id: ids.join(","), key: apiKey }).toString();
  const videosPayload = await youtubeJson(videosEndpoint, fetchImpl);
  const byId = new Map((Array.isArray(videosPayload?.items) ? videosPayload.items : []).map(item => [item?.id, item]));
  const rows = ids.map(videoId => {
    const item = byId.get(videoId);
    if (!item?.snippet || !item?.statistics) return null;
    const views = count(item.statistics.viewCount), likes = count(item.statistics.likeCount), comments = count(item.statistics.commentCount);
    return {
      platform: "YouTube", videoId, sourceUrl: `https://www.youtube.com/watch?v=${videoId}`,
      title: String(item.snippet.title || "제목 없음").slice(0, 300), channelTitle: String(item.snippet.channelTitle || "채널 정보 없음").slice(0, 200),
      thumbnailUrl: String(item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url || "").slice(0, 1000),
      publishedAt: item.snippet.publishedAt || null, viewCount: views, likeCount: likes, commentCount: comments,
      engagementRate: views && likes != null && comments != null ? Number((((likes + comments) / views) * 100).toFixed(2)) : null,
      capturedAt: capturedAt.toISOString()
    };
  }).filter(Boolean);
  if (!rows.length) throw new ApiError("PROVIDER_NO_DATA", "공개 지표가 있는 영상을 찾지 못했습니다.", 404);
  return { query, publishedAfter, capturedAt: capturedAt.toISOString(), rows };
}

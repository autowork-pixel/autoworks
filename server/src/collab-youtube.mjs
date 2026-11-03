import { ApiError } from "./domain.mjs";

const videoIdPattern = /^[A-Za-z0-9_-]{11}$/;

export function parseYouTubeVideoUrl(input) {
  let url;
  try { url = new URL(input); }
  catch { throw new ApiError("INVALID_INPUT", "YouTube 게시물 URL이 올바르지 않습니다."); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash ||
      !["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"].includes(host)) {
    throw new ApiError("INVALID_INPUT", "지원하지 않는 YouTube URL입니다.");
  }
  const segments = url.pathname.split("/").filter(Boolean);
  let id = "";
  if (host === "youtu.be" && segments.length === 1) id = segments[0];
  else if (host !== "youtu.be" && segments.length === 1 && segments[0] === "watch") id = url.searchParams.get("v") || "";
  else if (host !== "youtu.be" && segments.length === 2 && ["shorts", "live"].includes(segments[0])) id = segments[1];
  if (!videoIdPattern.test(id)) throw new ApiError("INVALID_INPUT", "YouTube 동영상 ID를 찾을 수 없습니다.");
  return { videoId: id, url: `https://www.youtube.com/watch?v=${id}` };
}

function count(value) {
  if (value === undefined) return null;
  if (!/^\d+$/.test(String(value))) throw new ApiError("PROVIDER_INVALID_RESPONSE", "YouTube 지표 형식이 올바르지 않습니다.", 502);
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new ApiError("PROVIDER_INVALID_RESPONSE", "YouTube 지표 범위를 초과했습니다.", 502);
  return number;
}

export async function fetchYouTubePost({ videoId, apiKey, fetchImpl = fetch }) {
  if (!videoIdPattern.test(videoId) || typeof apiKey !== "string" || !apiKey) {
    throw new ApiError("INVALID_INPUT", "YouTube 조회 정보가 올바르지 않습니다.");
  }
  const endpoint = new URL("https://www.googleapis.com/youtube/v3/videos");
  endpoint.search = new URLSearchParams({ part: "snippet,statistics", id: videoId, key: apiKey }).toString();
  let response;
  try { response = await fetchImpl(endpoint, { redirect: "error", signal: AbortSignal.timeout(10_000) }); }
  catch { throw new ApiError("PROVIDER_UNAVAILABLE", "YouTube 조회에 실패했습니다.", 502); }
  if (!response.ok) {
    const code = [400, 401, 403].includes(response.status) ? "PROVIDER_AUTH_FAILED" : response.status === 429 ? "PROVIDER_RATE_LIMIT" : "PROVIDER_UNAVAILABLE";
    throw new ApiError(code, "YouTube 조회에 실패했습니다.", response.status === 429 ? 429 : 502);
  }
  let payload;
  try { payload = await response.json(); }
  catch { throw new ApiError("PROVIDER_INVALID_RESPONSE", "YouTube 응답을 읽지 못했습니다.", 502); }
  if (!Array.isArray(payload?.items)) throw new ApiError("PROVIDER_INVALID_RESPONSE", "YouTube 응답 형식이 올바르지 않습니다.", 502);
  const item = payload.items.find(value => value?.id === videoId);
  if (!item) throw new ApiError("PROVIDER_NO_DATA", "공개 동영상을 찾지 못했습니다.", 404);
  return {
    platform: "YouTube", videoId, url: `https://www.youtube.com/watch?v=${videoId}`,
    title: typeof item.snippet?.title === "string" ? item.snippet.title.slice(0, 200) : "",
    views: count(item.statistics?.viewCount), likes: count(item.statistics?.likeCount),
    comments: count(item.statistics?.commentCount), capturedAt: new Date().toISOString()
  };
}

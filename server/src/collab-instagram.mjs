import { createHash } from "node:crypto";
import { ApiError } from "./domain.mjs";

const shortcodePattern = /^[A-Za-z0-9_-]{4,64}$/;

export function parseInstagramPostUrl(input) {
  let url;
  try { url = new URL(input); }
  catch { throw new ApiError("INVALID_INPUT", "Instagram 게시물 URL이 올바르지 않습니다."); }
  if (url.protocol !== "https:" || !["instagram.com", "www.instagram.com"].includes(url.hostname.toLowerCase()) ||
      url.username || url.password || url.port || url.hash) {
    throw new ApiError("INVALID_INPUT", "지원하지 않는 Instagram URL입니다.");
  }
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length !== 2 || !["p", "reel", "reels"].includes(segments[0]) || !shortcodePattern.test(segments[1])) {
    throw new ApiError("INVALID_INPUT", "Instagram 게시물 코드를 찾을 수 없습니다.");
  }
  const type = segments[0] === "p" ? "p" : "reel";
  return { shortcode: segments[1], url: `https://www.instagram.com/${type}/${segments[1]}/` };
}

export function normalizeCollabInstagramInput(body) {
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(body.projectId || "") ||
      !/^[A-Za-z0-9_-]{16,128}$/.test(body.idempotencyKey || "")) {
    throw new ApiError("INVALID_INPUT", "협업 게시물 요청 정보가 올바르지 않습니다.");
  }
  const post = parseInstagramPostUrl(body.url);
  return { projectId: body.projectId, idempotencyKey: body.idempotencyKey, ...post };
}

export function collabInstagramDigest(input) {
  return createHash("sha256").update(JSON.stringify({ projectId: input.projectId, shortcode: input.shortcode })).digest("hex");
}

function count(value) {
  if (value === undefined || value === null) return null;
  const number = Number(value);
  // Instagram Scraper uses -1 when a public metric is hidden or unavailable.
  // Preserve that distinction instead of treating it as a real zero or a broken response.
  if (number === -1) return null;
  if (!Number.isSafeInteger(number) || number < 0) throw new ApiError("PROVIDER_INVALID_RESPONSE", "Instagram 지표 형식이 올바르지 않습니다.", 502);
  return number;
}

export async function fetchInstagramPost({ shortcode, url, token, fetchImpl = fetch }) {
  if (!shortcodePattern.test(shortcode) || parseInstagramPostUrl(url).shortcode !== shortcode || typeof token !== "string" || !token) {
    throw new ApiError("INVALID_INPUT", "Instagram 조회 정보가 올바르지 않습니다.");
  }
  let response;
  try {
    response = await fetchImpl("https://api.apify.com/v2/acts/apify~instagram-scraper/run-sync-get-dataset-items?timeout=180&memory=1024", {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(190_000),
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ directUrls: [url], resultsLimit: 1 })
    });
  } catch { throw new ApiError("PROVIDER_UNAVAILABLE", "Instagram 조회에 실패했습니다.", 502); }
  if (!response.ok) {
    const code = [401, 403].includes(response.status) ? "PROVIDER_AUTH_FAILED" : response.status === 429 ? "PROVIDER_RATE_LIMIT" : "PROVIDER_UNAVAILABLE";
    throw new ApiError(code, "Instagram 조회에 실패했습니다.", response.status === 429 ? 429 : 502);
  }
  let payload;
  try { payload = await response.json(); }
  catch { throw new ApiError("PROVIDER_INVALID_RESPONSE", "Instagram 응답을 읽지 못했습니다.", 502); }
  if (!Array.isArray(payload)) throw new ApiError("PROVIDER_INVALID_RESPONSE", "Instagram 응답 형식이 올바르지 않습니다.", 502);
  const item = payload.find(value => {
    if (value?.shortCode === shortcode) return true;
    try { return parseInstagramPostUrl(value?.url || value?.inputUrl).shortcode === shortcode; }
    catch { return false; }
  });
  if (!item) throw new ApiError("PROVIDER_NO_DATA", "공개 게시물을 찾지 못했습니다.", 404);
  const media = String(item.type || item.mediaType || "").toLowerCase();
  const isVideo = media.includes("video") || media.includes("reel") || ["videoPlayCount", "videoViewCount", "videoDuration"].some(key => item[key] != null);
  return {
    platform: "Instagram", shortcode, url, contentType: isVideo ? "릴스/영상" : "피드(이미지/캐러셀)",
    title: String(item.caption || "").slice(0, 200),
    views: isVideo ? count(item.videoPlayCount ?? item.videoViewCount ?? item.playCount) : null,
    likes: count(item.likesCount ?? item.likeCount), comments: count(item.commentsCount ?? item.commentCount),
    viewsStatus: isVideo ? "조회수 제공 여부 확인" : "조회수 미제공(피드)", capturedAt: new Date().toISOString()
  };
}

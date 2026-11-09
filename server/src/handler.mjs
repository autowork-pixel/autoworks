import { ApiError, newRequestId, normalizeBrandSearchInput, normalizeProjectInput } from "./domain.mjs";
import { normalizeWeeklyAdReport } from "./weekly-ad-report.mjs";
import { normalizeCollabYouTubeInput } from "./collab-youtube.mjs";
import { normalizeCollabInstagramInput } from "./collab-instagram.mjs";
import { normalizeContentReferenceInput } from "./content-reference.mjs";
import { normalizeInfluencerCandidateInput } from "./influencer-candidate.mjs";
import { normalizeAiBlogInput } from "./ai-blog.mjs";
import { normalizeNaverVisibilityInput } from "./naver-search-visibility.mjs";
import { normalizeContentPackInput } from "./content-pack.mjs";

const maximumBodyBytes = 64 * 1024;

function json(response, status, body, requestId) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "x-request-id": requestId
  });
  response.end(JSON.stringify(body));
}

function csvCell(value) {
  const text = String(value ?? "");
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

function csv(response, report, runId, requestId) {
  const header = ["키워드", "PC 월간 검색량", "모바일 월간 검색량", "합계", "기준시각"];
  const rows = report.rows.map(item => {
    const recordedAt = item.recordedAt instanceof Date ? item.recordedAt : item.recordedAt?.toDate?.();
    return [item.keyword, item.pc, item.mobile, item.total, recordedAt instanceof Date ? recordedAt.toISOString() : String(item.recordedAt || "")];
  });
  const body = `\ufeff${[header, ...rows].map(row => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
  response.writeHead(200, {
    "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="brand-search-${runId}.csv"`,
    "cache-control": "no-store", "x-content-type-options": "nosniff", "x-request-id": requestId
  });
  response.end(body);
}

async function readJson(request) {
  let size = 0;
  let tooLarge = false;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maximumBodyBytes) {
      tooLarge = true;
      continue;
    }
    chunks.push(chunk);
  }
  if (tooLarge) throw new ApiError("INVALID_INPUT", "요청 본문이 너무 큽니다.", 413);
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ApiError("INVALID_INPUT", "JSON 형식이 올바르지 않습니다.");
  }
}

function bearer(request) {
  const value = request.headers.authorization;
  const match = typeof value === "string" && value.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new ApiError("AUTH_REQUIRED", "로그인이 필요합니다.", 401);
  return match[1];
}

export function createHandler({ verifyIdToken, repository, credentialService, collabYouTubeService, collabInstagramService, contentReferenceService, influencerCandidateService, aiBlogService, naverVisibilityService, contentPackService, taskDispatcher, logger = console }) {
  return async function handler(request, response) {
    const requestId = newRequestId();
    try {
      if (request.method === "GET" && request.url === "/health-check") {
        return json(response, 200, { ok: true }, requestId);
      }
      const projectMatch = request.url?.match(/^\/v1\/workspaces\/([A-Za-z0-9_-]{1,128})\/projects$/);
      if (request.method === "POST" && projectMatch) {
        if (!String(request.headers["content-type"] || "").toLowerCase().startsWith("application/json")) {
          throw new ApiError("INVALID_INPUT", "Content-Type은 application/json이어야 합니다.", 415);
        }
        const token = bearer(request);
        let decoded;
        try {
          decoded = await verifyIdToken(token);
        } catch {
          throw new ApiError("AUTH_REQUIRED", "로그인을 다시 확인해주세요.", 401);
        }
        if (!decoded?.uid) throw new ApiError("AUTH_REQUIRED", "로그인을 다시 확인해주세요.", 401);
        const result = await repository.createProject({
          workspaceId: projectMatch[1], uid: decoded.uid, input: normalizeProjectInput(await readJson(request))
        });
        return json(response, 201, { ...result, requestId }, requestId);
      }
      const weeklyMatch = request.url?.match(/^\/v1\/workspaces\/([A-Za-z0-9_-]{1,128})\/weekly-ad-reports$/);
      if (request.method === "POST" && weeklyMatch) {
        if (!String(request.headers["content-type"] || "").toLowerCase().startsWith("application/json")) {
          throw new ApiError("INVALID_INPUT", "Content-Type은 application/json이어야 합니다.", 415);
        }
        let decoded;
        try { decoded = await verifyIdToken(bearer(request)); }
        catch { throw new ApiError("AUTH_REQUIRED", "로그인을 다시 확인해주세요.", 401); }
        if (!decoded?.uid) throw new ApiError("AUTH_REQUIRED", "로그인을 다시 확인해주세요.", 401);
        const input = normalizeWeeklyAdReport(await readJson(request));
        const result = await repository.saveWeeklyAdReport({ workspaceId: weeklyMatch[1], uid: decoded.uid, input });
        return json(response, result.reused ? 200 : 201, { ...result, requestId }, requestId);
      }
      const collabMatch = request.url?.match(/^\/v1\/workspaces\/([A-Za-z0-9_-]{1,128})\/collab-youtube-runs$/);
      if (request.method === "POST" && collabMatch && collabYouTubeService) {
        if (!String(request.headers["content-type"] || "").toLowerCase().startsWith("application/json")) {
          throw new ApiError("INVALID_INPUT", "Content-Type은 application/json이어야 합니다.", 415);
        }
        let decoded;
        try { decoded = await verifyIdToken(bearer(request)); }
        catch { throw new ApiError("AUTH_REQUIRED", "로그인을 다시 확인해주세요.", 401); }
        if (!decoded?.uid) throw new ApiError("AUTH_REQUIRED", "로그인을 다시 확인해주세요.", 401);
        const input = normalizeCollabYouTubeInput(await readJson(request));
        const result = await collabYouTubeService.run({ workspaceId: collabMatch[1], uid: decoded.uid, input });
        return json(response, result.reused ? 200 : 201, { ...result, requestId }, requestId);
      }
      const instagramMatch = request.url?.match(/^\/v1\/workspaces\/([A-Za-z0-9_-]{1,128})\/collab-instagram-runs$/);
      if (request.method === "POST" && instagramMatch && collabInstagramService) {
        if (!String(request.headers["content-type"] || "").toLowerCase().startsWith("application/json")) {
          throw new ApiError("INVALID_INPUT", "Content-Type은 application/json이어야 합니다.", 415);
        }
        let decoded;
        try { decoded = await verifyIdToken(bearer(request)); }
        catch { throw new ApiError("AUTH_REQUIRED", "로그인을 다시 확인해주세요.", 401); }
        if (!decoded?.uid) throw new ApiError("AUTH_REQUIRED", "로그인을 다시 확인해주세요.", 401);
        const input = normalizeCollabInstagramInput(await readJson(request));
        const result = await collabInstagramService.run({ workspaceId: instagramMatch[1], uid: decoded.uid, input });
        return json(response, result.reused ? 200 : 201, { ...result, requestId }, requestId);
      }
      const referenceMatch = request.url?.match(/^\/v1\/workspaces\/([A-Za-z0-9_-]{1,128})\/content-reference-runs$/);
      if (request.method === "POST" && referenceMatch && contentReferenceService) {
        if (!String(request.headers["content-type"] || "").toLowerCase().startsWith("application/json")) {
          throw new ApiError("INVALID_INPUT", "Content-Type은 application/json이어야 합니다.", 415);
        }
        let decoded;
        try { decoded = await verifyIdToken(bearer(request)); }
        catch { throw new ApiError("AUTH_REQUIRED", "로그인을 다시 확인해주세요.", 401); }
        if (!decoded?.uid) throw new ApiError("AUTH_REQUIRED", "로그인을 다시 확인해주세요.", 401);
        const input = normalizeContentReferenceInput(await readJson(request));
        const result = await contentReferenceService.run({ workspaceId: referenceMatch[1], uid: decoded.uid, input });
        return json(response, result.reused ? 200 : 201, { ...result, requestId }, requestId);
      }
      const influencerMatch = request.url?.match(/^\/v1\/workspaces\/([A-Za-z0-9_-]{1,128})\/influencer-candidate-runs$/);
      if (request.method === "POST" && influencerMatch && influencerCandidateService) {
        if (!String(request.headers["content-type"] || "").toLowerCase().startsWith("application/json")) throw new ApiError("INVALID_INPUT", "Content-Type은 application/json이어야 합니다.", 415);
        let decoded;
        try { decoded = await verifyIdToken(bearer(request)); }
        catch { throw new ApiError("AUTH_REQUIRED", "로그인을 다시 확인해주세요.", 401); }
        if (!decoded?.uid) throw new ApiError("AUTH_REQUIRED", "로그인을 다시 확인해주세요.", 401);
        const input = normalizeInfluencerCandidateInput(await readJson(request));
        const result = await influencerCandidateService.run({ workspaceId: influencerMatch[1], uid: decoded.uid, input });
        return json(response, result.reused ? 200 : 201, { ...result, requestId }, requestId);
      }
      const aiBlogMatch = request.url?.match(/^\/v1\/workspaces\/([A-Za-z0-9_-]{1,128})\/ai-blog-runs$/);
      if (request.method === "POST" && aiBlogMatch && aiBlogService) {
        if (!String(request.headers["content-type"] || "").toLowerCase().startsWith("application/json")) throw new ApiError("INVALID_INPUT", "Content-Type은 application/json이어야 합니다.", 415);
        let decoded;
        try { decoded = await verifyIdToken(bearer(request)); } catch { throw new ApiError("AUTH_REQUIRED", "로그인을 다시 확인해주세요.", 401); }
        if (!decoded?.uid) throw new ApiError("AUTH_REQUIRED", "로그인을 다시 확인해주세요.", 401);
        const result = await aiBlogService.run({ workspaceId: aiBlogMatch[1], uid: decoded.uid, input: normalizeAiBlogInput(await readJson(request)) });
        return json(response, result.reused ? 200 : 201, { ...result, requestId }, requestId);
      }
      const visibilityMatch = request.url?.match(/^\/v1\/workspaces\/([A-Za-z0-9_-]{1,128})\/naver-visibility-runs$/);
      if(request.method==="POST"&&visibilityMatch&&naverVisibilityService){if(!String(request.headers["content-type"]||"").toLowerCase().startsWith("application/json"))throw new ApiError("INVALID_INPUT","Content-Type은 application/json이어야 합니다.",415);let decoded;try{decoded=await verifyIdToken(bearer(request))}catch{throw new ApiError("AUTH_REQUIRED","로그인을 다시 확인해주세요.",401)}if(!decoded?.uid)throw new ApiError("AUTH_REQUIRED","로그인을 다시 확인해주세요.",401);const result=await naverVisibilityService.run({workspaceId:visibilityMatch[1],uid:decoded.uid,input:normalizeNaverVisibilityInput(await readJson(request))});return json(response,result.reused?200:201,{...result,requestId},requestId)}
      const packMatch=request.url?.match(/^\/v1\/workspaces\/([A-Za-z0-9_-]{1,128})\/content-pack-runs$/);if(request.method==="POST"&&packMatch&&contentPackService){if(!String(request.headers["content-type"]||"").toLowerCase().startsWith("application/json"))throw new ApiError("INVALID_INPUT","Content-Type은 application/json이어야 합니다.",415);let decoded;try{decoded=await verifyIdToken(bearer(request))}catch{throw new ApiError("AUTH_REQUIRED","로그인을 다시 확인해주세요.",401)}if(!decoded?.uid)throw new ApiError("AUTH_REQUIRED","로그인을 다시 확인해주세요.",401);const result=await contentPackService.run({workspaceId:packMatch[1],uid:decoded.uid,input:normalizeContentPackInput(await readJson(request))});return json(response,result.reused?200:201,{...result,requestId},requestId)}
      const credentialMatch = request.url?.match(/^\/v1\/workspaces\/([A-Za-z0-9_-]{1,128})\/provider-credentials\/(naver-searchad|naver-search|youtube|apify|openai|meta-ads|google-ads|kakao-moment)$/);
      if (credentialMatch && credentialService) {
        const token = bearer(request);
        let decoded;
        try {
          decoded = await verifyIdToken(token);
        } catch {
          throw new ApiError("AUTH_REQUIRED", "로그인을 다시 확인해주세요.", 401);
        }
        if (!decoded?.uid) throw new ApiError("AUTH_REQUIRED", "로그인을 다시 확인해주세요.", 401);
        const context = { workspaceId: credentialMatch[1], provider: credentialMatch[2], uid: decoded.uid };
        if (request.method === "GET") return json(response, 200, await credentialService.status(context), requestId);
        if (request.method === "DELETE") return json(response, 200, await credentialService.remove(context), requestId);
        if (request.method === "PUT") {
          if (!String(request.headers["content-type"] || "").toLowerCase().startsWith("application/json")) {
            throw new ApiError("INVALID_INPUT", "Content-Type은 application/json이어야 합니다.", 415);
          }
          return json(response, 200, await credentialService.save({ ...context, credentials: await readJson(request) }), requestId);
        }
        throw new ApiError("NOT_FOUND", "요청 경로를 찾을 수 없습니다.", 404);
      }
      const cancelMatch = request.url?.match(/^\/v1\/workspaces\/([A-Za-z0-9_-]{1,128})\/brand-search-runs\/([A-Za-z0-9_-]{1,128}):cancel$/);
      if (request.method === "POST" && cancelMatch) {
        const token = bearer(request);
        let decoded;
        try {
          decoded = await verifyIdToken(token);
        } catch {
          throw new ApiError("AUTH_REQUIRED", "로그인을 다시 확인해주세요.", 401);
        }
        if (!decoded?.uid) throw new ApiError("AUTH_REQUIRED", "로그인을 다시 확인해주세요.", 401);
        const result = await repository.cancelBrandSearchRun({ workspaceId: cancelMatch[1], runId: cancelMatch[2], uid: decoded.uid });
        return json(response, 200, { runId: cancelMatch[2], status: result.status, reused: Boolean(result.reused), requestId }, requestId);
      }
      const reportMatch = request.url?.match(/^\/v1\/workspaces\/([A-Za-z0-9_-]{1,128})\/brand-search-runs\/([A-Za-z0-9_-]{1,128})\/report\.csv$/);
      const runMatch = request.url?.match(/^\/v1\/workspaces\/([A-Za-z0-9_-]{1,128})\/brand-search-runs\/([A-Za-z0-9_-]{1,128})$/);
      if (request.method === "GET" && (reportMatch || runMatch)) {
        const token = bearer(request);
        let decoded;
        try {
          decoded = await verifyIdToken(token);
        } catch {
          throw new ApiError("AUTH_REQUIRED", "로그인을 다시 확인해주세요.", 401);
        }
        if (!decoded?.uid) throw new ApiError("AUTH_REQUIRED", "로그인을 다시 확인해주세요.", 401);
        const route = reportMatch || runMatch;
        const context = { workspaceId: route[1], runId: route[2], uid: decoded.uid };
        if (reportMatch) return csv(response, await repository.getBrandSearchReport(context), route[2], requestId);
        return json(response, 200, { ...await repository.getBrandSearchRun(context), requestId }, requestId);
      }
      const listUrl = new URL(request.url || "/", "http://localhost");
      const match = listUrl.pathname.match(/^\/v1\/workspaces\/([A-Za-z0-9_-]{1,128})\/brand-search-runs$/);
      if (request.method === "GET" && match) {
        const token = bearer(request);
        let decoded;
        try {
          decoded = await verifyIdToken(token);
        } catch {
          throw new ApiError("AUTH_REQUIRED", "로그인을 다시 확인해주세요.", 401);
        }
        if (!decoded?.uid) throw new ApiError("AUTH_REQUIRED", "로그인을 다시 확인해주세요.", 401);
        const rawLimit = listUrl.searchParams.get("limit");
        const limit = rawLimit === null ? 20 : Number(rawLimit);
        if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new ApiError("INVALID_INPUT", "목록 개수는 1~20이어야 합니다.");
        return json(response, 200, { runs: await repository.listBrandSearchRuns({ workspaceId: match[1], uid: decoded.uid, limit }), requestId }, requestId);
      }
      if (request.method !== "POST" || !match || listUrl.search) throw new ApiError("NOT_FOUND", "요청 경로를 찾을 수 없습니다.", 404);
      if (!String(request.headers["content-type"] || "").toLowerCase().startsWith("application/json")) {
        throw new ApiError("INVALID_INPUT", "Content-Type은 application/json이어야 합니다.", 415);
      }
      const token = bearer(request);
      let decoded;
      try {
        decoded = await verifyIdToken(token);
      } catch {
        throw new ApiError("AUTH_REQUIRED", "로그인을 다시 확인해주세요.", 401);
      }
      if (!decoded?.uid) throw new ApiError("AUTH_REQUIRED", "로그인을 다시 확인해주세요.", 401);
      const input = normalizeBrandSearchInput(await readJson(request));
      const result = await repository.reserveBrandSearchRun({
        workspaceId: match[1],
        uid: decoded.uid,
        input,
        requestId
      });
      if (taskDispatcher) await taskDispatcher.dispatch({ workspaceId: match[1], runId: result.runId });
      return json(response, result.reused ? 200 : 202, {
        runId: result.runId,
        status: result.status,
        reused: Boolean(result.reused),
        requestId
      }, requestId);
    } catch (error) {
      if (error instanceof ApiError) {
        return json(response, error.status, { error: { code: error.code, message: error.message }, requestId }, requestId);
      }
      logger.error("request_failed", { requestId, code: "INTERNAL_ERROR" });
      return json(response, 500, { error: { code: "INTERNAL_ERROR", message: "요청을 처리하지 못했습니다." }, requestId }, requestId);
    }
  };
}


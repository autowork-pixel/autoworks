import { ApiError, newRequestId, normalizeBrandSearchInput } from "./domain.mjs";

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

async function readJson(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maximumBodyBytes) throw new ApiError("INVALID_INPUT", "요청 본문이 너무 큽니다.", 413);
    chunks.push(chunk);
  }
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

export function createHandler({ verifyIdToken, repository, logger = console }) {
  return async function handler(request, response) {
    const requestId = newRequestId();
    try {
      if (request.method === "GET" && request.url === "/healthz") {
        return json(response, 200, { ok: true }, requestId);
      }
      const match = request.url?.match(/^\/v1\/workspaces\/([A-Za-z0-9_-]{1,128})\/brand-search-runs$/);
      if (request.method !== "POST" || !match) throw new ApiError("NOT_FOUND", "요청 경로를 찾을 수 없습니다.", 404);
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

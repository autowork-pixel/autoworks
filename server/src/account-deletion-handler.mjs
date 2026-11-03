import { ApiError, newRequestId } from "./domain.mjs";

function json(response, status, body, requestId) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "x-request-id": requestId });
  response.end(JSON.stringify(body));
}

async function body(request) {
  let size = 0; const chunks = [];
  for await (const chunk of request) { size += chunk.length; if (size > 4 * 1024) throw new ApiError("INVALID_INPUT", "요청 본문이 너무 큽니다.", 413); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new ApiError("INVALID_INPUT", "JSON 형식이 올바르지 않습니다."); }
}

export function createAccountDeletionHandler({ verifyIdToken, repository, logger = console }) {
  return async (request, response) => {
    const requestId = newRequestId();
    try {
      const statusMatch = request.url?.match(/^\/v1\/account-deletion-requests\/([A-Za-z0-9_-]{1,128})$/);
      const isCreate = request.method === "POST" && request.url === "/v1/account-deletion-requests";
      const isStatus = request.method === "GET" && statusMatch;
      if (!isCreate && !isStatus) throw new ApiError("NOT_FOUND", "요청 경로를 찾을 수 없습니다.", 404);
      if (isCreate && !String(request.headers["content-type"] || "").toLowerCase().startsWith("application/json")) throw new ApiError("INVALID_INPUT", "Content-Type은 application/json이어야 합니다.", 415);
      const bearer = String(request.headers.authorization || "").match(/^Bearer\s+(.+)$/i);
      if (!bearer) throw new ApiError("AUTH_REQUIRED", "로그인이 필요합니다.", 401);
      let decoded; try { decoded = await verifyIdToken(bearer[1]); } catch { throw new ApiError("AUTH_REQUIRED", "로그인을 다시 확인해주세요.", 401); }
      if (!decoded?.uid) throw new ApiError("AUTH_REQUIRED", "로그인을 다시 확인해주세요.", 401);
      if (isStatus) {
        const result = await repository.getDeletionStatus({ workspaceId: statusMatch[1], uid: decoded.uid });
        return json(response, 200, { workspaceId: statusMatch[1], status: result.status, requestId }, requestId);
      }
      const input = await body(request);
      const workspaceId = typeof input.workspaceId === "string" ? input.workspaceId.trim() : "";
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(workspaceId) || input.confirmation !== "DELETE") {
        throw new ApiError("INVALID_INPUT", "워크스페이스와 탈퇴 확인 문구가 필요합니다.");
      }
      const result = await repository.requestDeletion({ workspaceId, uid: decoded.uid, requestId });
      return json(response, 202, { workspaceId, status: result.status, reused: result.reused, requestId }, requestId);
    } catch (error) {
      if (error instanceof ApiError) return json(response, error.status, { error: { code: error.code, message: error.message }, requestId }, requestId);
      logger.error("account_deletion_request_failed", { requestId, code: "INTERNAL_ERROR" });
      return json(response, 500, { error: { code: "INTERNAL_ERROR", message: "요청을 처리하지 못했습니다." }, requestId }, requestId);
    }
  };
}

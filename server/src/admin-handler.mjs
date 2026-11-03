import { ApiError, newRequestId } from "./domain.mjs";

function json(response, status, body, requestId) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "x-request-id": requestId });
  response.end(JSON.stringify(body));
}

async function body(request) {
  let size = 0; const chunks = [];
  for await (const chunk of request) { size += chunk.length; if (size > 16 * 1024) throw new ApiError("INVALID_INPUT", "요청 본문이 너무 큽니다.", 413); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new ApiError("INVALID_INPUT", "JSON 형식이 올바르지 않습니다."); }
}

export function createAdminHandler({ verifyIdToken, repository, logger = console }) {
  return async (request, response) => {
    const requestId = newRequestId();
    try {
      const accessMatch = request.url?.match(/^\/v1\/admin\/workspaces\/([A-Za-z0-9_-]{1,128})\/access$/);
      const inquiryMatch = request.url?.match(/^\/v1\/admin\/workspaces\/([A-Za-z0-9_-]{1,128})\/inquiries\/([A-Za-z0-9_-]{1,128}):answer$/);
      const inquiryStatusMatch = request.url?.match(/^\/v1\/admin\/workspaces\/([A-Za-z0-9_-]{1,128})\/inquiries\/([A-Za-z0-9_-]{1,128}):status$/);
      if (request.method !== "PUT" || (!accessMatch && !inquiryMatch && !inquiryStatusMatch)) throw new ApiError("NOT_FOUND", "요청 경로를 찾을 수 없습니다.", 404);
      if (!String(request.headers["content-type"] || "").toLowerCase().startsWith("application/json")) throw new ApiError("INVALID_INPUT", "Content-Type은 application/json이어야 합니다.", 415);
      const bearer = String(request.headers.authorization || "").match(/^Bearer\s+(.+)$/i);
      if (!bearer) throw new ApiError("AUTH_REQUIRED", "관리자 로그인이 필요합니다.", 401);
      let decoded; try { decoded = await verifyIdToken(bearer[1]); } catch { throw new ApiError("AUTH_REQUIRED", "관리자 로그인을 다시 확인해주세요.", 401); }
      if (!decoded?.uid || decoded.admin !== true) throw new ApiError("AUTH_REQUIRED", "관리자 권한이 필요합니다.", 403);
      const input = await body(request);
      if (accessMatch) {
        const reason = typeof input.reason === "string" ? input.reason.trim() : "";
        if (typeof input.blocked !== "boolean" || reason.length < 5 || reason.length > 500 || /[\r\n\0]/.test(reason)) throw new ApiError("INVALID_INPUT", "차단 여부와 5~500자의 사유가 필요합니다.");
        const result = await repository.setWorkspaceBlocked({ workspaceId: accessMatch[1], blocked: input.blocked, reason, actorUid: decoded.uid, requestId });
        return json(response, 200, { workspaceId: accessMatch[1], blocked: result.blocked, reused: result.reused, requestId }, requestId);
      }
      if (inquiryMatch) {
        const reply = typeof input.reply === "string" ? input.reply.trim() : "";
        if (reply.length < 1 || reply.length > 4000 || /\0/.test(reply)) throw new ApiError("INVALID_INPUT", "1~4000자의 답변이 필요합니다.");
        const result = await repository.answerInquiry({ workspaceId: inquiryMatch[1], inquiryId: inquiryMatch[2], reply, actorUid: decoded.uid, requestId });
        return json(response, 200, { workspaceId: inquiryMatch[1], inquiryId: inquiryMatch[2], status: result.status, reused: result.reused, requestId }, requestId);
      }
      const reason = typeof input.reason === "string" ? input.reason.trim() : "";
      if (!["reviewing", "closed"].includes(input.status) || reason.length < 5 || reason.length > 500 || /[\r\n\0]/.test(reason)) throw new ApiError("INVALID_INPUT", "문의 상태와 5~500자의 사유가 필요합니다.");
      const result = await repository.updateInquiryStatus({ workspaceId: inquiryStatusMatch[1], inquiryId: inquiryStatusMatch[2], status: input.status, reason, actorUid: decoded.uid, requestId });
      return json(response, 200, { workspaceId: inquiryStatusMatch[1], inquiryId: inquiryStatusMatch[2], status: result.status, reused: result.reused, requestId }, requestId);
    } catch (error) {
      if (error instanceof ApiError) return json(response, error.status, { error: { code: error.code, message: error.message }, requestId }, requestId);
      logger.error("admin_request_failed", { requestId, code: "INTERNAL_ERROR" });
      return json(response, 500, { error: { code: "INTERNAL_ERROR", message: "요청을 처리하지 못했습니다." }, requestId }, requestId);
    }
  };
}

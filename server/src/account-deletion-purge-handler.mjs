import { randomUUID } from "node:crypto";

function json(response, status, body, requestId) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "x-request-id": requestId });
  response.end(JSON.stringify(body));
}

export function createAccountDeletionPurgeHandler({ verifyTaskRequest, service, logger = console }) {
  if (!verifyTaskRequest || !service) throw new Error("Account deletion purge handler configuration is incomplete");
  return async function accountDeletionPurgeHandler(request, response) {
    const requestId = randomUUID();
    try {
      if (request.method !== "POST" || request.url !== "/internal/v1/account-deletions:purge-credentials") {
        return json(response, 404, { error: { code: "NOT_FOUND", message: "요청 경로를 찾을 수 없습니다." }, requestId }, requestId);
      }
      let identity;
      try { identity = await verifyTaskRequest(request); } catch { return json(response, 401, { error: { code: "AUTH_REQUIRED", message: "탈퇴 정리 요청을 확인할 수 없습니다." }, requestId }, requestId); }
      if (!identity?.subject) return json(response, 401, { error: { code: "AUTH_REQUIRED", message: "탈퇴 정리 요청을 확인할 수 없습니다." }, requestId }, requestId);
      const result = await service.runOnce({ requestId });
      return json(response, 200, { ...result, requestId }, requestId);
    } catch {
      logger.error("account_deletion_purge_request_failed", { requestId, code: "INTERNAL_ERROR" });
      return json(response, 500, { error: { code: "INTERNAL_ERROR", message: "탈퇴 정리 작업을 처리하지 못했습니다." }, requestId }, requestId);
    }
  };
}


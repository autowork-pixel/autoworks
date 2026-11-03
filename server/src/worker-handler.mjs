import { randomUUID } from "node:crypto";
import { ApiError } from "./domain.mjs";
import { executeBrandSearchRun } from "./worker-core.mjs";

function json(response, status, body, requestId) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "x-request-id": requestId });
  response.end(JSON.stringify(body));
}

export function createWorkerHandler({ verifyTaskRequest, contextLoader, provider, repository, logger = console }) {
  return async function workerHandler(request, response) {
    const requestId = randomUUID();
    try {
      const match = request.url?.match(/^\/internal\/v1\/workspaces\/([A-Za-z0-9_-]{1,128})\/runs\/([A-Za-z0-9_-]{1,128}):execute$/);
      if (request.method !== "POST" || !match) throw new ApiError("NOT_FOUND", "요청 경로를 찾을 수 없습니다.", 404);
      let taskIdentity;
      try {
        taskIdentity = await verifyTaskRequest(request);
      } catch {
        throw new ApiError("AUTH_REQUIRED", "작업 요청을 확인할 수 없습니다.", 401);
      }
      if (!taskIdentity?.subject) throw new ApiError("AUTH_REQUIRED", "작업 요청을 확인할 수 없습니다.", 401);
      const workspaceId = match[1];
      const runId = match[2];
      const context = await contextLoader.load({ workspaceId, runId });
      if (context.terminalStatus) return json(response, 200, { runId, status: context.terminalStatus, reused: true, requestId }, requestId);
      const result = await executeBrandSearchRun({ workspaceId, runId, workerId: `${taskIdentity.subject}:${requestId}`, input: context.input, credentials: context.credentials, provider, repository });
      return json(response, 200, { runId, status: result.status, requestId }, requestId);
    } catch (error) {
      if (error instanceof ApiError) return json(response, error.status, { error: { code: error.code, message: error.message }, requestId }, requestId);
      logger.error("worker_request_failed", { requestId, code: "INTERNAL_ERROR" });
      return json(response, 500, { error: { code: "INTERNAL_ERROR", message: "작업을 처리하지 못했습니다." }, requestId }, requestId);
    }
  };
}

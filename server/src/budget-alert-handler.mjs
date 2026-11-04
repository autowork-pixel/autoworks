import { randomUUID } from "node:crypto";
import { ApiError } from "./domain.mjs";

function json(response, status, body, requestId) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "x-request-id": requestId });
  response.end(JSON.stringify(body));
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 65_536) throw new ApiError("INVALID_INPUT", "요청 본문이 너무 큽니다.", 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new ApiError("INVALID_INPUT", "요청 본문이 올바르지 않습니다.", 400); }
}

export function createBudgetAlertHandler({ verifyTaskRequest, service, logger = console }) {
  if (!verifyTaskRequest || !service) throw new Error("Budget alert handler configuration is incomplete");
  return async function budgetAlertHandler(request, response) {
    const requestId = randomUUID();
    try {
      if (request.method !== "POST") throw new ApiError("NOT_FOUND", "요청 경로를 찾을 수 없습니다.", 404);
      let identity;
      try { identity = await verifyTaskRequest(request); } catch { throw new ApiError("AUTH_REQUIRED", "예산 알림 요청을 확인할 수 없습니다.", 401); }
      if (!identity?.subject) throw new ApiError("AUTH_REQUIRED", "예산 알림 요청을 확인할 수 없습니다.", 401);
      const result = await service.process(await readBody(request));
      return json(response, 200, { blocked: result.blocked, reused: Boolean(result.reused), requestId }, requestId);
    } catch (error) {
      const known = error instanceof ApiError;
      const status = known ? error.status : 500;
      if (!known) logger.error("budget_alert_failed", { requestId, code: "INTERNAL_ERROR" });
      return json(response, status, { error: { code: known ? error.code : "INTERNAL_ERROR", message: known ? error.message : "예산 알림을 처리하지 못했습니다." }, requestId }, requestId);
    }
  };
}

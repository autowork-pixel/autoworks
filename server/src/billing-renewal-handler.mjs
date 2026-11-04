import { randomUUID } from "node:crypto";

function json(response, status, body, requestId) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store",
    "x-content-type-options": "nosniff", "x-request-id": requestId });
  response.end(JSON.stringify(body));
}

export function createBillingRenewalHandler({ verifyTaskRequest, service, logger = console }) {
  if (!verifyTaskRequest || !service) throw new Error("Billing renewal handler configuration is incomplete");
  return async (request, response) => {
    const requestId = randomUUID();
    try {
      if (request.method !== "POST" || request.url !== "/internal/v1/billing-renewals:run")
        return json(response, 404, { error: { code: "NOT_FOUND", message: "요청 경로를 찾을 수 없습니다." }, requestId }, requestId);
      let identity;
      try { identity = await verifyTaskRequest(request); } catch {}
      if (!identity?.subject) return json(response, 401, { error: { code: "AUTH_REQUIRED", message: "정기결제 작업 요청을 확인할 수 없습니다." }, requestId }, requestId);
      return json(response, 200, { ...(await service.runOnce()), requestId }, requestId);
    } catch {
      logger.error("billing_renewal_failed", { requestId, code: "INTERNAL_ERROR" });
      return json(response, 500, { error: { code: "INTERNAL_ERROR", message: "정기결제 갱신 작업을 처리하지 못했습니다." }, requestId }, requestId);
    }
  };
}


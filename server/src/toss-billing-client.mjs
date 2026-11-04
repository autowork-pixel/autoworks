import { ApiError } from "./domain.mjs";

const baseUrl = "https://api.tosspayments.com";

function opaque(value, name, max) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > max || /[\u0000-\u001f\u007f]/.test(normalized)) throw new ApiError("INVALID_INPUT", `${name} 형식이 올바르지 않습니다.`);
  return normalized;
}

function providerError(status, payload) {
  const code = typeof payload?.code === "string" ? payload.code : "TOSS_REQUEST_FAILED";
  const retryable = status >= 500 || status === 409;
  return new ApiError(retryable ? "PAYMENT_TEMPORARILY_UNAVAILABLE" : "PAYMENT_REJECTED", retryable ? "결제사 응답이 지연되고 있습니다. 같은 요청으로 다시 시도해주세요." : "결제수단 등록 또는 승인에 실패했습니다.", retryable ? 503 : 422);
}

export function createTossBillingClient({ secretKey, fetchImpl = fetch }) {
  const key = opaque(secretKey, "secretKey", 200);
  const authorization = `Basic ${Buffer.from(`${key}:`, "utf8").toString("base64")}`;
  async function request(path, { method = "GET", body, idempotencyKey, timeoutMs = 65_000 } = {}) {
    const headers = { authorization, "content-type": "application/json" };
    if (idempotencyKey) headers["Idempotency-Key"] = opaque(idempotencyKey, "idempotencyKey", 300);
    let response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeoutMs) });
    } catch {
      throw new ApiError("PAYMENT_TEMPORARILY_UNAVAILABLE", "결제사 응답을 확인하지 못했습니다. 같은 요청으로 다시 시도해주세요.", 503);
    }
    let payload = null;
    try { payload = await response.json(); } catch {}
    if (!response.ok) throw providerError(response.status, payload);
    if (!payload || typeof payload !== "object") throw new ApiError("PAYMENT_RESPONSE_INVALID", "결제사 응답을 확인하지 못했습니다.", 502);
    return payload;
  }
  return {
    issueBillingKey({ authKey, customerKey, idempotencyKey }) {
      return request("/v1/billing/authorizations/issue", { method: "POST", body: { authKey: opaque(authKey, "authKey", 300), customerKey: opaque(customerKey, "customerKey", 50) }, idempotencyKey });
    },
    charge({ billingKey, customerKey, amount, orderId, orderName, idempotencyKey }) {
      return request(`/v1/billing/${encodeURIComponent(opaque(billingKey, "billingKey", 200))}`, { method: "POST", body: { customerKey: opaque(customerKey, "customerKey", 50), amount, orderId, orderName, taxFreeAmount: 0 }, idempotencyKey });
    },
    findByOrderId(orderId) {
      return request(`/v1/payments/orders/${encodeURIComponent(opaque(orderId, "orderId", 64))}`);
    }
  };
}

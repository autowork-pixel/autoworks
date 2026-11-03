import { ApiError, newRequestId } from "./domain.mjs";

const allowedMethods = "GET, POST, PUT, DELETE, OPTIONS";
const allowedHeaders = "authorization, content-type";

function json(response, status, body, requestId, headers = {}) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "x-request-id": requestId,
    ...headers
  });
  response.end(JSON.stringify(body));
}

function normalizedOrigins(values) {
  const origins = new Set();
  for (const value of values || []) {
    try {
      const parsed = new URL(value);
      if (!/^https?:$/.test(parsed.protocol) || parsed.pathname !== "/" || parsed.search || parsed.hash) throw new Error();
      origins.add(parsed.origin);
    } catch {
      throw new Error("CORS origin configuration is invalid");
    }
  }
  if (!origins.size) throw new Error("At least one CORS origin is required");
  return origins;
}

function originHeaders(origin) {
  return {
    "access-control-allow-origin": origin,
    vary: "Origin"
  };
}

export function createCorsHandler({ handler, allowedOrigins }) {
  if (typeof handler !== "function") throw new TypeError("handler is required");
  const origins = normalizedOrigins(allowedOrigins);
  return async function corsHandler(request, response) {
    const origin = typeof request.headers?.origin === "string" ? request.headers.origin : null;
    if (origin && !origins.has(origin)) {
      const requestId = newRequestId();
      return json(response, 403, { error: { code: "ORIGIN_NOT_ALLOWED", message: "허용되지 않은 요청 출처입니다." }, requestId }, requestId);
    }
    if (request.method === "OPTIONS") {
      const requestId = newRequestId();
      if (!origin) return json(response, 400, { error: { code: "INVALID_INPUT", message: "요청 출처가 필요합니다." }, requestId }, requestId);
      const requestedMethod = String(request.headers["access-control-request-method"] || "").toUpperCase();
      if (!allowedMethods.split(", ").includes(requestedMethod)) {
        const error = new ApiError("INVALID_INPUT", "허용되지 않은 요청 방식입니다.", 405);
        return json(response, error.status, { error: { code: error.code, message: error.message }, requestId }, requestId, originHeaders(origin));
      }
      response.writeHead(204, {
        ...originHeaders(origin),
        "access-control-allow-methods": allowedMethods,
        "access-control-allow-headers": allowedHeaders,
        "access-control-max-age": "600",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "x-request-id": requestId
      });
      return response.end();
    }
    if (origin) {
      const originalWriteHead = response.writeHead.bind(response);
      response.writeHead = (statusCode, headers) => originalWriteHead(statusCode, { ...headers, ...originHeaders(origin) });
    }
    return handler(request, response);
  };
}

import { randomBytes } from "node:crypto";
import { ApiError, newRequestId } from "./domain.mjs";
import { beginOAuth, completeOAuth } from "./oauth-flow.mjs";

function html(response, status, body, requestId, nonce) {
  response.writeHead(status, {
    "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer", "content-security-policy": `default-src 'none'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'`,
    "x-request-id": requestId
  });
  response.end(body);
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function errorPage(response, error, requestId) {
  const nonce = randomBytes(18).toString("base64url"), message = error instanceof ApiError ? error.message : "로그인을 완료하지 못했습니다.";
  html(response, error instanceof ApiError ? error.status : 500, `<!doctype html><meta charset="utf-8"><title>로그인 확인</title><p>${escapeHtml(message)}</p><script nonce="${nonce}">window.close();</script>`, requestId, nonce);
}

export function createOAuthHandler({ configs, stateStore, identityStore, tokenIssuer, allowedOrigins, fetchImpl = fetch, logger = console }) {
  const origins = new Set(allowedOrigins);
  return async (request, response) => {
    const requestId = newRequestId();
    try {
      if (request.method !== "GET") throw new ApiError("NOT_FOUND", "요청 경로를 찾을 수 없습니다.", 404);
      const url = new URL(request.url || "/", "http://localhost"), match = url.pathname.match(/^\/v1\/auth\/(naver|kakao)\/(start|callback)$/);
      if (!match) throw new ApiError("NOT_FOUND", "요청 경로를 찾을 수 없습니다.", 404);
      const [, provider, action] = match, config = configs[provider];
      if (!config) throw new ApiError("AUTH_REQUIRED", "이 로그인 제공자는 아직 준비되지 않았습니다.", 503);
      if (action === "start") {
        const returnOrigin = url.searchParams.get("returnOrigin");
        if (!origins.has(returnOrigin)) throw new ApiError("AUTH_REQUIRED", "허용되지 않은 로그인 출처입니다.", 403);
        const location = await beginOAuth({ provider, clientId: config.clientId, redirectUri: config.redirectUri, returnOrigin, stateStore });
        response.writeHead(302, { location, "cache-control": "no-store", "referrer-policy": "no-referrer", "x-request-id": requestId });
        return response.end();
      }
      const result = await completeOAuth({ provider, code: url.searchParams.get("code"), state: url.searchParams.get("state"), config, stateStore, identityStore, tokenIssuer, fetchImpl });
      if (!origins.has(result.returnOrigin)) throw new ApiError("AUTH_REQUIRED", "허용되지 않은 로그인 출처입니다.", 403);
      const nonce = randomBytes(18).toString("base64url"), payload = JSON.stringify({ type: "autoworks-oauth", provider: result.provider, customToken: result.customToken }).replaceAll("<", "\\u003c");
      html(response, 200, `<!doctype html><meta charset="utf-8"><title>로그인 완료</title><p>로그인을 완료하고 있습니다.</p><script nonce="${nonce}">if(window.opener){window.opener.postMessage(${payload},${JSON.stringify(result.returnOrigin)});window.close();}</script>`, requestId, nonce);
    } catch (error) {
      if (!(error instanceof ApiError)) logger.error("oauth_request_failed", { requestId, code: "INTERNAL_ERROR" });
      return errorPage(response, error, requestId);
    }
  };
}


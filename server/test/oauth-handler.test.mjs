import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import test from "node:test";
import { createOAuthHandler } from "../src/oauth-handler.mjs";

async function withServer(dependencies, callback) {
  const server = createServer(createOAuthHandler(dependencies)); server.listen(0, "127.0.0.1"); await once(server, "listening");
  try { await callback(`http://127.0.0.1:${server.address().port}`); } finally { server.close(); await once(server, "close"); }
}

const base = {
  configs: { naver: { clientId: "client", clientSecret: "secret", redirectUri: "https://api.example/v1/auth/naver/callback" } },
  allowedOrigins: ["https://app.example"], identityStore: { upsert: async () => {} }, tokenIssuer: { createCustomToken: async () => "firebase-custom" }, logger: { error: () => {} }
};

test("허용된 웹 출처만 state를 만들고 제공자 인가 화면으로 보낸다", async () => {
  let saved;
  await withServer({ ...base, stateStore: { create: async value => { saved = value; } } }, async url => {
    const response = await fetch(`${url}/v1/auth/naver/start?returnOrigin=${encodeURIComponent("https://app.example")}`, { redirect: "manual" });
    assert.equal(response.status, 302);
    assert.equal(new URL(response.headers.get("location")).origin, "https://nid.naver.com");
    assert.equal(saved.returnOrigin, "https://app.example");
    const denied = await fetch(`${url}/v1/auth/naver/start?returnOrigin=${encodeURIComponent("https://evil.example")}`, { redirect: "manual" });
    assert.equal(denied.status, 403);
  });
});

test("콜백은 custom token을 URL이 아닌 허용 출처 postMessage 본문으로만 전달한다", async () => {
  const fetchImpl = async url => url.includes("oauth2.0/token")
    ? { ok: true, json: async () => ({ access_token: "provider-access" }) }
    : { ok: true, json: async () => ({ resultcode: "00", response: { id: "subject-a" } }) };
  await withServer({ ...base, fetchImpl, stateStore: { consume: async () => ({ provider: "naver", redirectUri: base.configs.naver.redirectUri, returnOrigin: "https://app.example", expiresAt: Date.now() + 10000 }) } }, async url => {
    const response = await fetch(`${url}/v1/auth/naver/callback?code=code&state=state`), body = await response.text();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.match(response.headers.get("content-security-policy"), /script-src 'nonce-/);
    assert.equal(body.includes("firebase-custom"), true);
    assert.equal(body.includes("https://app.example"), true);
    assert.equal(response.url.includes("firebase-custom"), false);
    assert.equal(body.includes("provider-access"), false);
    assert.equal(body.includes("secret"), false);
  });
});

test("콜백 실패는 비밀값 없이 부모 창에 안전한 오류 코드를 전달한다", async () => {
  const warnings = [];
  const dependencies = {
    ...base,
    configs: { kakao: { clientId: "client", clientSecret: "wrong-secret", redirectUri: "https://api.example/v1/auth/kakao/callback" } },
    logger: { warn: (...values) => warnings.push(values), error: () => {} },
    fetchImpl: async () => ({ ok: false, json: async () => ({ error: "invalid_client", error_description: "private provider detail" }) }),
    stateStore: { consume: async () => ({ provider: "kakao", redirectUri: "https://api.example/v1/auth/kakao/callback", returnOrigin: "https://app.example", expiresAt: Date.now() + 10000 }) }
  };
  await withServer(dependencies, async url => {
    const response = await fetch(`${url}/v1/auth/kakao/callback?code=code&state=state`), body = await response.text();
    assert.equal(response.status, 401);
    assert.match(body, /autoworks-oauth-error/);
    assert.match(body, /OAUTH_TOKEN_EXCHANGE_FAILED/);
    assert.match(body, /https:\/\/app\.example/);
    assert.equal(body.includes("wrong-secret"), false);
    assert.equal(body.includes("private provider detail"), false);
    assert.deepEqual(warnings[0][1], { requestId: warnings[0][1].requestId, provider: "kakao", code: "OAUTH_TOKEN_EXCHANGE_FAILED" });
  });
});




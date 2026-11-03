import assert from "node:assert/strict";
import test from "node:test";
import { beginOAuth, completeOAuth } from "../src/oauth-flow.mjs";
import { authorizationUrl, exchangeAuthorizationCode, fetchProviderIdentity } from "../src/oauth-providers.mjs";

test("로그인 시작은 10분짜리 state를 저장하고 공식 인가 주소를 만든다", async () => {
  let saved;
  const url = await beginOAuth({ provider: "kakao", clientId: "rest-key", redirectUri: "https://example.com/auth/kakao/callback", stateStore: { create: async value => { saved = value; } }, now: () => 1000 });
  const parsed = new URL(url);
  assert.equal(parsed.origin, "https://kauth.kakao.com");
  assert.equal(parsed.searchParams.get("client_id"), "rest-key");
  assert.equal(parsed.searchParams.get("state"), saved.state);
  assert.equal(saved.expiresAt, 601000);
});

test("네이버와 카카오 인가 URL에 state와 등록 redirect URI를 유지한다", () => {
  for (const provider of ["naver", "kakao"]) {
    const url = new URL(authorizationUrl({ provider, clientId: "client", redirectUri: "https://service.example/callback", state: "state-value" }));
    assert.equal(url.searchParams.get("response_type"), "code");
    assert.equal(url.searchParams.get("redirect_uri"), "https://service.example/callback");
    assert.equal(url.searchParams.get("state"), "state-value");
  }
});

test("토큰 교환은 secret을 URL에 넣지 않고 폼 본문으로 전송한다", async () => {
  let received;
  const token = await exchangeAuthorizationCode({
    provider: "kakao", clientId: "client", clientSecret: "secret", redirectUri: "https://service.example/callback", code: "code",
    fetchImpl: async (url, options) => { received = { url, options }; return { ok: true, json: async () => ({ access_token: "access" }) }; }
  });
  assert.equal(token, "access");
  assert.equal(received.url.includes("secret"), false);
  assert.equal(received.options.body.get("client_secret"), "secret");
});

test("제공자 프로필을 최소 공통 식별자로 정규화한다", async () => {
  const naver = await fetchProviderIdentity({ provider: "naver", accessToken: "token", fetchImpl: async () => ({ ok: true, json: async () => ({ resultcode: "00", response: { id: "naver-id", email: "a@example.com", nickname: "A" } }) }) });
  const kakao = await fetchProviderIdentity({ provider: "kakao", accessToken: "token", fetchImpl: async () => ({ ok: true, json: async () => ({ id: 123, kakao_account: { email: "b@example.com", profile: { nickname: "B" } } }) }) });
  assert.deepEqual(naver, { provider: "naver", subject: "naver-id", email: "a@example.com", displayName: "A" });
  assert.deepEqual(kakao, { provider: "kakao", subject: "123", email: "b@example.com", displayName: "B" });
});

test("콜백은 state를 한 번 소비한 뒤 Firebase custom token을 발급한다", async () => {
  const events = [];
  const fetchImpl = async url => {
    if (url.includes("oauth2.0/token")) return { ok: true, json: async () => ({ access_token: "provider-access" }) };
    return { ok: true, json: async () => ({ resultcode: "00", response: { id: "subject-a", email: "user@example.com" } }) };
  };
  const result = await completeOAuth({
    provider: "naver", code: "code", state: "state", config: { clientId: "client", clientSecret: "secret" }, fetchImpl, now: () => 1000,
    stateStore: { consume: async value => { events.push(["consume", value]); return { provider: "naver", redirectUri: "https://service.example/callback", expiresAt: 2000 }; } },
    identityStore: { upsert: async value => events.push(["identity", value]) },
    tokenIssuer: { createCustomToken: async (uid, claims) => { events.push(["token", uid, claims]); return "firebase-custom"; } }
  });
  assert.deepEqual(result, { customToken: "firebase-custom", provider: "naver" });
  assert.equal(events[1][1].uid, "naver:subject-a");
  assert.deepEqual(events[2], ["token", "naver:subject-a", { authProvider: "naver" }]);
  assert.equal(JSON.stringify(events).includes("provider-access"), false);
  assert.equal(JSON.stringify(events).includes("secret"), false);
});

test("만료되거나 제공자가 다른 state는 토큰 요청 전에 거부한다", async () => {
  let called = false;
  await assert.rejects(() => completeOAuth({
    provider: "kakao", code: "code", state: "state", config: { clientId: "client", clientSecret: "secret" }, now: () => 3000,
    stateStore: { consume: async () => ({ provider: "naver", redirectUri: "https://service.example/callback", expiresAt: 2000 }) },
    identityStore: {}, tokenIssuer: {}, fetchImpl: async () => { called = true; }
  }), error => error.code === "AUTH_REQUIRED");
  assert.equal(called, false);
});

import assert from "node:assert/strict";
import test from "node:test";
import { createOAuthIdentityStore, createOAuthStateStore } from "../src/oauth-repository.mjs";

function fakeDatabase() {
  const values = new Map(), writes = [];
  const ref = path => ({ path, async create(value) { if (values.has(path)) throw new Error("exists"); values.set(path, value); }, async set(value, options) { values.set(path, options?.merge ? { ...(values.get(path) || {}), ...value } : value); writes.push([path, value, options]); } });
  const database = { doc: ref, runTransaction: callback => callback({ get: async value => ({ exists: values.has(value.path), data: () => values.get(value.path) }), delete: value => values.delete(value.path) }) };
  return { database, values, writes };
}

test("OAuth state 원문은 문서 경로에 남기지 않고 한 번만 소비한다", async () => {
  const fake = fakeDatabase(), store = createOAuthStateStore({ database: fake.database, serverTimestamp: () => "server-time" });
  await store.create({ state: "raw-secret-state", provider: "naver", redirectUri: "https://api.example/callback", returnOrigin: "https://app.example", expiresAt: 2000 });
  const path = [...fake.values.keys()][0];
  assert.equal(path.includes("raw-secret-state"), false);
  assert.deepEqual(await store.consume("raw-secret-state"), { provider: "naver", redirectUri: "https://api.example/callback", returnOrigin: "https://app.example", expiresAt: 2000, createdAt: "server-time" });
  assert.equal(await store.consume("raw-secret-state"), null);
});

test("외부 로그인 식별자는 최소 프로필만 사용자 문서에 병합한다", async () => {
  const fake = fakeDatabase(), store = createOAuthIdentityStore({ database: fake.database, serverTimestamp: () => "server-time" });
  await store.upsert({ uid: "kakao:123", provider: "kakao", subject: "123", email: "user@example.com", displayName: "사용자" });
  assert.deepEqual(fake.writes[0], ["users/kakao:123", { provider: "kakao", providerSubject: "123", email: "user@example.com", displayName: "사용자", updatedAt: "server-time" }, { merge: true }]);
});

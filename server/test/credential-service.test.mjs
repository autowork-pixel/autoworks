import assert from "node:assert/strict";
import test from "node:test";
import { createCredentialService } from "../src/credential-service.mjs";

const credentials = { apiKey: "license-1234", secretKey: "very-secret", customerId: "987654" };

test("연결 정보는 암호화 봉투와 비민감 힌트만 저장소에 넘긴다", async () => {
  const plaintextDataKey = Buffer.alloc(32, 7);
  let saved;
  const service = createCredentialService({
    keyManager: { generateDataKey: async () => ({ plaintextDataKey, encryptedDataKey: "kms-wrapped-key", keyVersion: "kms-v1" }) },
    repository: { saveCredential: async value => { saved = value; } },
    now: () => new Date("2026-11-03T00:00:00Z")
  });
  const result = await service.save({ workspaceId: "workspace-a", uid: "user-a", provider: "naver-searchad", credentials });
  assert.deepEqual(result, { provider: "naver-searchad", status: "active", apiKeyHint: "••••1234" });
  assert.equal(saved.uid, "user-a");
  assert.equal(saved.document.status, "active");
  assert.equal(saved.document.apiKeyHint, "••••1234");
  assert.equal(JSON.stringify(saved).includes("very-secret"), false);
  assert.equal(JSON.stringify(saved).includes("license-1234"), false);
  assert.equal(plaintextDataKey.every(byte => byte === 0), true);
});

test("저장이 실패해도 평문 데이터 키는 덮어쓴다", async () => {
  const plaintextDataKey = Buffer.alloc(32, 9);
  const service = createCredentialService({
    keyManager: { generateDataKey: async () => ({ plaintextDataKey, encryptedDataKey: "wrapped", keyVersion: "kms-v1" }) },
    repository: { saveCredential: async () => { throw new Error("database unavailable"); } }
  });
  await assert.rejects(() => service.save({ workspaceId: "workspace-a", uid: "user-a", provider: "naver-searchad", credentials }));
  assert.equal(plaintextDataKey.every(byte => byte === 0), true);
});

test("연결 해제와 상태 조회도 uid를 저장소 권한 검증에 전달한다", async () => {
  const calls = [];
  const service = createCredentialService({
    keyManager: {},
    repository: {
      deleteCredential: async value => calls.push(["delete", value]),
      getCredentialStatus: async value => { calls.push(["status", value]); return { status: "active", apiKeyHint: "••••1234" }; }
    }
  });
  assert.deepEqual(await service.status({ workspaceId: "workspace-a", uid: "user-a", provider: "naver-searchad" }), { provider: "naver-searchad", status: "active", apiKeyHint: "••••1234", updatedAt: null });
  assert.deepEqual(await service.remove({ workspaceId: "workspace-a", uid: "user-a", provider: "naver-searchad" }), { provider: "naver-searchad", status: "disconnected" });
  assert.equal(calls[0][1].uid, "user-a");
  assert.equal(calls[1][1].uid, "user-a");
});

test("YouTube·OpenAI와 Apify 연결도 평문 없이 제공자별 KMS 봉투로 저장한다", async () => {
  for (const [provider, credentials] of [["youtube", { apiKey: "youtube-key" }], ["apify", { token: "apify-token" }], ["openai", { apiKey: "openai-key" }], ["naver-search", { clientId: "client-id", clientSecret: "client-secret" }]]) {
    let saved;
    const plaintextDataKey = Buffer.alloc(32, 3);
    const service = createCredentialService({
      keyManager: { generateDataKey: async ids => {
        assert.equal(ids.provider, provider);
        return { plaintextDataKey, encryptedDataKey: "wrapped", keyVersion: "kms-v1" };
      } },
      repository: { saveCredential: async value => { saved = value; } }
    });
    const result = await service.save({ workspaceId: "workspace-a", uid: "user-a", provider, credentials });
    assert.equal(result.provider, provider);
    assert.equal(saved.provider, provider);
    assert.equal(JSON.stringify(saved).includes(Object.values(credentials)[0]), false);
    assert.equal(plaintextDataKey.every(byte => byte === 0), true);
  }
});

test("광고 매체 연결도 계정별 KMS 봉투로 저장하고 계정 ID 힌트만 반환한다", async () => {
  const cases = [
    ["meta-ads", { accessToken: "meta-secret", adAccountId: "act_12345678" }, "••••5678"],
    ["google-ads", { developerToken: "developer-secret", clientId: "client-id", clientSecret: "client-secret", refreshToken: "refresh-secret", customerId: "1234567890", loginCustomerId: "9876543210" }, "••••7890"],
    ["kakao-moment", { businessAccessToken: "kakao-secret", adAccountId: "76543210" }, "••••3210"]
  ];
  for (const [provider, providerCredentials, hint] of cases) {
    let saved;
    const service = createCredentialService({
      keyManager: { generateDataKey: async () => ({ plaintextDataKey: Buffer.alloc(32, 4), encryptedDataKey: "wrapped", keyVersion: "kms-v1" }) },
      repository: { saveCredential: async value => { saved = value; } }
    });
    const result = await service.save({ workspaceId: "workspace-a", uid: "user-a", provider, credentials: providerCredentials });
    assert.equal(result.apiKeyHint, hint);
    for (const secret of Object.values(providerCredentials)) assert.equal(JSON.stringify(saved).includes(secret), false);
  }
});

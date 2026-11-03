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

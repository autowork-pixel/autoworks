import { test } from "node:test";
import assert from "node:assert/strict";
import { encryptCredentialPayload } from "../src/credential-crypto.mjs";
import { createCollabInstagramService } from "../src/collab-instagram-service.mjs";
import { ApiError } from "../src/domain.mjs";

const input = { projectId: "project-a", shortcode: "ABC_123", url: "https://www.instagram.com/reel/ABC_123/", idempotencyKey: "random-request-key-0001" };

test("고객별 KMS 봉투를 풀어 Instagram 조회 후 Apify 사용량을 정산한다", async () => {
  const key = Buffer.alloc(32, 9);
  const envelope = encryptCredentialPayload({ provider: "apify", credentials: { token: "private-token" },
    plaintextDataKey: key, encryptedDataKey: "wrapped", keyVersion: "kms-v1" });
  const calls = [];
  const service = createCollabInstagramService({
    repository: { reserveCollabInstagramRun: async value => { calls.push(["reserve", value]); return { runId: "run-a", reused: false, envelope }; },
      finishCollabInstagramRun: async value => { calls.push(["finish", value]); return { status: "succeeded" }; } },
    keyManager: { decryptDataKey: async value => { assert.equal(value.provider, "apify"); return Buffer.from(key); } },
    fetchPost: async value => { assert.deepEqual(value, { shortcode: input.shortcode, url: input.url, token: "private-token" }); return { platform: "Instagram", views: 12, capturedAt: "2026-11-04T00:00:00Z" }; }
  });
  const result = await service.run({ workspaceId: "workspace-a", uid: "user-a", input });
  assert.equal(result.status, "succeeded");
  assert.equal(calls[0][1].uid, "user-a");
  assert.equal(calls[1][1].providerCalled, true);
  assert.equal(JSON.stringify(result).includes("private-token"), false);
});

test("Apify 오류를 실패 정산하고 재사용 요청은 외부 호출하지 않는다", async () => {
  let finalized;
  const service = createCollabInstagramService({
    repository: { reserveCollabInstagramRun: async () => ({ runId: "run-a", reused: false,
      envelope: { algorithm: "aes-256-gcm", encryptedDataKey: "wrapped", keyVersion: "kms-v1" } }),
      finishCollabInstagramRun: async value => { finalized = value; return { status: "failed" }; } },
    keyManager: { decryptDataKey: async () => { throw new ApiError("PROVIDER_CREDENTIAL_REQUIRED", "연결 오류", 409); } }
  });
  await assert.rejects(service.run({ workspaceId: "workspace-a", uid: "user-a", input }), { code: "PROVIDER_CREDENTIAL_REQUIRED" });
  assert.equal(finalized.providerCalled, false);
  const reused = createCollabInstagramService({ repository: { reserveCollabInstagramRun: async () => ({ runId: "run-a", status: "succeeded", reused: true }) },
    keyManager: { decryptDataKey: async () => { throw new Error("must not run"); } } });
  assert.deepEqual(await reused.run({ workspaceId: "workspace-a", uid: "user-a", input }), { runId: "run-a", status: "succeeded", reused: true });
});

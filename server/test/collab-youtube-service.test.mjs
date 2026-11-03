import { test } from "node:test";
import assert from "node:assert/strict";
import { encryptCredentialPayload } from "../src/credential-crypto.mjs";
import { createCollabYouTubeService } from "../src/collab-youtube-service.mjs";
import { ApiError } from "../src/domain.mjs";

const input = { projectId: "project-a", videoId: "AbCde123_-0", url: "https://www.youtube.com/watch?v=AbCde123_-0", idempotencyKey: "random-request-key-0001" };

test("고객별 KMS 봉투를 풀어 YouTube 조회 후 결과를 정산한다", async () => {
  const key = Buffer.alloc(32, 7);
  const envelope = encryptCredentialPayload({ provider: "youtube", credentials: { apiKey: "private-key" },
    plaintextDataKey: key, encryptedDataKey: "wrapped", keyVersion: "kms-v1" });
  const calls = [];
  const service = createCollabYouTubeService({
    repository: { reserveCollabYouTubeRun: async value => { calls.push(["reserve", value]); return { runId: "run-a", reused: false, envelope }; },
      finishCollabYouTubeRun: async value => { calls.push(["finish", value]); return { status: "succeeded" }; } },
    keyManager: { decryptDataKey: async value => { assert.equal(value.provider, "youtube"); return Buffer.from(key); } },
    fetchPost: async value => { assert.deepEqual(value, { videoId: input.videoId, apiKey: "private-key" }); return { views: 12, capturedAt: "2026-11-03T00:00:00Z" }; }
  });
  const result = await service.run({ workspaceId: "workspace-a", uid: "user-a", input });
  assert.equal(result.status, "succeeded");
  assert.equal(calls[0][1].uid, "user-a");
  assert.equal(calls[1][1].providerCalled, true);
  assert.equal(JSON.stringify(result).includes("private-key"), false);
});

test("제공자 오류를 실패 정산하고 같은 멱등 요청은 다시 호출하지 않는다", async () => {
  let finalized;
  const service = createCollabYouTubeService({
    repository: { reserveCollabYouTubeRun: async () => ({ runId: "run-a", reused: false,
      envelope: { algorithm: "aes-256-gcm", encryptedDataKey: "wrapped", keyVersion: "kms-v1" } }),
      finishCollabYouTubeRun: async value => { finalized = value; return { status: "failed" }; } },
    keyManager: { decryptDataKey: async () => { throw new ApiError("PROVIDER_CREDENTIAL_REQUIRED", "연결 오류", 409); } }
  });
  await assert.rejects(service.run({ workspaceId: "workspace-a", uid: "user-a", input }), { code: "PROVIDER_CREDENTIAL_REQUIRED" });
  assert.equal(finalized.providerCalled, false);
  const reused = createCollabYouTubeService({ repository: { reserveCollabYouTubeRun: async () => ({ runId: "run-a", status: "succeeded", reused: true }) },
    keyManager: { decryptDataKey: async () => { throw new Error("must not run"); } } });
  assert.deepEqual(await reused.run({ workspaceId: "workspace-a", uid: "user-a", input }), { runId: "run-a", status: "succeeded", reused: true });
});

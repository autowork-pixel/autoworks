import assert from "node:assert/strict";
import test from "node:test";
import { encryptCredentialPayload } from "../src/credential-crypto.mjs";
import { createContentReferenceService } from "../src/content-reference-service.mjs";

const input = { projectId: "project-a", brand: "오토웍스", category: "마케팅", keywords: ["자동화"], target: "담당자", strengths: [], periodDays: 28, collectCount: 5, idempotencyKey: "random-request-key-0001" };

test("고객 YouTube 키로 검색하고 결과·사용량 정산에는 키를 남기지 않는다", async () => {
  const key = Buffer.alloc(32, 3);
  const envelope = encryptCredentialPayload({ provider: "youtube", credentials: { apiKey: "private-key" }, plaintextDataKey: key, encryptedDataKey: "wrapped", keyVersion: "kms-v1" });
  let finished;
  const service = createContentReferenceService({ repository: {
    reserveContentReferenceRun: async () => ({ runId: "run-a", reused: false, envelope }),
    finishContentReferenceRun: async value => { finished = value; return { status: "succeeded" }; }
  }, keyManager: { decryptDataKey: async value => { assert.equal(value.provider, "youtube"); return Buffer.from(key); } },
  search: async value => { assert.equal(value.apiKey, "private-key"); return { query: "오토웍스 마케팅 자동화", publishedAfter: "2026-10-07T00:00:00Z", capturedAt: "2026-11-04T00:00:00Z", rows: [{ title: "영상" }] }; } });
  const result = await service.run({ workspaceId: "workspace-a", uid: "user-a", input });
  assert.equal(result.rows.length, 1);
  assert.equal(finished.providerCalled, true);
  assert.equal(JSON.stringify({ result, finished }).includes("private-key"), false);
});

test("같은 멱등 요청은 키 복호화와 검색을 다시 하지 않는다", async () => {
  const service = createContentReferenceService({ repository: { reserveContentReferenceRun: async () => ({ runId: "run-a", status: "succeeded", reused: true }) },
    keyManager: { decryptDataKey: async () => { throw new Error("must not run"); } }, search: async () => { throw new Error("must not run"); } });
  assert.deepEqual(await service.run({ workspaceId: "workspace-a", uid: "user-a", input }), { runId: "run-a", status: "succeeded", reused: true });
});

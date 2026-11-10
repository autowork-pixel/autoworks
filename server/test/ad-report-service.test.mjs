import assert from "node:assert/strict";
import test from "node:test";
import { encryptCredentialPayload } from "../src/credential-crypto.mjs";
import { createAdReportService } from "../src/ad-report-service.mjs";

const input = { projectId: "project-a", provider: "meta-ads", since: "2026-10-01", until: "2026-10-07", idempotencyKey: "random-request-key-0001" };

test("고객 광고 자격정보로 보고서를 수집하고 비밀값 없이 정산한다", async () => {
  const key = Buffer.alloc(32, 4);
  const envelope = encryptCredentialPayload({ provider: "meta-ads", credentials: { accessToken: "private-token", adAccountId: "123" },
    plaintextDataKey: key, encryptedDataKey: "wrapped", keyVersion: "kms-v1" });
  let finished;
  const service = createAdReportService({ repository: {
    reserveAdReportRun: async () => ({ runId: "run-a", reused: false, envelope }),
    finishAdReportRun: async value => { finished = value; return { status: "succeeded" }; }
  }, keyManager: { decryptDataKey: async value => { assert.equal(value.provider, "meta-ads"); return Buffer.from(key); } },
  fetchReport: async value => { assert.equal(value.credentials.accessToken, "private-token"); return [{ platform: "meta-ads", impressions: 100, clicks: 10, cost: 1000, conversions: 2, revenue: 3000 }]; } });
  const result = await service.run({ workspaceId: "workspace-a", uid: "user-a", input });
  assert.equal(result.summary.total.roas, 300);
  assert.equal(finished.providerCalled, true);
  assert.equal(JSON.stringify({ result, finished }).includes("private-token"), false);
});

test("재사용 실행은 복호화와 제공자 호출을 반복하지 않는다", async () => {
  const service = createAdReportService({ repository: { reserveAdReportRun: async () => ({ runId: "run-a", status: "succeeded", reused: true }) },
    keyManager: { decryptDataKey: async () => { throw new Error("must not run"); } }, fetchReport: async () => { throw new Error("must not run"); } });
  assert.deepEqual(await service.run({ workspaceId: "workspace-a", uid: "user-a", input }), { runId: "run-a", status: "succeeded", reused: true });
});

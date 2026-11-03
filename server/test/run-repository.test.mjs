import assert from "node:assert/strict";
import test from "node:test";
import { createRunRepository } from "../src/run-repository.mjs";

class Ref {
  constructor(database, path) { this.database = database; this.path = path; this.id = path.split("/").at(-1); }
  collection(name) { return new Collection(this.database, `${this.path}/${name}`); }
}
class Collection {
  constructor(database, path) { this.database = database; this.path = path; }
  doc(id = `auto-${++this.database.sequence}`) { return new Ref(this.database, `${this.path}/${id}`); }
}
function fakeDatabase(seed) {
  const values = new Map(Object.entries(seed));
  const writes = [];
  const database = {
    sequence: 0,
    doc: path => new Ref(database, path),
    runTransaction: callback => callback({
      get: async ref => { const exists = values.has(ref.path); const value = values.get(ref.path); return { exists, data: () => value }; },
      set: (ref, value, options) => {
        const next = options?.merge ? { ...(values.get(ref.path) || {}), ...value } : value;
        values.set(ref.path, next); writes.push(["set", ref.path, value, options]);
      },
      delete: ref => { values.delete(ref.path); writes.push(["delete", ref.path]); }
    })
  };
  return { database, values, writes };
}

const runPath = "workspaces/workspace-a/runs/run-a";
const reservationPath = "workspaces/workspace-a/usageReservations/run-a";
const usagePath = "workspaces/workspace-a/usage/2026-11";

test("대기 중 실행 취소는 예약 사용량을 반환하고 비공개 입력을 삭제한다", async () => {
  const fake = fakeDatabase({
    "workspaces/workspace-a": { ownerUid: "user-a" },
    [runPath]: { status: "queued", inputId: "run-a", requestDocumentId: "request-a" },
    [reservationPath]: { status: "reserved", runs: 1, keywordLookups: 2, usagePeriod: "2026-11" },
    [usagePath]: { runsReserved: 1, keywordLookupsReserved: 2, runs: 3, keywordLookups: 6 },
    "workspaces/workspace-a/runInputs/run-a": { keywords: ["오토웍스"] }
  });
  const repository = createRunRepository({ database: fake.database, serverTimestamp: () => "server-time" });
  assert.deepEqual(await repository.cancelBrandSearchRun({ workspaceId: "workspace-a", runId: "run-a", uid: "user-a" }), { status: "canceled", reused: false });
  assert.equal(fake.values.get(runPath).status, "canceled");
  assert.equal(fake.values.get(reservationPath).status, "released");
  assert.equal(fake.values.get(usagePath).runsReserved, 0);
  assert.equal(fake.values.get(usagePath).keywordLookupsReserved, 0);
  assert.equal(fake.values.has("workspaces/workspace-a/runInputs/run-a"), false);
  assert.equal(fake.values.get("workspaces/workspace-a/runRequests/request-a").status, "canceled");
  const writes = fake.writes.length;
  assert.deepEqual(await repository.cancelBrandSearchRun({ workspaceId: "workspace-a", runId: "run-a", uid: "user-a" }), { status: "canceled", reused: true });
  assert.equal(fake.writes.length, writes);
});

test("다른 고객과 이미 시작된 실행은 취소할 수 없다", async () => {
  const base = {
    "workspaces/workspace-a": { ownerUid: "user-a" },
    [reservationPath]: { status: "reserved", runs: 1, keywordLookups: 2, usagePeriod: "2026-11" }
  };
  const foreign = fakeDatabase({ ...base, [runPath]: { status: "queued" } });
  const foreignRepository = createRunRepository({ database: foreign.database, serverTimestamp: () => "server-time" });
  await assert.rejects(() => foreignRepository.cancelBrandSearchRun({ workspaceId: "workspace-a", runId: "run-a", uid: "user-b" }), error => error.code === "AUTH_REQUIRED");
  const running = fakeDatabase({ ...base, [runPath]: { status: "running", leaseOwner: "worker-a" } });
  const runningRepository = createRunRepository({ database: running.database, serverTimestamp: () => "server-time" });
  await assert.rejects(() => runningRepository.cancelBrandSearchRun({ workspaceId: "workspace-a", runId: "run-a", uid: "user-a" }), error => error.code === "RUN_CANCEL_CONFLICT");
});

test("한 작업자에게 lease를 주고 만료 전 다른 작업자를 차단한다", async () => {
  const fake = fakeDatabase({ [runPath]: { status: "queued", attempt: 0 } });
  const now = new Date("2026-11-03T00:00:00Z");
  const repository = createRunRepository({ database: fake.database, serverTimestamp: () => "server-time", now: () => now, leaseMs: 60000 });
  await repository.markRunning("workspace-a", "run-a", { workerId: "worker-a" });
  const run = fake.values.get(runPath);
  assert.equal(run.status, "running");
  assert.equal(run.leaseOwner, "worker-a");
  assert.equal(run.leaseExpiresAt.toISOString(), "2026-11-03T00:01:00.000Z");
  assert.equal(run.attempt, 1);
  await assert.rejects(() => repository.markRunning("workspace-a", "run-a", { workerId: "worker-b" }), error => error.code === "RUN_LEASE_CONFLICT");
});

test("완료는 스냅샷·보고서·사용량·예약·멱등 상태를 한 번만 확정한다", async () => {
  const now = new Date("2026-11-03T00:00:00Z");
  const fake = fakeDatabase({
    [runPath]: { status: "running", leaseOwner: "worker-a", leaseExpiresAt: new Date("2026-11-03T00:01:00Z"), projectId: "project-a", inputSummary: { brand: "오토웍스" }, requestDocumentId: "request-a" },
    [reservationPath]: { status: "reserved", runs: 1, keywordLookups: 2, usagePeriod: "2026-11" },
    [usagePath]: { runsReserved: 1, keywordLookupsReserved: 2, runs: 3, keywordLookups: 6, succeeded: 2, failed: 1 }
  });
  const repository = createRunRepository({ database: fake.database, serverTimestamp: () => "server-time", now: () => now });
  const payload = { workerId: "worker-a", keywordLookups: 2, succeededKeywords: 2, failedKeywords: 0, failures: [], snapshots: [
    { keyword: "오토웍스", pc: 10, mobile: 20, total: 30, recordedAt: now },
    { keyword: "마케팅", pc: 5, mobile: 15, total: 20, recordedAt: now }
  ] };
  assert.deepEqual(await repository.completeRun("workspace-a", "run-a", payload), { status: "succeeded", reused: false });
  assert.deepEqual(fake.values.get(usagePath), { runsReserved: 0, keywordLookupsReserved: 0, runs: 4, keywordLookups: 8, succeeded: 3, failed: 1, updatedAt: "server-time" });
  assert.equal(fake.values.get(runPath).status, "succeeded");
  assert.equal(fake.values.get(reservationPath).status, "committed");
  assert.equal(fake.values.get("workspaces/workspace-a/runRequests/request-a").status, "succeeded");
  assert.equal([...fake.values.keys()].filter(path => path.includes("/searchSnapshots/")).length, 2);
  const writes = fake.writes.length;
  assert.deepEqual(await repository.completeRun("workspace-a", "run-a", payload), { status: "succeeded", reused: true });
  assert.equal(fake.writes.length, writes);
});

test("실패 확정은 lease 소유자를 확인하고 예약을 한 번만 정산한다", async () => {
  const now = new Date("2026-11-03T00:00:00Z");
  const fake = fakeDatabase({
    [runPath]: { status: "running", leaseOwner: "worker-a", leaseExpiresAt: new Date("2026-11-03T00:01:00Z"), attempt: 1, maxAttempts: 1 },
    [reservationPath]: { status: "reserved", runs: 1, keywordLookups: 2, usagePeriod: "2026-11" },
    [usagePath]: { runsReserved: 1, keywordLookupsReserved: 2 }
  });
  const repository = createRunRepository({ database: fake.database, serverTimestamp: () => "server-time", now: () => now });
  await assert.rejects(() => repository.failRun("workspace-a", "run-a", { workerId: "worker-b", keywordLookups: 2, errorCode: "PROVIDER_UNAVAILABLE", failures: [] }), error => error.code === "RUN_LEASE_CONFLICT");
  await repository.failRun("workspace-a", "run-a", { workerId: "worker-a", keywordLookups: 2, errorCode: "PROVIDER_UNAVAILABLE", failures: [] });
  assert.equal(fake.values.get(runPath).status, "failed");
  assert.equal(fake.values.get(usagePath).runs, 1);
  assert.equal(fake.values.get(usagePath).failed, 1);
  const writes = fake.writes.length;
  assert.deepEqual(await repository.failRun("workspace-a", "run-a", { workerId: "worker-a", keywordLookups: 2, errorCode: "PROVIDER_UNAVAILABLE", failures: [] }), { status: "failed", reused: true });
  assert.equal(fake.writes.length, writes);
});

test("일시 오류는 지수 백오프로 재시도하고 고객 사용량은 아직 확정하지 않는다", async () => {
  const now = new Date("2026-11-03T00:00:00Z");
  const fake = fakeDatabase({
    [runPath]: { status: "running", leaseOwner: "worker-a", leaseExpiresAt: new Date("2026-11-03T00:01:00Z"), attempt: 1, maxAttempts: 3, requestDocumentId: "request-a" },
    [reservationPath]: { status: "reserved", runs: 1, keywordLookups: 2, usagePeriod: "2026-11" },
    [usagePath]: { runsReserved: 1, keywordLookupsReserved: 2, runs: 0, keywordLookups: 0 }
  });
  const repository = createRunRepository({ database: fake.database, serverTimestamp: () => "server-time", now: () => now });
  const result = await repository.failRun("workspace-a", "run-a", { workerId: "worker-a", keywordLookups: 2, errorCode: "PROVIDER_UNAVAILABLE", failures: [], retryable: true });
  assert.equal(result.status, "retrying");
  assert.equal(result.nextRetryAt.toISOString(), "2026-11-03T00:01:00.000Z");
  assert.equal(fake.values.get(runPath).status, "retrying");
  assert.equal(fake.values.get(reservationPath).providerKeywordAttempts, 2);
  assert.equal(fake.values.get(usagePath).runs, 0);
  assert.equal(fake.values.get("workspaces/workspace-a/runRequests/request-a").status, "retrying");
});

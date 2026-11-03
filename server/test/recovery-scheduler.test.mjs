import assert from "node:assert/strict";
import test from "node:test";
import { createRecoveryScheduler } from "../src/recovery-scheduler.mjs";

test("기한이 지난 대기·재시도 실행을 각각 큐에 다시 넣고 결과를 기록한다", async () => {
  const records = [];
  const calls = [];
  const scheduler = createRecoveryScheduler({
    now: () => new Date("2026-11-03T00:10:00Z"),
    source: {
      listRecoverable: async value => { calls.push(value); return [
        { workspaceId: "workspace-a", runId: "run-a", status: "queued" },
        { workspaceId: "workspace-b", runId: "run-b", status: "retrying" },
        { workspaceId: "workspace-c", runId: "run-c", status: "retrying" }
      ]; },
      recordDispatch: async value => records.push(value)
    },
    taskDispatcher: { dispatch: async ({ runId }) => {
      if (runId === "run-b") return { reused: true };
      if (runId === "run-c") throw Object.assign(new Error("secret queue detail"), { code: "TASK_DISPATCH_FAILED" });
      return { reused: false };
    } }
  });
  assert.deepEqual(await scheduler.runOnce(), { scanned: 3, dispatched: 1, reused: 1, failed: 1 });
  assert.equal(calls[0].queuedBefore.toISOString(), "2026-11-03T00:05:00.000Z");
  assert.equal(records[2].errorCode, "TASK_DISPATCH_FAILED");
  assert.equal(JSON.stringify(records).includes("secret queue detail"), false);
});

test("복구 대상이 없으면 큐를 호출하지 않는다", async () => {
  let called = false;
  const scheduler = createRecoveryScheduler({
    source: { listRecoverable: async () => [], recordDispatch: async () => {} },
    taskDispatcher: { dispatch: async () => { called = true; } }
  });
  assert.deepEqual(await scheduler.runOnce(), { scanned: 0, dispatched: 0, reused: 0, failed: 0 });
  assert.equal(called, false);
});

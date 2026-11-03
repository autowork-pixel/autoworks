import assert from "node:assert/strict";
import { createServer } from "node:http";
import { afterEach, test } from "node:test";
import { createRecoveryHandler } from "../src/recovery-handler.mjs";

const servers = [];
afterEach(async () => Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve)))));
async function listen(handler) { const server = createServer(handler); servers.push(server); await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); return `http://127.0.0.1:${server.address().port}`; }

test("검증된 스케줄러 신원만 복구 실행 결과를 받는다", async () => {
  let runs = 0;
  const base = await listen(createRecoveryHandler({
    verifyTaskRequest: async () => ({ subject: "scheduler" }),
    scheduler: { runOnce: async () => { runs++; return { scanned: 2, dispatched: 1, reused: 1, failed: 0 }; } }
  }));
  const response = await fetch(`${base}/internal/v1/recovery:run`, { method: "POST", headers: { authorization: "Bearer valid" } });
  assert.equal(response.status, 200);
  assert.deepEqual(Object.fromEntries(Object.entries(await response.json()).filter(([key]) => key !== "requestId")), { scanned: 2, dispatched: 1, reused: 1, failed: 0 });
  assert.equal(runs, 1);
});

test("신원 검증 실패 시 복구 저장소를 호출하지 않는다", async () => {
  let runs = 0;
  const base = await listen(createRecoveryHandler({
    verifyTaskRequest: async () => { throw new Error("bad token"); },
    scheduler: { runOnce: async () => { runs++; } }
  }));
  const response = await fetch(`${base}/internal/v1/recovery:run`, { method: "POST" });
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error.code, "AUTH_REQUIRED");
  assert.equal(runs, 0);
});

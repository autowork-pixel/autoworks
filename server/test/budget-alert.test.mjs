import assert from "node:assert/strict";
import { createServer } from "node:http";
import { afterEach, test } from "node:test";
import { createBudgetAlertHandler } from "../src/budget-alert-handler.mjs";
import { createBudgetAlertRepository } from "../src/budget-alert-repository.mjs";
import { createBudgetAlertService, normalizeBudgetPush } from "../src/budget-alert-service.mjs";

const budgetName = "autoworks-development-monthly-50000";
const servers = [];
afterEach(async () => Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve)))));
async function listen(handler) { const server = createServer(handler); servers.push(server); await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); return `http://127.0.0.1:${server.address().port}`; }
function push({ messageId = "12345", costAmount = 50_000, budgetAmount = 50_000, threshold = 1, name = budgetName } = {}) {
  return { message: { messageId, attributes: { schemaVersion: "1.0", billingAccountId: "not-stored", budgetId: "not-stored" }, data: Buffer.from(JSON.stringify({ budgetDisplayName: name, costAmount, budgetAmount, alertThresholdExceeded: threshold, costIntervalStart: "2026-11-01T00:00:00Z" })).toString("base64") } };
}

test("공식 예산 알림을 정규화하고 100% 이상만 차단한다", () => {
  const below = normalizeBudgetPush(push({ costAmount: 40_000, threshold: 0.8 }), budgetName);
  const exceeded = normalizeBudgetPush(push(), budgetName);
  assert.equal(below.shouldBlock, false);
  assert.equal(exceeded.shouldBlock, true);
  assert.equal(exceeded.costRatio, 1);
  assert.match(exceeded.eventId, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(exceeded).includes("not-stored"), false);
});

test("다른 예산과 손상된 알림은 저장소 호출 전에 거부한다", async () => {
  let calls = 0;
  const service = createBudgetAlertService({ expectedBudgetDisplayName: budgetName, repository: { record: async () => { calls++; } } });
  assert.throws(() => service.process(push({ name: "other-budget" })), error => error.status === 403);
  assert.throws(() => service.process({ message: { messageId: "1", attributes: { schemaVersion: "1.0" }, data: "***" } }), error => error.status === 400);
  assert.equal(calls, 0);
});

test("OIDC로 검증된 알림만 처리하고 인증 원문은 응답하지 않는다", async () => {
  let calls = 0;
  const handler = createBudgetAlertHandler({
    verifyTaskRequest: async request => request.headers.authorization === "Bearer valid" ? { subject: "pubsub" } : Promise.reject(new Error("bad")),
    service: { process: async () => { calls++; return { blocked: true, reused: false }; } }
  });
  const base = await listen(handler);
  const denied = await fetch(`${base}/internal/v1/budget-alerts:receive`, { method: "POST", body: JSON.stringify(push()) });
  assert.equal(denied.status, 401);
  const accepted = await fetch(`${base}/internal/v1/budget-alerts:receive`, { method: "POST", headers: { authorization: "Bearer valid", "content-type": "application/json" }, body: JSON.stringify(push()) });
  assert.equal(accepted.status, 200);
  assert.equal((await accepted.json()).blocked, true);
  assert.equal(calls, 1);
});

test("예산 이벤트는 멱등 저장하고 100% 도달 시 자동화 차단만 켠다", async () => {
  const writes = [];
  const database = {
    doc: path => ({ path }),
    runTransaction: operation => operation({
      get: async () => ({ exists: false }),
      set: (...args) => writes.push(args)
    })
  };
  const repository = createBudgetAlertRepository({ database, serverTimestamp: () => "server-time" });
  const result = await repository.record(normalizeBudgetPush(push(), budgetName));
  assert.deepEqual(result, { blocked: true, reused: false });
  assert.equal(writes.length, 2);
  assert.equal(writes[0][0].path.includes("budgetEvents/"), true);
  assert.deepEqual(writes[1][1], { blocked: true, reason: "budget_threshold_100", source: "cloud-billing-budget", updatedAt: "server-time" });
  assert.equal(JSON.stringify(writes).includes("billingAccountId"), false);
});

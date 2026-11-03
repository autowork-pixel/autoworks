import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import { createWorkerHandler } from "../src/worker-handler.mjs";

async function withServer(dependencies, callback) {
  const server = createServer(createWorkerHandler(dependencies));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try { await callback(`http://127.0.0.1:${server.address().port}`); }
  finally { server.close(); await once(server, "close"); }
}

const path = "/internal/v1/workspaces/workspace-a/runs/run-a:execute";

test("OIDC 작업 신원이 없으면 컨텍스트를 불러오지 않는다", async () => {
  let loaded = false;
  await withServer({
    verifyTaskRequest: async () => { throw new Error("bad oidc"); },
    contextLoader: { load: async () => { loaded = true; } }, provider: {}, repository: {}
  }, async base => {
    const response = await fetch(`${base}${path}`, { method: "POST" });
    assert.equal(response.status, 401);
    assert.equal(loaded, false);
  });
});

test("검증된 작업은 경로 ID만으로 서버 컨텍스트를 불러와 실행한다", async () => {
  const calls = [];
  await withServer({
    verifyTaskRequest: async () => ({ subject: "cloud-tasks-service" }),
    contextLoader: { load: async value => { calls.push(["load", value]); return { input: { keywords: ["오토웍스"] }, credentials: { secretKey: "never-return" } }; } },
    provider: { fetchKeywordVolume: async ({ keyword }) => ({ keyword, pc: 1, mobile: 2, total: 3 }) },
    repository: {
      markRunning: async (...args) => calls.push(["running", ...args]),
      completeRun: async (...args) => calls.push(["complete", ...args]),
      failRun: async (...args) => calls.push(["failed", ...args])
    }
  }, async base => {
    const response = await fetch(`${base}${path}`, { method: "POST" });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.status, "succeeded");
    assert.deepEqual(calls[0], ["load", { workspaceId: "workspace-a", runId: "run-a" }]);
    assert.equal(JSON.stringify(body).includes("never-return"), false);
    assert.equal(JSON.stringify(calls.at(-1)).includes("never-return"), false);
  });
});

test("내부 오류 원문과 인증정보는 응답과 구조화 로그에서 제외한다", async () => {
  const logs = [];
  await withServer({
    verifyTaskRequest: async () => ({ subject: "cloud-tasks-service" }),
    contextLoader: { load: async () => { throw new Error("secret credential detail"); } }, provider: {}, repository: {},
    logger: { error: (...args) => logs.push(args) }
  }, async base => {
    const response = await fetch(`${base}${path}`, { method: "POST" });
    const body = await response.json();
    assert.equal(response.status, 500);
    assert.equal(JSON.stringify(body).includes("secret credential detail"), false);
    assert.equal(JSON.stringify(logs).includes("secret credential detail"), false);
  });
});

test("이미 종료된 실행은 자격정보 실행 없이 기존 상태를 반환한다", async () => {
  let providerCalled = false;
  await withServer({
    verifyTaskRequest: async () => ({ subject: "cloud-tasks-service" }),
    contextLoader: { load: async () => ({ terminalStatus: "succeeded" }) },
    provider: { fetchKeywordVolume: async () => { providerCalled = true; } }, repository: {}
  }, async base => {
    const response = await fetch(`${base}${path}`, { method: "POST" });
    const body = await response.json();
    assert.equal(body.status, "succeeded");
    assert.equal(body.reused, true);
    assert.equal(providerCalled, false);
  });
});

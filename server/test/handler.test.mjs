import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { once } from "node:events";
import { ApiError } from "../src/domain.mjs";
import { createHandler } from "../src/handler.mjs";

async function withServer(dependencies, callback) {
  const server = createServer(createHandler(dependencies));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    await callback(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

const validBody = {
  projectId: "project-a",
  brand: "오토웍스",
  competitors: [],
  keywords: ["마케팅 자동화"],
  displayPeriodDays: 28,
  roundingUnit: 10,
  idempotencyKey: "random-request-key-0001"
};

const requestRun = (base, body = validBody, headers = {}) => fetch(`${base}/v1/workspaces/workspace-a/brand-search-runs`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: "Bearer token", ...headers },
  body: JSON.stringify(body)
});

test("health check는 인증 없이 응답한다", async () => {
  await withServer({ verifyIdToken: async () => ({}), repository: {} }, async base => {
    const response = await fetch(`${base}/healthz`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
  });
});

test("로그인 토큰이 없으면 repository를 호출하지 않는다", async () => {
  let called = false;
  await withServer({ verifyIdToken: async () => ({ uid: "user-a" }), repository: { reserveBrandSearchRun: async () => { called = true; } } }, async base => {
    const response = await fetch(`${base}/v1/workspaces/workspace-a/brand-search-runs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(validBody) });
    assert.equal(response.status, 401);
    assert.equal(called, false);
  });
});

test("JSON이 아닌 본문은 인증·repository 호출 전에 거부한다", async () => {
  let authCalled = false;
  let repositoryCalled = false;
  await withServer({
    verifyIdToken: async () => { authCalled = true; return { uid: "user-a" }; },
    repository: { reserveBrandSearchRun: async () => { repositoryCalled = true; } }
  }, async base => {
    const response = await fetch(`${base}/v1/workspaces/workspace-a/brand-search-runs`, {
      method: "POST",
      headers: { "content-type": "text/plain", authorization: "Bearer token" },
      body: "not-json"
    });
    assert.equal(response.status, 415);
    assert.equal(authCalled, false);
    assert.equal(repositoryCalled, false);
  });
});

test("64KB를 넘는 본문은 repository 호출 전에 거부한다", async () => {
  let called = false;
  await withServer({
    verifyIdToken: async () => ({ uid: "user-a" }),
    repository: { reserveBrandSearchRun: async () => { called = true; } }
  }, async base => {
    const response = await requestRun(base, { ...validBody, brand: "가".repeat(70 * 1024) });
    assert.equal(response.status, 413);
    assert.equal(called, false);
  });
});

test("정상 요청은 uid와 정규화된 입력으로 실행을 예약한다", async () => {
  let received;
  await withServer({
    verifyIdToken: async () => ({ uid: "user-a" }),
    repository: { reserveBrandSearchRun: async value => { received = value; return { runId: "run-a", status: "queued", reused: false }; } }
  }, async base => {
    const response = await requestRun(base);
    assert.equal(response.status, 202);
    const body = await response.json();
    assert.equal(body.runId, "run-a");
    assert.equal(body.reused, false);
    assert.equal(received.uid, "user-a");
    assert.deepEqual(received.input.keywords, ["오토웍스", "마케팅 자동화"]);
  });
});

test("같은 멱등 요청은 기존 실행을 반환한다", async () => {
  await withServer({
    verifyIdToken: async () => ({ uid: "user-a" }),
    repository: { reserveBrandSearchRun: async () => ({ runId: "run-a", status: "queued", reused: true }) }
  }, async base => {
    const response = await requestRun(base);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).reused, true);
  });
});

test("도메인 오류는 안전한 코드로 반환한다", async () => {
  await withServer({
    verifyIdToken: async () => ({ uid: "user-a" }),
    repository: { reserveBrandSearchRun: async () => { throw new ApiError("USAGE_LIMIT_EXCEEDED", "이번 기간의 실행 한도를 초과했습니다.", 429); } }
  }, async base => {
    const response = await requestRun(base);
    assert.equal(response.status, 429);
    assert.equal((await response.json()).error.code, "USAGE_LIMIT_EXCEEDED");
  });
});

test("예상하지 못한 오류 내용은 고객 응답에 노출하지 않는다", async () => {
  const logs = [];
  await withServer({
    verifyIdToken: async () => ({ uid: "user-a" }),
    repository: { reserveBrandSearchRun: async () => { throw new Error("secret database detail"); } },
    logger: { error: (...args) => logs.push(args) }
  }, async base => {
    const response = await requestRun(base);
    const body = await response.json();
    assert.equal(response.status, 500);
    assert.equal(body.error.code, "INTERNAL_ERROR");
    assert.equal(JSON.stringify(body).includes("secret database detail"), false);
    assert.equal(logs.length, 1);
  });
});

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
  const dispatched = [];
  await withServer({
    verifyIdToken: async () => ({ uid: "user-a" }),
    repository: { reserveBrandSearchRun: async () => ({ runId: "run-a", status: "queued", reused: true }) },
    taskDispatcher: { dispatch: async value => dispatched.push(value) }
  }, async base => {
    const response = await requestRun(base);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).reused, true);
    assert.deepEqual(dispatched, [{ workspaceId: "workspace-a", runId: "run-a" }]);
  });
});

test("큐 등록 실패 후 같은 멱등 요청을 재시도할 수 있게 503을 반환한다", async () => {
  await withServer({
    verifyIdToken: async () => ({ uid: "user-a" }),
    repository: { reserveBrandSearchRun: async () => ({ runId: "run-a", status: "queued", reused: false }) },
    taskDispatcher: { dispatch: async () => { throw new ApiError("TASK_DISPATCH_FAILED", "같은 요청으로 다시 시도해주세요.", 503); } }
  }, async base => {
    const response = await requestRun(base);
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.equal(body.error.code, "TASK_DISPATCH_FAILED");
  });
});

test("로그인한 소유자의 실행 취소 요청을 저장소에 전달한다", async () => {
  let received;
  await withServer({
    verifyIdToken: async () => ({ uid: "user-a" }),
    repository: { cancelBrandSearchRun: async value => { received = value; return { status: "canceled", reused: false }; } }
  }, async base => {
    const response = await fetch(`${base}/v1/workspaces/workspace-a/brand-search-runs/run-a:cancel`, { method: "POST", headers: { authorization: "Bearer token" } });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).status, "canceled");
    assert.deepEqual(received, { workspaceId: "workspace-a", runId: "run-a", uid: "user-a" });
  });
});

test("실행 상태와 UTF-8 CSV 결과를 인증 후 반환한다", async () => {
  await withServer({
    verifyIdToken: async () => ({ uid: "user-a" }),
    repository: {
      getBrandSearchRun: async () => ({ runId: "run-a", status: "succeeded", resultReady: true }),
      getBrandSearchReport: async () => ({ rows: [{ keyword: "=위험", pc: 1, mobile: 2, total: 3, recordedAt: new Date("2026-11-03T00:00:00Z") }] })
    }
  }, async base => {
    const headers = { authorization: "Bearer token" };
    const statusResponse = await fetch(`${base}/v1/workspaces/workspace-a/brand-search-runs/run-a`, { headers });
    assert.equal(statusResponse.status, 200);
    assert.equal((await statusResponse.json()).resultReady, true);
    const csvResponse = await fetch(`${base}/v1/workspaces/workspace-a/brand-search-runs/run-a/report.csv`, { headers });
    const body = await csvResponse.text();
    assert.equal(csvResponse.status, 200);
    assert.match(csvResponse.headers.get("content-disposition"), /brand-search-run-a\.csv/);
    assert.equal(body.includes("'=위험"), true);
    assert.equal(body.includes("2026-11-03T00:00:00.000Z"), true);
  });
});

test("최근 실행 목록은 인증 uid와 제한 개수를 저장소에 전달한다", async () => {
  let received;
  await withServer({
    verifyIdToken: async () => ({ uid: "user-a" }),
    repository: { listBrandSearchRuns: async value => { received = value; return [{ runId: "run-a", status: "succeeded", resultReady: true }]; } }
  }, async base => {
    const response = await fetch(`${base}/v1/workspaces/workspace-a/brand-search-runs?limit=10`, { headers: { authorization: "Bearer token" } });
    assert.equal(response.status, 200);
    assert.deepEqual(received, { workspaceId: "workspace-a", uid: "user-a", limit: 10 });
    assert.equal((await response.json()).runs[0].runId, "run-a");
  });
});

test("최근 실행 목록의 과도한 개수는 저장소 호출 전에 거부한다", async () => {
  let called = false;
  await withServer({
    verifyIdToken: async () => ({ uid: "user-a" }),
    repository: { listBrandSearchRuns: async () => { called = true; return []; } }
  }, async base => {
    const response = await fetch(`${base}/v1/workspaces/workspace-a/brand-search-runs?limit=100`, { headers: { authorization: "Bearer token" } });
    assert.equal(response.status, 400);
    assert.equal(called, false);
  });
});

test("로그인 토큰 없이는 실행 취소 저장소를 호출하지 않는다", async () => {
  let called = false;
  await withServer({ verifyIdToken: async () => ({ uid: "user-a" }), repository: { cancelBrandSearchRun: async () => { called = true; } } }, async base => {
    const response = await fetch(`${base}/v1/workspaces/workspace-a/brand-search-runs/run-a:cancel`, { method: "POST" });
    assert.equal(response.status, 401);
    assert.equal(called, false);
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

test("키 관리 서비스가 없으면 API 연결 경로를 공개하지 않는다", async () => {
  await withServer({ verifyIdToken: async () => ({ uid: "user-a" }), repository: {} }, async base => {
    const response = await fetch(`${base}/v1/workspaces/workspace-a/provider-credentials/naver-searchad`, { headers: { authorization: "Bearer token" } });
    assert.equal(response.status, 404);
  });
});

test("API 연결 상태 조회는 토큰 uid와 워크스페이스를 서비스에 전달한다", async () => {
  let received;
  await withServer({
    verifyIdToken: async () => ({ uid: "user-a" }),
    repository: {},
    credentialService: { status: async value => { received = value; return { provider: "naver-searchad", status: "active", apiKeyHint: "••••1234" }; } }
  }, async base => {
    const response = await fetch(`${base}/v1/workspaces/workspace-a/provider-credentials/naver-searchad`, { headers: { authorization: "Bearer token" } });
    assert.equal(response.status, 200);
    assert.deepEqual(received, { workspaceId: "workspace-a", provider: "naver-searchad", uid: "user-a" });
    assert.equal(JSON.stringify(await response.json()).includes("ciphertext"), false);
  });
});

test("API 연결 저장 응답에는 원문 인증정보가 포함되지 않는다", async () => {
  let received;
  await withServer({
    verifyIdToken: async () => ({ uid: "user-a" }), repository: {},
    credentialService: { save: async value => { received = value; return { provider: "naver-searchad", status: "active", apiKeyHint: "••••1234" }; } }
  }, async base => {
    const credentials = { apiKey: "license-1234", secretKey: "very-secret", customerId: "987654" };
    const response = await fetch(`${base}/v1/workspaces/workspace-a/provider-credentials/naver-searchad`, {
      method: "PUT", headers: { authorization: "Bearer token", "content-type": "application/json" }, body: JSON.stringify(credentials)
    });
    assert.equal(response.status, 200);
    assert.deepEqual(received.credentials, credentials);
    const body = JSON.stringify(await response.json());
    assert.equal(body.includes("very-secret"), false);
    assert.equal(body.includes("license-1234"), false);
  });
});

test("API 연결 해제는 토큰 uid를 검증한 뒤 서비스에 위임한다", async () => {
  let received;
  await withServer({
    verifyIdToken: async () => ({ uid: "user-a" }), repository: {},
    credentialService: { remove: async value => { received = value; return { provider: "naver-searchad", status: "disconnected" }; } }
  }, async base => {
    const response = await fetch(`${base}/v1/workspaces/workspace-a/provider-credentials/naver-searchad`, { method: "DELETE", headers: { authorization: "Bearer token" } });
    assert.equal(response.status, 200);
    assert.equal(received.uid, "user-a");
  });
});

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { afterEach, test } from "node:test";
import { createCorsHandler } from "../src/cors-handler.mjs";

const servers = [];
afterEach(async () => Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve)))));

async function listen(handler) {
  const server = createServer(handler);
  servers.push(server);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

function subject(calls = []) {
  return createCorsHandler({
    allowedOrigins: ["https://autoworks-c9a6a.web.app"],
    handler: (request, response) => {
      calls.push(request.url);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
    }
  });
}

test("허용된 웹 출처의 사전 요청에 필요한 헤더만 반환한다", async () => {
  const calls = [];
  const base = await listen(subject(calls));
  const response = await fetch(`${base}/v1/test`, {
    method: "OPTIONS",
    headers: { origin: "https://autoworks-c9a6a.web.app", "access-control-request-method": "POST" }
  });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), "https://autoworks-c9a6a.web.app");
  assert.equal(response.headers.get("access-control-allow-headers"), "authorization, content-type");
  assert.deepEqual(calls, []);
});

test("비허용 출처는 본 처리 전에 차단한다", async () => {
  const calls = [];
  const base = await listen(subject(calls));
  const response = await fetch(`${base}/v1/test`, { headers: { origin: "https://attacker.example" } });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, "ORIGIN_NOT_ALLOWED");
  assert.deepEqual(calls, []);
});

test("허용된 실제 요청과 출처 없는 서버 요청을 처리한다", async () => {
  const calls = [];
  const base = await listen(subject(calls));
  const browser = await fetch(`${base}/v1/browser`, { headers: { origin: "https://autoworks-c9a6a.web.app" } });
  const server = await fetch(`${base}/v1/server`);
  assert.equal(browser.status, 200);
  assert.equal(browser.headers.get("access-control-allow-origin"), "https://autoworks-c9a6a.web.app");
  assert.equal(server.status, 200);
  assert.equal(server.headers.get("access-control-allow-origin"), null);
  assert.deepEqual(calls, ["/v1/browser", "/v1/server"]);
});

test("잘못된 출처 설정을 시작 전에 거부한다", () => {
  assert.throws(() => createCorsHandler({ handler() {}, allowedOrigins: ["https://example.com/path"] }), /invalid/);
});

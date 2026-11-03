import assert from "node:assert/strict";
import test from "node:test";
import { createTaskDispatcher } from "../src/task-dispatcher.mjs";

function dispatcher(createTask) {
  return createTaskDispatcher({
    client: { createTask }, projectId: "autoworks-c9a6a", location: "asia-northeast3", queue: "brand-search",
    workerUrl: "https://worker.example.com", serviceAccountEmail: "tasks@autoworks-c9a6a.iam.gserviceaccount.com"
  });
}

test("경로 ID만 담은 OIDC 작업을 결정적 이름으로 등록한다", async () => {
  let request;
  const result = await dispatcher(async value => { request = value; }).dispatch({ workspaceId: "workspace-a", runId: "run-a" });
  assert.equal(result.reused, false);
  assert.match(result.taskName, /\/tasks\/brand-search-[0-9a-f]{32}$/);
  assert.equal(request.task.httpRequest.url, "https://worker.example.com/internal/v1/workspaces/workspace-a/runs/run-a:execute");
  assert.equal(request.task.httpRequest.body, undefined);
  assert.equal(request.task.httpRequest.oidcToken.serviceAccountEmail, "tasks@autoworks-c9a6a.iam.gserviceaccount.com");
});

test("동일 작업명이 이미 있으면 성공한 재사용으로 처리한다", async () => {
  const existing = Object.assign(new Error("already exists"), { code: 6 });
  const result = await dispatcher(async () => { throw existing; }).dispatch({ workspaceId: "workspace-a", runId: "run-a" });
  assert.equal(result.reused, true);
});

test("큐 오류 원문을 숨기고 재시도 가능한 안전한 오류를 반환한다", async () => {
  await assert.rejects(
    () => dispatcher(async () => { throw new Error("internal queue credential detail"); }).dispatch({ workspaceId: "workspace-a", runId: "run-a" }),
    error => error.code === "TASK_DISPATCH_FAILED" && error.status === 503 && !error.message.includes("credential")
  );
});

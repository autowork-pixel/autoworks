import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "../src/domain.mjs";
import { executeBrandSearchRun } from "../src/worker-core.mjs";

function repositorySpy() {
  const calls = [];
  return {
    calls,
    markRunning: async (...args) => calls.push(["running", ...args]),
    completeRun: async (...args) => calls.push(["complete", ...args]),
    failRun: async (...args) => calls.push(["failed", ...args])
  };
}

test("키워드별 결과를 모아 실행을 완료한다", async () => {
  const repository = repositorySpy();
  const recordedAt = new Date("2026-11-03T00:00:00Z");
  const result = await executeBrandSearchRun({
    runId: "run-a",
    input: { keywords: ["오토웍스", "마케팅 자동화"] },
    credentials: { secretKey: "never-store" },
    provider: { fetchKeywordVolume: async ({ keyword }) => ({ keyword, pc: 10, mobile: 20, total: 30 }) },
    repository,
    now: () => recordedAt
  });
  assert.equal(result.status, "succeeded");
  assert.deepEqual(repository.calls.map(call => call[0]), ["running", "complete"]);
  assert.equal(repository.calls[1][2].snapshots.length, 2);
  assert.equal(JSON.stringify(repository.calls).includes("never-store"), false);
});

test("일부 실패는 성공·실패 목록을 분리해 완료한다", async () => {
  const repository = repositorySpy();
  const result = await executeBrandSearchRun({
    runId: "run-a",
    input: { keywords: ["성공", "실패"] },
    credentials: {},
    provider: { fetchKeywordVolume: async ({ keyword }) => {
      if (keyword === "실패") throw new ApiError("PROVIDER_RATE_LIMITED", "원문", 429);
      return { keyword, pc: 1, mobile: 2, total: 3 };
    } },
    repository
  });
  assert.equal(result.status, "succeeded");
  assert.equal(result.snapshots.length, 1);
  assert.deepEqual(result.failures, [{ keyword: "실패", code: "PROVIDER_RATE_LIMITED", retryable: true }]);
  assert.equal(repository.calls.at(-1)[0], "complete");
});

test("전부 실패하면 실행을 실패 처리하고 내부 오류는 일반화한다", async () => {
  const repository = repositorySpy();
  const result = await executeBrandSearchRun({
    runId: "run-a",
    input: { keywords: ["첫째", "둘째"] },
    credentials: {},
    provider: { fetchKeywordVolume: async ({ keyword }) => {
      if (keyword === "첫째") throw new Error("secret internal detail");
      throw new ApiError("PROVIDER_AUTH_FAILED", "키 원문", 409);
    } },
    repository
  });
  assert.equal(result.status, "failed");
  assert.deepEqual(result.failures.map(item => item.code), ["PROVIDER_UNAVAILABLE", "PROVIDER_AUTH_FAILED"]);
  assert.equal(JSON.stringify(repository.calls).includes("secret internal detail"), false);
  assert.equal(repository.calls.at(-1)[0], "failed");
});

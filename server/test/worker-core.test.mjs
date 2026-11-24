import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "../src/domain.mjs";
import { executeBrandSearchRun } from "../src/worker-core.mjs";

function repositorySpy() {
  const calls = [];
  return { calls, markRunning: async (...args) => calls.push(["running", ...args]), completeRun: async (...args) => calls.push(["complete", ...args]), failRun: async (...args) => calls.push(["failed", ...args]) };
}
function provider(overrides = {}) {
  return {
    fetchKeywordVolume: async ({ keyword }) => ({ keyword, pc: 10, mobile: 20, total: 30 }),
    trendDateRange: () => ({ startDate: "2026-10-04", endDate: "2026-11-02" }),
    fetchSearchTrends: async ({ keywords }) => new Map(keywords.map(keyword => [keyword, Array.from({ length: 30 }, (_, index) => ({ date: new Date(Date.UTC(2026, 9, 4 + index)).toISOString().slice(0, 10), ratio: 1 }))])),
    estimateDailyVolumes: ({ volume, displayPeriodDays, endDate }) => Array.from({ length: displayPeriodDays }, (_, index) => ({ date: new Date(Date.parse(`${endDate}T00:00:00Z`) - (displayPeriodDays - index - 1) * 86400000).toISOString().slice(0, 10), ratio: 1, pc: 1, mobile: 2, total: 3 })),
    ...overrides
  };
}
const credentials = { searchAd: { secretKey: "never-store" }, searchTrend: { clientSecret: "also-never-store" } };
const input = { keywords: ["오토웍스", "마케팅 자동화"], displayPeriodDays: 7, roundingUnit: 1 };

test("키워드도구와 데이터랩 결과를 결합해 일별 추정치를 저장한다", async () => {
  const repository = repositorySpy();
  const result = await executeBrandSearchRun({ runId: "run-a", workspaceId: "workspace-a", workerId: "worker-a", input, credentials, provider: provider(), repository, now: () => new Date("2026-11-03T00:00:00Z") });
  assert.equal(result.status, "succeeded");
  assert.deepEqual(repository.calls.map(call => call[0]), ["running", "complete"]);
  assert.equal(repository.calls[1][3].snapshots.length, 2);
  assert.equal(repository.calls[1][3].snapshots[0].daily.length, 7);
  assert.equal(JSON.stringify(repository.calls).includes("never-store"), false);
});
test("일부 키워드도구 실패는 성공·실패 목록을 분리해 완료한다", async () => {
  const repository = repositorySpy();
  const result = await executeBrandSearchRun({ runId: "run-a", workspaceId: "workspace-a", workerId: "worker-a", input, credentials, repository, provider: provider({ fetchKeywordVolume: async ({ keyword }) => { if (keyword === "마케팅 자동화") throw new ApiError("PROVIDER_RATE_LIMIT", "원문", 429); return { keyword, pc: 1, mobile: 2, total: 3 }; } }) });
  assert.equal(result.status, "succeeded");
  assert.equal(result.snapshots.length, 1);
  assert.deepEqual(result.failures, [{ keyword: "마케팅 자동화", code: "PROVIDER_RATE_LIMIT", retryable: true }]);
});
test("키워드도구가 전부 실패하면 실행을 실패 처리하고 내부 오류를 일반화한다", async () => {
  const repository = repositorySpy();
  const result = await executeBrandSearchRun({ runId: "run-a", workspaceId: "workspace-a", workerId: "worker-a", input, credentials, repository, provider: provider({ fetchKeywordVolume: async ({ keyword }) => { if (keyword === "오토웍스") throw new Error("secret internal detail"); throw new ApiError("PROVIDER_AUTH_FAILED", "키 원문", 409); } }) });
  assert.equal(result.status, "failed");
  assert.deepEqual(result.failures.map(item => item.code), ["PROVIDER_UNAVAILABLE", "PROVIDER_AUTH_FAILED"]);
  assert.equal(JSON.stringify(repository.calls).includes("secret internal detail"), false);
});
test("데이터랩 일시 오류는 재시도 상태를 전달한다", async () => {
  const repository = repositorySpy();
  repository.failRun = async (...args) => { repository.calls.push(["failed", ...args]); return { status: "retrying" }; };
  const result = await executeBrandSearchRun({ workspaceId: "workspace-a", runId: "run-a", workerId: "worker-a", input: { keywords: ["키워드"], displayPeriodDays: 7, roundingUnit: 1 }, credentials, repository, provider: provider({ fetchSearchTrends: async () => { throw new ApiError("PROVIDER_UNAVAILABLE", "일시 장애", 502); } }) });
  assert.equal(result.status, "retrying");
  assert.equal(repository.calls.at(-1)[3].retryable, true);
});

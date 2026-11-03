import assert from "node:assert/strict";
import test from "node:test";
import { reserveUsageCapacity } from "../src/usage-policy.mjs";

test("완료량과 동시 요청 예약량을 모두 포함해 다음 사용량을 예약한다", () => {
  const result = reserveUsageCapacity({
    plan: { runLimit: 5, keywordLookupLimit: 20 },
    usage: { runs: 2, runsReserved: 2, keywordLookups: 7, keywordLookupsReserved: 8, succeeded: 1, failed: 1 },
    requestedKeywords: 5
  });
  assert.equal(result.nextRunsReserved, 3);
  assert.equal(result.nextKeywordLookupsReserved, 13);
});

test("광고 결과 저장은 실행 한도만 쓰고 키워드 조회량은 늘리지 않는다", () => {
  const plan = { runLimit: 2, keywordLookupLimit: 0 };
  const capacity = reserveUsageCapacity({ plan, usage: { runs: 1 }, requestedKeywords: 0, allowZeroKeywords: true });
  assert.equal(capacity.nextRunsReserved, 1);
  assert.equal(capacity.nextKeywordLookupsReserved, 0);
  assert.throws(() => reserveUsageCapacity({ plan, requestedKeywords: 0 }), error => error.code === "INVALID_INPUT");
});

test("실행 또는 키워드 예약이 한도를 한 건이라도 넘으면 거부한다", () => {
  assert.throws(
    () => reserveUsageCapacity({ plan: { runLimit: 4, keywordLookupLimit: 100 }, usage: { runs: 2, runsReserved: 2 }, requestedKeywords: 1 }),
    error => error.code === "USAGE_LIMIT_EXCEEDED" && error.status === 429
  );
  assert.throws(
    () => reserveUsageCapacity({ plan: { runLimit: 10, keywordLookupLimit: 10 }, usage: { keywordLookups: 6, keywordLookupsReserved: 3 }, requestedKeywords: 2 }),
    error => error.code === "USAGE_LIMIT_EXCEEDED" && error.status === 429
  );
});

test("누락·음수·소수 한도와 손상된 사용량은 무제한처럼 통과시키지 않는다", () => {
  for (const plan of [{}, { runLimit: -1, keywordLookupLimit: 10 }, { runLimit: 1.5, keywordLookupLimit: 10 }]) {
    assert.throws(() => reserveUsageCapacity({ plan, requestedKeywords: 1 }), error => error.code === "SUBSCRIPTION_REQUIRED");
  }
  assert.throws(
    () => reserveUsageCapacity({ plan: { runLimit: 10, keywordLookupLimit: 10 }, usage: { runsReserved: -1 }, requestedKeywords: 1 }),
    error => error.code === "USAGE_STATE_INVALID" && error.status === 503
  );
});

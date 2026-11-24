import assert from "node:assert/strict";
import test from "node:test";
import { estimateDailyVolumes, fetchSearchTrends, trendDateRange } from "../src/naver-search-trend.mjs";

test("선택 기간보다 최소 30일을 데이터랩 보정 구간으로 조회한다", () => {
  assert.deepEqual(trendDateRange({ now: new Date("2026-11-24T12:00:00Z"), displayPeriodDays: 7 }), { startDate: "2026-10-25", endDate: "2026-11-23" });
  assert.deepEqual(trendDateRange({ now: new Date("2026-11-24T12:00:00Z"), displayPeriodDays: 180 }), { startDate: "2026-05-28", endDate: "2026-11-23" });
});
test("API HUB 인증 헤더로 최대 5개 그룹씩 일별 추이를 조회한다", async () => {
  const calls = [], keywords = ["a","b","c","d","e","f"];
  const result = await fetchSearchTrends({ credentials: { clientId: "id", clientSecret: "secret" }, keywords, startDate: "2026-10-01", endDate: "2026-10-30", fetchImpl: async (url, options) => { calls.push({ url, options }); const body = JSON.parse(options.body); return { ok: true, json: async () => ({ results: body.keywordGroups.map(group => ({ title: group.groupName, data: [{ period: "2026-10-01", ratio: 10 }] })) }) }; } });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.headers["x-ncp-apigw-api-key-id"], "id");
  assert.equal(result.get("f")[0].ratio, 10);
});
test("최근 30일 월간량을 데이터랩 비율에 맞춰 일별 추정치로 배분한다", () => {
  const trend = Array.from({ length: 30 }, (_, index) => ({ date: new Date(Date.UTC(2026, 9, 2 + index)).toISOString().slice(0, 10), ratio: index === 29 ? 2 : 1 }));
  const rows = estimateDailyVolumes({ volume: { pc: 300, mobile: 600 }, trend, displayPeriodDays: 7, roundingUnit: 1, endDate: "2026-10-31" });
  assert.equal(rows.length, 7);
  assert.equal(rows.at(-1).total, 58);
  assert.equal(rows[0].date, "2026-10-25");
});

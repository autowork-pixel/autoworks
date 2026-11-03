import assert from "node:assert/strict";
import test from "node:test";
import { normalizeWeeklyAdReport, weeklyAdReportDigest } from "../src/weekly-ad-report.mjs";

const metrics = { impr: 1000, click: 50, cost: 10000, conv: 5, revenue: 30000, ctr: 5, cpc: 200, cvr: 10, roas: 300 };
const valid = { projectId: "project-a", idempotencyKey: "random-request-key-0001", sourceName: "ads.xlsx", sheet: "광고",
  analysis: { rowCount: 1, total: metrics, campaigns: [{ name: "A", ...metrics }], waste: [], winners: [] } };

test("브라우저 분석 결과는 허용 필드만 보존한다", () => {
  const input = normalizeWeeklyAdReport({ ...valid, secret: "discard", analysis: { ...valid.analysis, total: { ...metrics, secret: "discard" } } });
  assert.equal(input.analysis.total.cost, 10000);
  assert.equal("secret" in input, false);
  assert.equal("secret" in input.analysis.total, false);
  assert.equal(weeklyAdReportDigest(input), weeklyAdReportDigest({ ...input, idempotencyKey: "another-key-000000" }));
});

test("잘못된 수치·파일명·과대 결과를 거부한다", () => {
  for (const body of [
    { ...valid, sourceName: "../ads.xlsx" },
    { ...valid, analysis: { ...valid.analysis, total: { ...metrics, cost: -1 } } },
    { ...valid, analysis: { ...valid.analysis, winners: [null] } },
    { ...valid, analysis: { ...valid.analysis, rowCount: 10001 } }
  ]) assert.throws(() => normalizeWeeklyAdReport(body), error => error.code === "INVALID_INPUT");
});

import assert from "node:assert/strict";
import test from "node:test";
import { adReportDigest, normalizeAdReportInput } from "../src/ad-report.mjs";

const valid = { projectId: "project-a", provider: "meta-ads", since: "2026-10-01", until: "2026-10-31", idempotencyKey: "random-request-key-0001" };

test("광고 보고서 입력은 매체와 31일 기간을 제한한다", () => {
  assert.deepEqual(normalizeAdReportInput(valid), valid);
  for (const body of [
    { ...valid, provider: "naver-gfa" },
    { ...valid, since: "2026-09-30" },
    { ...valid, since: "2026-10-32" },
    { ...valid, until: "2026-09-30" }
  ]) assert.throws(() => normalizeAdReportInput(body), error => error.code === "INVALID_INPUT");
});

test("광고 보고서 digest는 멱등 키를 제외한다", () => {
  const input = normalizeAdReportInput(valid);
  assert.equal(adReportDigest(input), adReportDigest({ ...input, idempotencyKey: "another-request-key-0002" }));
});

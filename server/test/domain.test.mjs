import assert from "node:assert/strict";
import test from "node:test";
import { ApiError, normalizeBrandSearchInput, requestDigest } from "../src/domain.mjs";

const valid = () => ({
  projectId: "project-a",
  brand: "오토웍스",
  competitors: ["경쟁사"],
  keywords: ["오토웍스", "브랜드 자동화"],
  displayPeriodDays: 28,
  roundingUnit: 10,
  idempotencyKey: "random-request-key-0001"
});

test("브랜드·경쟁사·키워드를 순서대로 중복 제거한다", () => {
  assert.deepEqual(normalizeBrandSearchInput(valid()).keywords, ["오토웍스", "경쟁사", "브랜드 자동화"]);
});

test("전체 키워드 20개를 넘기면 거부한다", () => {
  const body = valid();
  body.keywords = Array.from({ length: 19 }, (_, index) => `키워드${index}`);
  assert.throws(() => normalizeBrandSearchInput(body), error => error instanceof ApiError && error.code === "INVALID_INPUT");
});

test("멱등키는 충분히 긴 안전한 식별자여야 한다", () => {
  const body = valid();
  body.idempotencyKey = "short";
  assert.throws(() => normalizeBrandSearchInput(body), /idempotencyKey/);
});

test("키워드의 줄바꿈과 제어 문자를 거부한다", () => {
  const body = valid();
  body.keywords = ["정상\n=HYPERLINK(\"https://example.com\")"];
  assert.throws(() => normalizeBrandSearchInput(body), error => error instanceof ApiError && error.code === "INVALID_INPUT");
});

test("동일 입력의 digest는 안정적이고 멱등키는 포함하지 않는다", () => {
  const first = normalizeBrandSearchInput(valid());
  const second = { ...first, idempotencyKey: "another-request-key-0002" };
  assert.equal(requestDigest(first), requestDigest(second));
});

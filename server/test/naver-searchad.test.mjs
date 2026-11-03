import assert from "node:assert/strict";
import test from "node:test";
import { createSearchAdHeaders, createSearchAdSignature, fetchKeywordVolume, mapKeywordToolResponse } from "../src/naver-searchad.mjs";

test("공식 계약대로 timestamp.method.path를 HMAC-SHA256 Base64로 서명한다", () => {
  assert.equal(createSearchAdSignature({ timestamp: "1700000000000", method: "GET", path: "/keywordstool", secretKey: "secret" }), "A6Gzu+sW9C2ovLsH+T+rFrie81KwHy1xrodUFQERKf4=");
});

test("인증 헤더에는 키 세 종류와 path 전용 서명이 들어간다", () => {
  const headers = createSearchAdHeaders({ apiKey: "license", secretKey: "secret", customerId: 123, timestamp: 1700000000000 });
  assert.equal(headers["x-api-key"], "license");
  assert.equal(headers["x-customer"], "123");
  assert.equal(headers["x-timestamp"], "1700000000000");
  assert.equal(headers["x-signature"], "A6Gzu+sW9C2ovLsH+T+rFrie81KwHy1xrodUFQERKf4=");
});

test("정확한 키워드의 PC·모바일 월간 검색량을 합산한다", () => {
  assert.deepEqual(mapKeywordToolResponse({ keywordList: [
    { relKeyword: "다른키워드", monthlyPcQcCnt: 1, monthlyMobileQcCnt: 2 },
    { relKeyword: "오토 웍스", monthlyPcQcCnt: "1,200", monthlyMobileQcCnt: 3400 }
  ] }, "오토웍스"), { keyword: "오토 웍스", pc: 1200, mobile: 3400, total: 4600 });
});

test("10 미만 표기는 임의 추정하지 않고 0으로 정규화한다", () => {
  assert.deepEqual(mapKeywordToolResponse({ keywordList: [
    { relKeyword: "오토웍스", monthlyPcQcCnt: "< 10", monthlyMobileQcCnt: "<10" }
  ] }, "오토웍스"), { keyword: "오토웍스", pc: 0, mobile: 0, total: 0 });
});

test("제공자 오류 본문과 인증정보는 고객 오류에 노출하지 않는다", async () => {
  const secret = "do-not-leak";
  await assert.rejects(() => fetchKeywordVolume({
    credentials: { apiKey: "license", secretKey: secret, customerId: "123" },
    keyword: "오토웍스",
    timestamp: 1700000000000,
    fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({ detail: `bad ${secret}` }) })
  }), error => error.code === "PROVIDER_AUTH_FAILED" && !error.message.includes(secret));
});

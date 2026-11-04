import assert from "node:assert/strict";
import test from "node:test";
import { contentReferenceDigest, normalizeContentReferenceInput, searchContentReferences } from "../src/content-reference.mjs";

const input = normalizeContentReferenceInput({ projectId: "project-a", brand: "오토웍스", category: "마케팅", keywords: ["자동화"], target: "브랜드 담당자", strengths: ["빠른 분석"], periodDays: 28, collectCount: 5, idempotencyKey: "random-request-key-0001" });

test("콘텐츠 수집 조건을 제한하고 멱등키를 제외한 해시를 만든다", () => {
  assert.equal(input.keywords[0], "자동화");
  assert.match(contentReferenceDigest(input), /^[a-f0-9]{64}$/);
  assert.equal(contentReferenceDigest(input), contentReferenceDigest({ ...input, idempotencyKey: "different-request-key-0002" }));
  assert.throws(() => normalizeContentReferenceInput({ ...input, collectCount: 50 }), { code: "INVALID_INPUT" });
});

test("최근 인기 영상 검색 결과에 출처·시각·공개 지표와 참여율을 보존한다", async () => {
  const videoId = "dQw4w9WgXcQ", calls = [];
  const result = await searchContentReferences({ input, apiKey: "secret-key", now: () => new Date("2026-11-04T00:00:00Z"), fetchImpl: async url => {
    const endpoint = new URL(url); calls.push(endpoint);
    assert.equal(endpoint.searchParams.get("key"), "secret-key");
    if (calls.length === 1) return { ok: true, json: async () => ({ items: [{ id: { videoId } }] }) };
    return { ok: true, json: async () => ({ items: [{ id: videoId, snippet: { title: "레퍼런스", channelTitle: "채널", publishedAt: "2026-11-01T00:00:00Z", thumbnails: { medium: { url: "https://i.ytimg.com/example.jpg" } } }, statistics: { viewCount: "100", likeCount: "8", commentCount: "2" } }] }) };
  } });
  assert.equal(calls[0].pathname.endsWith("/search"), true);
  assert.equal(calls[0].searchParams.get("order"), "viewCount");
  assert.equal(result.rows[0].sourceUrl, `https://www.youtube.com/watch?v=${videoId}`);
  assert.equal(result.rows[0].engagementRate, 10);
  assert.equal(result.rows[0].capturedAt, "2026-11-04T00:00:00.000Z");
});

test("API 오류 원문과 키는 고객 오류에 노출하지 않는다", async () => {
  await assert.rejects(() => searchContentReferences({ input, apiKey: "private-key", fetchImpl: async () => ({ ok: false, status: 403 }) }),
    error => error.code === "PROVIDER_AUTH_FAILED" && !error.message.includes("private-key"));
});

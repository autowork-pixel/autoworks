import { test } from "node:test";
import assert from "node:assert/strict";
import { collabInstagramDigest, fetchInstagramPost, normalizeCollabInstagramInput, parseInstagramPostUrl } from "../src/collab-instagram.mjs";

test("공식 Instagram 게시물 링크만 정규화한다", () => {
  assert.deepEqual(parseInstagramPostUrl("https://www.instagram.com/reels/ABC_123/?igsh=x"), {
    shortcode: "ABC_123", url: "https://www.instagram.com/reel/ABC_123/"
  });
  for (const url of ["https://instagram.com.evil.test/p/ABC_123/", "http://instagram.com/p/ABC_123/", "https://www.instagram.com/profile/ABC_123/", "https://www.instagram.com/p/ABC_123/more/"]) {
    assert.throws(() => parseInstagramPostUrl(url), { code: "INVALID_INPUT" });
  }
});

test("Instagram 실행 입력을 정규화하고 프로젝트·shortcode로 멱등 해시를 만든다", () => {
  const input = normalizeCollabInstagramInput({ projectId: "project-a", idempotencyKey: "random-request-key-0001", url: "https://instagram.com/p/ABC_123/?utm_source=test" });
  assert.deepEqual(input, { projectId: "project-a", idempotencyKey: "random-request-key-0001", shortcode: "ABC_123", url: "https://www.instagram.com/p/ABC_123/" });
  assert.match(collabInstagramDigest(input), /^[a-f0-9]{64}$/);
  assert.throws(() => normalizeCollabInstagramInput({ projectId: "project-a", idempotencyKey: "short", url: input.url }), { code: "INVALID_INPUT" });
});

test("Apify 토큰은 인증 헤더에만 넣고 영상 지표를 정규화한다", async () => {
  const url = "https://www.instagram.com/reel/ABC_123/";
  const result = await fetchInstagramPost({ shortcode: "ABC_123", url, token: "test-token", fetchImpl: async (endpoint, options) => {
    assert.ok(!endpoint.includes("test-token"));
    assert.equal(options.headers.authorization, "Bearer test-token");
    assert.equal(options.redirect, "error");
    assert.deepEqual(JSON.parse(options.body).directUrls, [url]);
    return { ok: true, json: async () => [{ shortCode: "ABC_123", type: "Video", videoPlayCount: 50, likesCount: 10, commentsCount: 2 }] };
  } });
  assert.equal(result.views, 50);
  assert.equal(result.likes, 10);
  assert.equal(result.comments, 2);
});

test("피드 조회수와 누락 지표는 0으로 표시하지 않는다", async () => {
  const result = await fetchInstagramPost({ shortcode: "ABC_123", url: "https://www.instagram.com/p/ABC_123/", token: "test-token",
    fetchImpl: async () => ({ ok: true, json: async () => [{ shortCode: "ABC_123", type: "Image", likesCount: 3 }] }) });
  assert.equal(result.views, null);
  assert.equal(result.comments, null);
  assert.equal(result.viewsStatus, "조회수 미제공(피드)");
});


test("Apify의 -1 비공개 지표는 오류나 0이 아니라 미제공으로 보존한다", async () => {
  const result = await fetchInstagramPost({ shortcode: "DfSFftCCQYc", url: "https://www.instagram.com/reel/DfSFftCCQYc/", token: "test-token",
    fetchImpl: async () => ({ ok: true, json: async () => [{ shortCode: "DfSFftCCQYc", type: "Video", videoPlayCount: 1297, likesCount: -1, commentsCount: 0 }] }) });
  assert.equal(result.views, 1297);
  assert.equal(result.likes, null);
  assert.equal(result.comments, 0);
});

test("-1 이외의 음수와 손상된 수치는 제공자 응답 오류로 거부한다", async () => {
  for (const likesCount of [-2, "not-a-count"]) {
    await assert.rejects(() => fetchInstagramPost({ shortcode: "ABC_123", url: "https://www.instagram.com/p/ABC_123/", token: "test-token",
      fetchImpl: async () => ({ ok: true, json: async () => [{ shortCode: "ABC_123", type: "Image", likesCount }] }) }), { code: "PROVIDER_INVALID_RESPONSE" });
  }
});

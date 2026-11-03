import { test } from "node:test";
import assert from "node:assert/strict";
import { parseInstagramPostUrl, fetchInstagramPost } from "../src/collab-instagram.mjs";

test("공식 Instagram 게시물 링크만 정규화한다", () => {
  assert.deepEqual(parseInstagramPostUrl("https://www.instagram.com/reels/ABC_123/?igsh=x"), {
    shortcode: "ABC_123", url: "https://www.instagram.com/reel/ABC_123/"
  });
  for (const url of ["https://instagram.com.evil.test/p/ABC_123/", "http://instagram.com/p/ABC_123/", "https://www.instagram.com/profile/ABC_123/", "https://www.instagram.com/p/ABC_123/more/"]) {
    assert.throws(() => parseInstagramPostUrl(url), { code: "INVALID_INPUT" });
  }
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

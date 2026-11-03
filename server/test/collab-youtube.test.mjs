import { test } from "node:test";
import assert from "node:assert/strict";
import { parseYouTubeVideoUrl, normalizeCollabYouTubeInput, fetchYouTubePost } from "../src/collab-youtube.mjs";

test("공식 YouTube 링크만 동영상 ID로 정규화한다", () => {
  const id = "AbCde123_-0";
  for (const url of [`https://youtu.be/${id}`, `https://www.youtube.com/watch?v=${id}&t=4`, `https://youtube.com/shorts/${id}`]) {
    assert.deepEqual(parseYouTubeVideoUrl(url), { videoId: id, url: `https://www.youtube.com/watch?v=${id}` });
  }
  for (const url of [`https://youtube.com.evil.test/watch?v=${id}`, `http://youtu.be/${id}`, `https://youtube.com@evil.test/watch?v=${id}`, `https://www.youtube.com/redirect?q=${id}`]) {
    assert.throws(() => parseYouTubeVideoUrl(url), { code: "INVALID_INPUT" });
  }
});

test("공개 지표를 정규화하고 누락 지표는 0으로 위장하지 않는다", async () => {
  const videoId = "AbCde123_-0";
  const result = await fetchYouTubePost({ videoId, apiKey: "test-key", fetchImpl: async (url, options) => {
    assert.equal(url.hostname, "www.googleapis.com");
    assert.equal(url.searchParams.get("id"), videoId);
    assert.equal(options.redirect, "error");
    return { ok: true, json: async () => ({ items: [{ id: videoId, snippet: { title: "협업 영상" }, statistics: { viewCount: "123", commentCount: "4" } }] }) };
  } });
  assert.equal(result.views, 123);
  assert.equal(result.likes, null);
  assert.equal(result.comments, 4);
  assert.ok(result.capturedAt);
});

test("없는 영상과 제공자 인증 실패를 구분한다", async () => {
  const input = { videoId: "AbCde123_-0", apiKey: "test-key" };
  await assert.rejects(fetchYouTubePost({ ...input, fetchImpl: async () => ({ ok: true, json: async () => ({ items: [] }) }) }), { code: "PROVIDER_NO_DATA" });
  await assert.rejects(fetchYouTubePost({ ...input, fetchImpl: async () => ({ ok: false, status: 403 }) }), { code: "PROVIDER_AUTH_FAILED" });
});

test("실행 입력은 YouTube 주소·프로젝트·멱등키만 정규화한다", () => {
  const input = normalizeCollabYouTubeInput({ projectId: "project-a", idempotencyKey: "random-request-key-0001",
    url: "https://youtu.be/AbCde123_-0", ignored: "not-saved" });
  assert.deepEqual(input, { projectId: "project-a", idempotencyKey: "random-request-key-0001",
    videoId: "AbCde123_-0", url: "https://www.youtube.com/watch?v=AbCde123_-0" });
  assert.throws(() => normalizeCollabYouTubeInput({ ...input, idempotencyKey: "short" }), { code: "INVALID_INPUT" });
});

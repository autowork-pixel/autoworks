import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const cases = [
  ["content-pack.js", /selectedProject !== el\.project\.value/, /projectId: selectedProject/],
  ["content-reference.js", /selectedProject !== el\.project\.value/, /projectId: selectedProject/],
  ["collab-post.js", /selectedProject !== project\.value/, /projectId: selectedProject/],
  ["weekly-ad.js", /selectedProject !== projectSelect\.value/, /projectId: selectedProject/],
  ["ai-blog.js", /selectedProject!==el\.project\.value/, /projectId:selectedProject/],
  ["influencer-candidates.js", /selectedProject!==el\.project\.value/, /projectId:selectedProject/],
  ["naver-visibility.js", /selectedProject!==el\.project\.value/, /projectId:selectedProject/]
];

for (const [file, guard, request] of cases) test(`${file} 실행 응답은 요청 당시 프로젝트에서만 반영한다`, async () => {
  const source = await readFile(new URL(`../public/${file}`, import.meta.url), "utf8");
  assert.match(source, request);
  assert.match(source, guard);
});

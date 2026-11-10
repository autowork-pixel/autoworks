import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("브랜드 검색량 이력은 선택 프로젝트로 서버 조회한다", async () => {
  const source = await readFile(new URL("../public/brand-search.js", import.meta.url), "utf8");
  const repository = await readFile(new URL("../server/src/run-repository.mjs", import.meta.url), "utf8");
  assert.match(source, /projectId=\$\{encodeURIComponent\(context\.projectId\)\}/);
  assert.match(source, /if\(!context\.workspaceId\|\|!context\.projectId\|\|!apiBase\)return/);
  assert.match(repository, /where\("projectId", "==", projectId\)/);
});

test("AI 블로그 이력은 선택 프로젝트로 조회하고 전환 중 늦은 응답을 버린다", async () => {
  const source = await readFile(new URL("../public/ai-blog.js", import.meta.url), "utf8");
  assert.match(source, /where\("tool","==","ai-blog"\),where\("projectId","==",projectId\)/);
  assert.match(source, /projectId!==el\.project\.value/);
  assert.match(source, /if\(firestoreHistory\)loadHistory\(\.\.\.firestoreHistory\)/);
  assert.match(source, /show\(\);update\(\)/);
});

test("네이버 노출 이력은 선택 프로젝트로 조회하고 전환 시 이전 결과를 지운다", async () => {
  const source = await readFile(new URL("../public/naver-visibility.js", import.meta.url), "utf8");
  assert.match(source, /where\("tool","==","naver-visibility"\),where\("projectId","==",projectId\)/);
  assert.match(source, /projectId!==el\.project\.value/);
  assert.match(source, /requestKey=null;render\(\);update\(\);if\(firestoreHistory\)loadHistory/);
  assert.match(source, /exportCsv\.disabled=true/);
});

test("주간 광고 이력은 선택 프로젝트로 조회하고 전환 중 늦은 응답을 버린다", async () => {
  const source = await readFile(new URL("../public/weekly-ad.js", import.meta.url), "utf8");
  assert.match(source, /where\("tool", "==", "weekly-ad"\), where\("projectId", "==", projectId\)/);
  assert.match(source, /projectId !== projectSelect\.value/);
  assert.match(source, /analysisGeneration\+\+; saveGeneration\+\+; resetAnalysis\(\); accountState\.reports = new Map\(\)/);
  assert.match(source, /currentHistoryGeneration !== historyGeneration/);
});

test("콘텐츠 레퍼런스 이력은 선택 프로젝트로 조회하고 전환 시 이전 결과를 지운다", async () => {
  const source = await readFile(new URL("../public/content-reference.js", import.meta.url), "utf8");
  assert.match(source, /where\("tool", "==", "content-reference"\), where\("projectId", "==", projectId\)/);
  assert.match(source, /projectId !== el\.project\.value/);
  assert.match(source, /requestGeneration\+\+; requestKey = null; render\(\)/);
  assert.match(source, /expectedHistoryGeneration === historyGeneration/);
});

test("협업 게시물 이력과 비교 목록은 프로젝트를 넘나들지 않는다", async () => {
  const source = await readFile(new URL("../public/collab-post.js", import.meta.url), "utf8");
  assert.match(source, /where\("tool", "==", "collab-post"\), where\("projectId", "==", projectId\)/);
  assert.match(source, /projectId !== project\.value/);
  assert.match(source, /reportById\.clear\(\); comparePosts = \[\]; renderComparison\(\); clearResult\(\)/);
});

test("인플루언서 후보 이력은 선택 프로젝트로 조회하고 전환 시 이전 후보를 지운다", async () => {
  const source = await readFile(new URL("../public/influencer-candidates.js", import.meta.url), "utf8");
  assert.match(source, /where\("tool","==","influencer-candidate"\),where\("projectId","==",projectId\)/);
  assert.match(source, /projectId!==el\.project\.value/);
  assert.match(source, /requestGeneration\+\+;requestKey=null;render\(\);update\(\);const expectedHistoryGeneration=historyGeneration\+1/);
  assert.match(source, /expectedHistoryGeneration===historyGeneration/);
});

test("프로젝트별 보고서 조회에 필요한 공통 복합 색인이 있다", async () => {
  const indexes = JSON.parse(await readFile(new URL("../firestore.indexes.json", import.meta.url), "utf8"));
  const matching = indexes.indexes.find(index => index.collectionGroup === "reports" && index.queryScope === "COLLECTION" &&
    index.fields.map(field => `${field.fieldPath}:${field.order}`).join("|") === "tool:ASCENDING|projectId:ASCENDING|createdAt:DESCENDING");
  assert.ok(matching);
});

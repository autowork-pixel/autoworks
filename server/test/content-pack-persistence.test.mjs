import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("선택 주제 참고 정보는 실행 요약에서 결과 이력까지 제한된 형태로 이어진다", async () => {
  const source = await readFile(new URL("../src/firebase-repository.mjs", import.meta.url), "utf8");
  assert.match(source, /inputSummary:\{campaign:input\.campaign,channels:input\.channels,topicContext:input\.topicContext\}/);
  assert.match(source, /topicContext:runDoc\.data\(\)\.inputSummary\.topicContext\|\|null/);
});

import assert from "node:assert/strict";
import test from "node:test";
import { buildTopicCandidates } from "../public/content-topics.js";

test("프로젝트 키워드와 타깃·후크로 중복 없는 주제 후보를 만든다", () => {
  const result = buildTopicCandidates([" 오쏘몰 ", "오쏘몰", "비타민", "건강기능식품"], "직장인", "QQA");
  assert.equal(result.length, 3);
  assert.equal(result[0].keyword, "오쏘몰");
  assert.match(result[0].title, /선택 전에 확인할 질문/);
  assert.match(result[0].note, /직장인/);
});

test("타깃·후크·키워드가 없으면 주제를 추측하지 않는다", () => {
  assert.deepEqual(buildTopicCandidates(["오쏘몰"], "", "SCS"), []);
  assert.deepEqual(buildTopicCandidates(["오쏘몰"], "직장인", "unknown"), []);
  assert.deepEqual(buildTopicCandidates([], "직장인", "SCS"), []);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildTopicCandidates, describeTopicReview } from "../public/content-topics.js";

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

test("저장된 검색량이 있는 프로젝트 키워드를 최근 월간량 순으로 우선한다", () => {
  const result = buildTopicCandidates(["저검색", "고검색", "신호없음", "중검색"], "마케터", "SCS", [
    { keyword: "중검색", total: 1200, recordedAt: "2026-11-01T00:00:00Z" },
    { keyword: " 고검색 ", total: 9800, recordedAt: { seconds: 1793750400 } },
    { keyword: "저검색", total: 30, recordedAt: { toDate: () => new Date("2026-11-03T15:00:00Z") } }
  ], { now: "2026-11-10T00:00:00Z" });
  assert.deepEqual(result.map(item => item.keyword), ["고검색", "중검색", "저검색"]);
  assert.equal(result[0].searchVolume, 9800);
  assert.equal(result[0].searchRecordedAt, "2026-11-04");
  assert.equal(result[0].searchStale, false);
  assert.match(result[0].note, /2026-11-04 조회 기준 월간 검색량 9,800회/);
});

test("검색량 신호가 없거나 손상되면 기존 프로젝트 순서를 유지한다", () => {
  const result = buildTopicCandidates(["첫째", "둘째", "셋째", "넷째"], "고객", "BAD", [
    { keyword: "첫째", total: -1 }, { keyword: "둘째", total: Number.NaN }
  ]);
  assert.deepEqual(result.map(item => item.keyword), ["첫째", "둘째", "셋째"]);
  assert.equal(result.every(item => item.searchVolume === null), true);
});

test("같은 키워드의 여러 스냅샷은 최신 입력값 하나만 사용한다", () => {
  const [result] = buildTopicCandidates(["브랜드"], "고객", "QQA", [
    { keyword: "브랜드", total: 3000, recordedAt: "2026-11-09T00:00:00Z" },
    { keyword: " 브랜드 ", total: 9000, recordedAt: "2026-10-01T00:00:00Z" }
  ]);
  assert.equal(result.searchVolume, 3000);
  assert.equal(result.searchRecordedAt, "2026-11-09");
});

test("조회 시각이 손상돼도 검색량은 쓰되 최신 값처럼 표시하지 않는다", () => {
  const [result] = buildTopicCandidates(["브랜드"], "고객", "QQA", [
    { keyword: "브랜드", total: 3000, recordedAt: "not-a-date" }
  ]);
  assert.equal(result.searchVolume, 3000);
  assert.equal(result.searchRecordedAt, null);
  assert.match(result.note, /조회일 미확인 월간 검색량 3,000회/);
});

test("30일 이상 지난 검색량은 오래된 참고값으로 경고한다", () => {
  const [result] = buildTopicCandidates(["브랜드"], "고객", "SCS", [
    { keyword: "브랜드", total: 3000, recordedAt: "2026-09-30T00:00:00Z" }
  ], { now: "2026-11-10T00:00:00Z" });
  assert.equal(result.searchStale, true);
  assert.match(result.note, /30일 이상 지난 참고값/);
});

test("오래됨 기준은 운영 검토 뒤 조정할 수 있다", () => {
  const [result] = buildTopicCandidates(["브랜드"], "고객", "SCS", [
    { keyword: "브랜드", total: 3000, recordedAt: "2026-10-20T00:00:00Z" }
  ], { now: "2026-11-10T00:00:00Z", staleAfterDays: 14 });
  assert.equal(result.searchStale, true);
  assert.match(result.note, /14일 이상 지난 참고값/);
});

test("선택한 주제의 키워드·검색량·기준일을 생성 전 검토 문구로 만든다", () => {
  const [candidate] = buildTopicCandidates(["브랜드"], "고객", "SCS", [
    { keyword: "브랜드", total: 3000, recordedAt: "2026-09-30T00:00:00Z" }
  ], { now: "2026-11-10T00:00:00Z" });
  const summary = describeTopicReview(candidate);
  assert.match(summary, /선택 주제:/);
  assert.match(summary, /키워드: 브랜드/);
  assert.match(summary, /월간 검색량: 3,000회/);
  assert.match(summary, /기준: 2026-09-30/);
  assert.match(summary, /30일 이상 지난 참고값/);
  assert.equal(describeTopicReview(null), "");
});

test("콘텐츠 화면은 같은 프로젝트의 저장된 브랜드 검색량만 읽고 외부 조회를 만들지 않는다", async () => {
  const source = await readFile(new URL("../public/content-pack.js", import.meta.url), "utf8");
  assert.match(source, /where\("tool", "==", "brand-search"\)/);
  assert.match(source, /report\.projectId !== projectId/);
  assert.match(source, /recordedAt: row\.recordedAt/);
  assert.match(source, /idea\.searchStale/);
  assert.match(source, /describeTopicReview\(idea\)/);
  assert.match(source, /el\.campaign\.value\.trim\(\) !== selectedTopic\.title/);
  assert.match(source, /buildTopicCandidates\(keywords, el\.audience\.value, el\.topicHook\.value, topicSignals\)/);
  assert.equal(/brand-search-runs|provider-credentials/.test(source), false);
});

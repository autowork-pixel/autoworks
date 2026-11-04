import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("public/index.html", "utf8");
const reset = source.match(/function resetAccountUi\(\) \{(?<body>[\s\S]*?)\n      \}/)?.groups?.body || "";

assert.match(source, /const generation = \+\+authGeneration;/, "인증 상태 변경마다 세대를 갱신해야 합니다.");
assert.match(source, /generation === authGeneration && auth\.currentUser\?\.uid === user\.uid/, "비동기 조회 결과는 현재 계정과 세대를 확인해야 합니다.");
assert.match(source, /if \(!isCurrent\(\)\) return;\s*renderRuns/, "실행·결과 렌더링 전에 현재 계정을 다시 확인해야 합니다.");
assert.match(source, /if \(generation !== authGeneration \|\| auth\.currentUser\?\.uid !== user\.uid\) return;/, "이전 계정의 실패 응답도 현재 화면을 덮어쓰면 안 됩니다.");
for (const required of ["autoworksWorkspaceId = null", "projectRows", "runList", "reportList", "inquiryList", "usageGrid", "inquiryForm"]) {
  assert.equal(reset.includes(required), true, `로그아웃 초기화에 ${required} 처리가 필요합니다.`);
}
assert.match(source, /resetAccountUi\(\);\s*if \(signedIn\)/, "계정 상태가 바뀌면 이전 고객 데이터를 즉시 초기화해야 합니다.");

console.log("로그아웃 DOM 초기화와 이전 계정 비동기 결과 차단 경계를 확인");

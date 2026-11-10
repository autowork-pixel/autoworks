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
assert.match(source, /const accountContext = \(\) => \(\{ generation:authGeneration, user:auth\.currentUser, workspaceId:window\.autoworksWorkspaceId \}\)/, "고객 쓰기 요청은 시작 시점의 계정·워크스페이스 문맥을 고정해야 합니다.");
assert.match(source, /const accountCurrent = context => context\.generation === authGeneration/, "고객 쓰기 응답은 현재 인증 세대인지 확인해야 합니다.");
assert.match(source, /loadProjects\(workspaceId, \(\) => accountCurrent\(context\)\)/, "프로젝트 저장 뒤 목록 조회도 현재 계정에서만 반영해야 합니다.");
assert.match(source, /if \(accountCurrent\(context\)\) \{ submit\.disabled = false; submit\.textContent = "문의 접수"; \}/, "이전 문의 요청은 새 계정 버튼 상태를 복구하지 않아야 합니다.");
assert.match(source, /async function renderAuthState\(user\)/, "인증 상태 렌더링은 BFCache 복원에서도 재사용할 수 있어야 합니다.");
assert.match(source, /window\.addEventListener\("pagehide", event => \{\s*if \(!event\.persisted\) return;\s*authGeneration\+\+;\s*billingRequestKey = null;/, "BFCache 진입 시 진행 중 계정 요청과 결제 멱등키 화면 상태를 무효화해야 합니다.");
assert.match(source, /window\.addEventListener\("pageshow", event => \{\s*if \(!event\.persisted\) return;\s*renderAuthState\(auth\.currentUser\);/, "BFCache 복원 시 현재 Firebase 계정으로 화면 데이터를 다시 불러와야 합니다.");

console.log("로그아웃 DOM 초기화와 이전 계정 비동기 결과 차단 경계를 확인");


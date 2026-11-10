import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("public/admin.html", "utf8");
assert.match(source, /button\.disabled=!apiBase/, "API URL이 없으면 고객 접근 조치 버튼을 비활성화해야 합니다.");
assert.match(source, /authorization:`Bearer \$\{await context\.user\.getIdToken\(\)\}`/, "운영 조치는 요청 시작 시점 관리자 ID token을 서버에 전달해야 합니다.");
assert.match(source, /body:JSON\.stringify\(\{blocked,reason:reason\.trim\(\)\}\)/, "차단 여부와 필수 사유만 서버에 전달해야 합니다.");
assert.match(source, /workspaceId:workspaceDoc\.id/, "조치 대상은 표시 이름이 아니라 Firestore 문서 ID여야 합니다.");
assert.match(source, /inquiries\/\$\{encodeURIComponent\(item\.id\)\}:answer/, "문의 답변도 감사 기록이 남는 서버 API를 사용해야 합니다.");
assert.match(source, /inquiries\/\$\{encodeURIComponent\(inquiryId\)\}:status/, "문의 확인·종료 상태도 서버 API로만 변경해야 합니다.");
assert.match(source, /\/v1\/admin\/system\/automation/, "전역 자동화 조치도 관리자 서버 API를 사용해야 합니다.");
assert.match(source, /RESUME_AUTOMATION/, "예산 차단 재개는 정확한 확인 문구를 요구해야 합니다.");
assert.match(source, /system\/automation\/audit-logs\?limit=10/, "전역 자동화 감사 기록은 제한된 관리자 API로 조회해야 합니다.");
assert.match(source, /body:JSON\.stringify\(\{blocked,confirmation,reason:reason\.trim\(\)\}\)/, "전역 조치는 상태·확인 문구·사유만 전달해야 합니다.");
assert.equal(source.includes("updateDoc("), false, "운영 화면에서 Firestore 문서를 직접 변경하면 안 됩니다.");
assert.equal(source.includes("providerCredentials"), false, "운영 화면에서 고객 API 자격정보를 조회하면 안 됩니다.");
assert.match(source, /collectionGroup\(db,"paymentSummaries"\)/, "관리자는 결제수단 원문이 아닌 공개 결제 요약만 조회해야 합니다.");
assert.match(source, /const context=\{generation:\+\+authGeneration,user\}/, "관리자 화면은 로그인 전환마다 조회 세대를 분리해야 합니다.");
assert.match(source, /function sessionCurrent\(context\)/, "관리자 비동기 조회는 현재 로그인 세션인지 확인해야 합니다.");
assert.match(source, /loadDashboard\(context\).*loadPaymentSummaries\(context\).*loadAutomationState\(context\).*loadAutomationAudits\(context\)/s, "관리자 조회마다 로그인 세션 문맥을 전달해야 합니다.");
assert.match(source, /clearDashboard\(\);if\(!user\)/, "로그아웃 시 이전 관리자 데이터를 즉시 비워야 합니다.");
assert.match(source, /function actionContext\(\)/, "관리자 쓰기 조치는 요청 시작 시점의 로그인 세션을 고정해야 합니다.");
assert.doesNotMatch(source, /authorization:`Bearer \$\{await auth\.currentUser\.getIdToken\(\)\}`/, "관리자 쓰기 요청은 대기 중 바뀔 수 있는 현재 계정 토큰을 다시 읽지 않아야 합니다.");
assert.match(source, /finally\{if\(sessionCurrent\(context\)\)button\.disabled=false\}/, "이전 관리자 요청은 새 세션 버튼 상태를 복구하지 않아야 합니다.");
assert.match(source, /data\.status==="FAILED"/, "결제 실패 상태를 운영자가 구분할 수 있어야 합니다.");
assert.equal(source.includes("billingCredentials"), false, "운영 화면에서 빌링키 저장소를 조회하면 안 됩니다.");
console.log("관리자 고객 접근 조치의 API 비활성화·ID token·대상 ID·비밀정보 경계를 확인");


import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("public/admin.html", "utf8");
assert.match(source, /button\.disabled=!apiBase/, "API URL이 없으면 고객 접근 조치 버튼을 비활성화해야 합니다.");
assert.match(source, /authorization:`Bearer \$\{await auth\.currentUser\.getIdToken\(\)\}`/, "운영 조치는 현재 관리자 ID token을 서버에 전달해야 합니다.");
assert.match(source, /body:JSON\.stringify\(\{blocked,reason:reason\.trim\(\)\}\)/, "차단 여부와 필수 사유만 서버에 전달해야 합니다.");
assert.match(source, /workspaceId:workspaceDoc\.id/, "조치 대상은 표시 이름이 아니라 Firestore 문서 ID여야 합니다.");
assert.match(source, /inquiries\/\$\{encodeURIComponent\(item\.id\)\}:answer/, "문의 답변도 감사 기록이 남는 서버 API를 사용해야 합니다.");
assert.match(source, /inquiries\/\$\{encodeURIComponent\(inquiryId\)\}:status/, "문의 확인·종료 상태도 서버 API로만 변경해야 합니다.");
assert.equal(source.includes("updateDoc("), false, "운영 화면에서 Firestore 문서를 직접 변경하면 안 됩니다.");
assert.equal(source.includes("providerCredentials"), false, "운영 화면에서 고객 API 자격정보를 조회하면 안 됩니다.");
console.log("관리자 고객 접근 조치의 API 비활성화·ID token·대상 ID·비밀정보 경계를 확인");

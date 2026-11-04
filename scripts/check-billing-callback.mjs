import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const success=await readFile(new URL("../public/billing-success.html",import.meta.url),"utf8"),failure=await readFile(new URL("../public/billing-fail.html",import.meta.url),"utf8"),service=await readFile(new URL("../server/src/billing-service.mjs",import.meta.url),"utf8");
assert.match(service,/workspaceId=\$\{encodeURIComponent\(workspaceId\)\}/,"결제 반환 URL은 완료 API의 워크스페이스를 포함해야 합니다.");
assert.match(success,/history\.replaceState\(null,"",location\.pathname\)/,"일회용 결제 결과는 주소창에서 즉시 제거해야 합니다.");
assert.match(success,/auth\.currentUser|onAuthStateChanged/,"결제 완료 API는 로그인 계정을 확인한 뒤 호출해야 합니다.");
assert.match(success,/billing-sessions\/\$\{encodeURIComponent\(sessionId\)\}:complete/,"결제 완료는 검증된 세션 완료 API만 호출해야 합니다.");
assert.match(success,/authorization:`Bearer \$\{await user\.getIdToken\(\)\}`/,"결제 완료 API에 Firebase ID token을 전달해야 합니다.");
assert.doesNotMatch(success,/localStorage|sessionStorage/,"일회용 결제 결과를 브라우저 저장소에 남기면 안 됩니다.");
assert.doesNotMatch(failure,/fetch\(/,"결제 실패·취소 페이지가 구독 활성화 API를 호출하면 안 됩니다.");
assert.match(failure,/replace\(\/\[\^A-Za-z0-9_-\]\//,"결제사 오류 코드는 화면 표시 전에 제한해야 합니다.");
console.log("결제 성공·취소 반환 화면의 인증·중복·민감정보 경계를 확인");

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source=await readFile(new URL("../public/api-guide.html",import.meta.url),"utf8");
assert.match(source,/data-credential="'\+escapeHtml\(f\[4\]\|\|""\)\+'"/,"인증정보 필드는 허용된 서버 필드명에만 매핑해야 합니다.");
assert.match(source,/provider-credentials\/naver-searchad/,"네이버 검색광고 전용 자격정보 API를 사용해야 합니다.");
assert.match(source,/authorization:`Bearer \$\{token\}`/,"API 연결 요청은 Firebase ID 토큰으로 인증해야 합니다.");
assert.match(source,/button\.disabled=!\(apiBase&&currentUser&&workspaceId\)/,"서버·로그인·워크스페이스가 모두 준비되기 전에는 연결 조작을 막아야 합니다.");
assert.match(source,/if\(!confirm\("저장된 네이버 검색광고 연결 정보를 삭제할까요\?"\)\)return/,"연결 삭제 전에 고객 재확인을 받아야 합니다.");
assert.match(source,/input\.value=""/,"저장 성공 뒤 입력한 비밀정보를 화면에서 지워야 합니다.");
assert.match(source,/badge\.textContent!==label/,"상태 렌더링이 MutationObserver를 반복 호출하면 안 됩니다.");
assert.equal(/localStorage|sessionStorage|indexedDB/.test(source),false,"API 키를 브라우저 저장소에 남기면 안 됩니다.");
console.log("네이버 검색광고 연결의 인증·활성화·삭제 확인·입력 제거 경계를 확인");

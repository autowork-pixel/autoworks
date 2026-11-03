import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
assert.match(source, /confirmation !== "DELETE"/, "탈퇴 요청 전에 명시적 확인 문구를 검사해야 합니다.");
assert.match(source, /auth\.currentUser, workspaceId = window\.autoworksWorkspaceId/, "현재 로그인 계정과 워크스페이스를 함께 확인해야 합니다.");
assert.match(source, /authorization:`Bearer \$\{token\}`/, "탈퇴 요청은 Firebase ID 토큰으로 인증해야 합니다.");
assert.match(source, /\/v1\/account-deletion-requests/, "탈퇴 요청은 서버 전용 API로 보내야 합니다.");
assert.match(source, /accountDeletionSubmit"\)\.disabled = !apiBase/, "서버 미연결 환경에서 탈퇴 요청 버튼을 비활성화해야 합니다.");
console.log("계정 탈퇴 요청의 확인·인증·서버 연결 경계를 확인");

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const cases = [
  ["content-pack.js", /selectedProject !== el\.project\.value/, /projectId: selectedProject/],
  ["content-reference.js", /if \(!requestCurrent\(context\)\) return/, /projectId: selectedProject/],
  ["collab-post.js", /if \(!lookupCurrent\(context\)\) return/, /projectId: selectedProject/],
  ["weekly-ad.js", /selectedProject !== projectSelect\.value/, /projectId: selectedProject/],
  ["ai-blog.js", /selectedProject!==el\.project\.value/, /projectId:selectedProject/],
  ["influencer-candidates.js", /if\(!requestCurrent\(context\)\)return/, /projectId:selectedProject/],
  ["naver-visibility.js", /selectedProject!==el\.project\.value/, /projectId:selectedProject/]
];

for (const [file, guard, request] of cases) test(`${file} 실행 응답은 요청 당시 프로젝트에서만 반영한다`, async () => {
  const source = await readFile(new URL(`../public/${file}`, import.meta.url), "utf8");
  assert.match(source, request);
  assert.match(source, guard);
});

const errorCases = [
  ["content-pack.js", /catch \(error\) \{ if \(currentUser === user && currentWorkspace === workspaceId && selectedProject === el\.project\.value\)/],
  ["content-reference.js", /if \(requestCurrent\(context\)\) message\(error\.message, "error"\)/],
  ["collab-post.js", /catch \(error\) \{ if \(lookupCurrent\(context\)\) lookupStatus\.textContent = error\.message; \}/],
  ["weekly-ad.js", /requestUser === accountState\.user && requestWorkspace === accountState\.workspaceId && requestProject === projectSelect\.value/],
  ["ai-blog.js", /catch\(error\)\{if\(currentUser===user&&currentWorkspace===workspaceId&&selectedProject===el\.project\.value\)/],
  ["influencer-candidates.js", /catch\(error\)\{if\(requestCurrent\(context\)\)message\(error\.message,"error"\)\}/],
  ["naver-visibility.js", /catch\(error\)\{if\(u===user&&w===workspaceId&&selectedProject===el\.project\.value\)/]
];

for (const [file, guard] of errorCases) test(`${file} 이전 요청 오류는 바뀐 계정·프로젝트 화면을 덮지 않는다`, async () => {
  const source = await readFile(new URL(`../public/${file}`, import.meta.url), "utf8");
  assert.match(source, guard);
});

test("collab-post.js 이전 URL·플랫폼·프로젝트 요청은 현재 화면과 버튼 상태를 덮지 않는다", async () => {
  const source = await readFile(new URL("../public/collab-post.js", import.meta.url), "utf8");
  assert.match(source, /let user = null, workspaceId = null, database, auth, generation = 0, lookupGeneration = 0, historyGeneration = 0/);
  assert.match(source, /function lookupCurrent\(context\)/);
  assert.match(source, /context\.url === postUrl\.value\.trim\(\)/);
  assert.match(source, /postUrl\.addEventListener\("input", \(\) => \{ lookupGeneration\+\+; requestKey = null; clearResult\(\)/);
  assert.match(source, /const context = \{ generation: \+\+lookupGeneration, user, workspaceId, projectId: project\.value, platform: platform\.value, url: postUrl\.value\.trim\(\) \}/);
  assert.match(source, /body: JSON\.stringify\(\{ projectId: selectedProject, url: context\.url, idempotencyKey: requestKey \}\)/);
  assert.match(source, /finally \{ if \(lookupCurrent\(context\)\) updateAvailability\(\); \}/);
  assert.match(source, /const requestHistoryGeneration = \+\+historyGeneration/);
  assert.match(source, /requestHistoryGeneration !== historyGeneration/);
});

test("influencer-candidates.js 이전 조건·프로젝트 요청은 현재 후보와 버튼 상태를 덮지 않는다", async () => {
  const source = await readFile(new URL("../public/influencer-candidates.js", import.meta.url), "utf8");
  assert.match(source, /requestGeneration=0,historyGeneration=0/);
  assert.match(source, /function formFingerprint\(\)/);
  assert.match(source, /function requestCurrent\(context\)/);
  assert.match(source, /el\.candidateForm\.addEventListener\("input",\(\)=>\{requestGeneration\+\+;requestKey=null;render\(\);update\(\)\}\)/);
  assert.match(source, /const context=\{generation:\+\+requestGeneration,user,workspaceId,projectId:el\.project\.value,fingerprint:formFingerprint\(\)\}/);
  assert.match(source, /if\(!requestCurrent\(context\)\)return;render\(body\.rows\)/);
  assert.match(source, /finally\{if\(requestCurrent\(context\)\)update\(\)\}/);
  assert.match(source, /const currentGeneration=\+\+historyGeneration/);
  assert.match(source, /currentGeneration!==historyGeneration/);
});

test("content-reference.js 이전 조건·프로젝트 요청은 현재 레퍼런스와 버튼 상태를 덮지 않는다", async () => {
  const source = await readFile(new URL("../public/content-reference.js", import.meta.url), "utf8");
  assert.match(source, /requestGeneration = 0, historyGeneration = 0/);
  assert.match(source, /function formFingerprint\(\)/);
  assert.match(source, /function requestCurrent\(context\)/);
  assert.match(source, /requestGeneration\+\+; requestKey = null; render\(\); update\(\)/);
  assert.match(source, /const context = \{ generation: \+\+requestGeneration, user, workspaceId, projectId: el\.project\.value, fingerprint: formFingerprint\(\) \}/);
  assert.match(source, /if \(!requestCurrent\(context\)\) return/);
  assert.match(source, /if \(requestCurrent\(context\)\) update\(\)/);
  assert.match(source, /const currentGeneration = \+\+historyGeneration/);
  assert.match(source, /currentGeneration !== historyGeneration/);
});

test("brand-search.js 예약·상태 조회는 요청 당시 계정·워크스페이스·프로젝트만 갱신한다", async () => {
  const source = await readFile(new URL("../public/brand-search.js", import.meta.url), "utf8");
  assert.match(source, /function captureContext\(runId=state\.runId\)/);
  assert.match(source, /function isCurrent\(context,/);
  assert.match(source, /projectId:context\.projectId/);
  assert.match(source, /await poll\(runContext\)/);
  assert.match(source, /state\.pollTimer=setTimeout\(\(\)=>poll\(context\),3000\)/);
  assert.match(source, /state\.pollFailureGeneration!==context\.runGeneration/);
  assert.match(source, /if\(state\.pollFailures>=5\)\{stopPolling\(\);elements\.submit\.disabled=false/);
  assert.match(source, /Math\.min\(60000,5000\*\(2\*\*\(state\.pollFailures-1\)\)\)/);
  assert.match(source, /if\(state\.requestFingerprint!==fingerprint\)\{state\.requestKey=crypto\.randomUUID\(\)\.replaceAll\("-",""\);state\.requestFingerprint=fingerprint\}/);
  assert.match(source, /JSON\.stringify\(\{\.\.\.input,idempotencyKey:requestKey\}\)/);
  assert.match(source, /if\(terminalRequestErrors\.has\(error\.code\)\)\{state\.requestKey=null;state\.requestFingerprint=null\}/);
  assert.match(source, /state\.requestKey=null;state\.requestFingerprint=null;state\.runId=result\.runId/);
});

test("brand-search.js 취소·다운로드·비교의 늦은 응답은 현재 화면을 덮지 않는다", async () => {
  const source = await readFile(new URL("../public/brand-search.js", import.meta.url), "utf8");
  assert.match(source, /\?projectId=\$\{encodeURIComponent\(context\.projectId\)\}/);
  assert.match(source, /path\(context\.runId,":cancel",context\)/);
  assert.match(source, /if\(!isCurrent\(context\)\)return;renderRun\(run\)/);
  assert.match(source, /path\(context\.runId,"\/report\.csv",context\)/);
  assert.match(source, /if\(!isCurrent\(context\)\)return;const url=URL\.createObjectURL/);
  assert.match(source, /if\(!isCurrent\(context\)\|\|runIds\.some/);
  assert.match(source, /context\.runId===state\.runId&&context\.runGeneration===state\.runGeneration/);
  assert.match(source, /state\.runGeneration\+\+;const context=captureContext\(\);elements\.cancel\.disabled=true/);
  assert.match(source, /취소하지 못했습니다[\s\S]*state\.pollTimer=setTimeout\(\(\)=>poll\(context\),3000\)/);
  assert.match(source, /if\(!isCurrent\(context,\{run:Boolean\(selectRunId\)\}\)\)return;state\.runs=body\.runs/);
});

test("brand-search.js 인증·프로젝트 전환은 진행 중인 이전 상태를 초기화한다", async () => {
  const source = await readFile(new URL("../public/brand-search.js", import.meta.url), "utf8");
  assert.match(source, /const generation=\+\+state\.authGeneration/);
  assert.match(source, /generation!==state\.authGeneration\|\|user!==state\.user/);
  assert.match(source, /elements\.project\.addEventListener\("change",async\(\)=>\{stopPolling\(\);state\.runId=null;state\.runGeneration\+\+;state\.runs=\[\]/);
  assert.match(source, /context=captureContext\(null\)/);
  assert.match(source, /catch\(error\)\{if\(isCurrent\(context,\{run:false\}\)\)setMessage\(`실행 내역을 불러오지 못했습니다/);
  assert.match(source, /elements\.cancel\.disabled=false;elements\.download\.disabled=false/);
  assert.match(source, /elements\.submit\.disabled=!option\?\.value\|\|!apiBase/);
  assert.match(source, /elements\.submit\.disabled=!state\.user\|\|!state\.workspaceId\|\|!elements\.project\.value\|\|!apiBase/);
  assert.match(source, /state\.runs=\[\];state\.requestKey=null;state\.requestFingerprint=null/);
  assert.match(source, /window\.addEventListener\("pagehide",\(\)=>\{stopPolling\(\);state\.runGeneration\+\+\}\)/);
  assert.match(source, /window\.addEventListener\("pageshow",event=>\{if\(!event\.persisted/);
  assert.match(source, /if\(context\.runId\)resumeCurrentRun\(\);else refreshHistory\(null,context\)/);
  assert.match(source, /function resumeCurrentRun\(\)\{if\(!state\.runId\|\|state\.pollTimer\|\|document\.visibilityState==="hidden"\)return/);
  assert.match(source, /document\.addEventListener\("visibilitychange",\(\)=>\{if\(document\.visibilityState==="hidden"\)\{stopPolling\(\);state\.runGeneration\+\+;return\}resumeCurrentRun\(\)\}\)/);
});

import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { once } from "node:events";
import { ApiError } from "../src/domain.mjs";
import { createHandler } from "../src/handler.mjs";

async function withServer(dependencies, callback) {
  const server = createServer(createHandler(dependencies));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    await callback(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

const validBody = {
  projectId: "project-a",
  brand: "오토웍스",
  competitors: [],
  keywords: ["마케팅 자동화"],
  displayPeriodDays: 28,
  roundingUnit: 10,
  idempotencyKey: "random-request-key-0001"
};

const requestRun = (base, body = validBody, headers = {}) => fetch(`${base}/v1/workspaces/workspace-a/brand-search-runs`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: "Bearer token", ...headers },
  body: JSON.stringify(body)
});

const requestProject = (base, body = { name: "브랜드 모니터링", brandName: "오토웍스", keywords: ["오토웍스", "오토웍스"] }, headers = {}) =>
  fetch(`${base}/v1/workspaces/workspace-a/projects`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer token", ...headers },
    body: JSON.stringify(body)
  });

test("health check는 인증 없이 응답한다", async () => {
  await withServer({ verifyIdToken: async () => ({}), repository: {} }, async base => {
    const response = await fetch(`${base}/health-check`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
  });
});

test("주간 광고 결과 저장은 인증·입력 검증 뒤 고객별 저장소에 전달한다", async () => {
  const metrics = { impr: 1000, click: 50, cost: 10000, conv: 5, revenue: 30000, ctr: 5, cpc: 200, cvr: 10, roas: 300 };
  const body = { projectId: "project-a", idempotencyKey: "random-request-key-0001", sourceName: "ads.xlsx", sheet: "광고",
    analysis: { rowCount: 1, total: metrics, campaigns: [], waste: [], winners: [] } };
  let received;
  await withServer({ verifyIdToken: async () => ({ uid: "user-a" }),
    repository: { saveWeeklyAdReport: async value => { received = value; return { runId: "run-a", reused: false }; } }
  }, async base => {
    const url = `${base}/v1/workspaces/workspace-a/weekly-ad-reports`;
    const headers = { authorization: "Bearer token", "content-type": "application/json" };
    assert.equal((await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).status, 401);
    assert.equal((await fetch(url, { method: "POST", headers, body: JSON.stringify({ ...body, sourceName: "wrong.csv" }) })).status, 400);
    const response = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
    assert.equal(response.status, 201);
    assert.equal((await response.json()).runId, "run-a");
    assert.equal(received.uid, "user-a");
    assert.equal(received.workspaceId, "workspace-a");
    assert.equal(received.input.analysis.total.roas, 300);
  });
});

test("광고 API 보고서는 인증과 31일 기간 검증 뒤 실행한다", async () => {
  let received;
  await withServer({ verifyIdToken: async () => ({ uid: "user-a" }), repository: {}, adReportService: { run: async value => {
    received = value; return { runId: "run-ad", status: "succeeded", rows: [{ platform: "meta-ads", cost: 1000 }] };
  } } }, async base => {
    const url = `${base}/v1/workspaces/workspace-a/ad-report-runs`;
    const body = { projectId: "project-a", provider: "meta-ads", since: "2026-10-01", until: "2026-10-31", idempotencyKey: "random-request-key-0001" };
    assert.equal((await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).status, 401);
    assert.equal((await fetch(url, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer token" },
      body: JSON.stringify({ ...body, since: "2026-09-01" }) })).status, 400);
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer token" }, body: JSON.stringify(body) });
    assert.equal(response.status, 201);
    assert.equal((await response.json()).runId, "run-ad");
    assert.equal(received.uid, "user-a");
    assert.equal(received.input.provider, "meta-ads");
  });
});

test("협업 YouTube 실행은 인증과 URL 검증 뒤에만 호출한다", async () => {
  let received;
  await withServer({ verifyIdToken: async () => ({ uid: "user-a" }), repository: {},
    collabYouTubeService: { run: async value => { received = value; return { runId: "run-a", status: "succeeded", post: { views: 12 } }; } }
  }, async base => {
    const url = `${base}/v1/workspaces/workspace-a/collab-youtube-runs`;
    const body = { projectId: "project-a", idempotencyKey: "random-request-key-0001", url: "https://youtu.be/AbCde123_-0" };
    assert.equal((await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).status, 401);
    assert.equal((await fetch(url, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer token" },
      body: JSON.stringify({ ...body, url: "https://youtube.com.evil.test/watch?v=AbCde123_-0" }) })).status, 400);
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer token" }, body: JSON.stringify(body) });
    assert.equal(response.status, 201);
    assert.equal((await response.json()).post.views, 12);
    assert.equal(received.uid, "user-a");
    assert.equal(received.input.videoId, "AbCde123_-0");
  });
});

test("협업 Instagram 실행은 인증과 공식 게시물 URL 검증 뒤에만 호출한다", async () => {
  let received;
  await withServer({ verifyIdToken: async () => ({ uid: "user-a" }), repository: {},
    collabInstagramService: { run: async value => { received = value; return { runId: "run-a", status: "succeeded", post: { platform: "Instagram", likes: 12 } }; } }
  }, async base => {
    const url = `${base}/v1/workspaces/workspace-a/collab-instagram-runs`;
    const body = { projectId: "project-a", idempotencyKey: "random-request-key-0001", url: "https://www.instagram.com/reel/ABC_123/" };
    assert.equal((await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).status, 401);
    assert.equal((await fetch(url, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer token" },
      body: JSON.stringify({ ...body, url: "https://instagram.com.evil.test/reel/ABC_123/" }) })).status, 400);
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer token" }, body: JSON.stringify(body) });
    assert.equal(response.status, 201);
    assert.equal((await response.json()).post.likes, 12);
    assert.equal(received.uid, "user-a");
    assert.equal(received.input.shortcode, "ABC_123");
  });
});

test("화제 콘텐츠 수집은 인증과 제한된 조건 검증 뒤에만 호출한다", async () => {
  let received;
  await withServer({ verifyIdToken: async () => ({ uid: "user-a" }), repository: {}, contentReferenceService: { run: async value => {
    received = value; return { runId: "run-a", status: "succeeded", rows: [{ title: "영상" }] };
  } } }, async base => {
    const url = `${base}/v1/workspaces/workspace-a/content-reference-runs`, body = { projectId: "project-a", brand: "오토웍스", category: "마케팅", keywords: ["자동화"], target: "담당자", strengths: [], periodDays: 28, collectCount: 5, idempotencyKey: "random-request-key-0001" };
    assert.equal((await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).status, 401);
    assert.equal((await fetch(url, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer token" }, body: JSON.stringify({ ...body, collectCount: 100 }) })).status, 400);
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer token" }, body: JSON.stringify(body) });
    assert.equal(response.status, 201);
    assert.equal((await response.json()).rows[0].title, "영상");
    assert.equal(received.uid, "user-a");
    assert.deepEqual(received.input.keywords, ["자동화"]);
  });
});

test("인플루언서 후보 검색은 인증과 구독자 범위 검증 뒤에만 호출한다",async()=>{let received;await withServer({verifyIdToken:async()=>({uid:"user-a"}),repository:{},influencerCandidateService:{run:async value=>{received=value;return{runId:"run-a",status:"succeeded",rows:[{channelTitle:"채널"}]}}}},async base=>{const url=`${base}/v1/workspaces/workspace-a/influencer-candidate-runs`,body={projectId:"project-a",brand:"오토웍스",keywords:["마케팅"],subscriberMin:1000,subscriberMax:100000,candidateCount:5,idempotencyKey:"random-request-key-0001"};assert.equal((await fetch(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)})).status,401);assert.equal((await fetch(url,{method:"POST",headers:{"content-type":"application/json",authorization:"Bearer token"},body:JSON.stringify({...body,subscriberMax:10})})).status,400);const response=await fetch(url,{method:"POST",headers:{"content-type":"application/json",authorization:"Bearer token"},body:JSON.stringify(body)});assert.equal(response.status,201);assert.equal((await response.json()).rows[0].channelTitle,"채널");assert.equal(received.uid,"user-a")})});

test("AI 블로그 초안은 인증과 사실 입력 검증 뒤에만 호출한다",async()=>{let received;await withServer({verifyIdToken:async()=>({uid:"user-a"}),repository:{},aiBlogService:{run:async value=>{received=value;return{runId:"run-a",status:"succeeded",draft:"# 초안"}}}},async base=>{const url=`${base}/v1/workspaces/workspace-a/ai-blog-runs`,body={projectId:"project-a",topic:"자동화",facts:"확인된 사실",keywords:["마케팅"],contentType:"정보형",tone:"전문적",targetLength:1500,sourceDraft:"",idempotencyKey:"random-request-key-0001"};assert.equal((await fetch(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)})).status,401);assert.equal((await fetch(url,{method:"POST",headers:{"content-type":"application/json",authorization:"Bearer token"},body:JSON.stringify({...body,facts:""})})).status,400);const response=await fetch(url,{method:"POST",headers:{"content-type":"application/json",authorization:"Bearer token"},body:JSON.stringify(body)});assert.equal(response.status,201);assert.equal((await response.json()).draft,"# 초안");assert.equal(received.uid,"user-a");assert.equal(received.input.targetLength,1500)})});

test("네이버 노출 점검은 인증과 공식 도메인 검증 뒤에만 호출한다",async()=>{let received;await withServer({verifyIdToken:async()=>({uid:"user-a"}),repository:{},naverVisibilityService:{run:async value=>{received=value;return{runId:"run-a",status:"succeeded",rows:[{keyword:"마케팅"}]}}}},async base=>{const url=`${base}/v1/workspaces/workspace-a/naver-visibility-runs`,body={projectId:"project-a",brand:"오토웍스",aliases:[],officialDomains:["example.com"],keywords:["마케팅"],resultCount:10,idempotencyKey:"random-request-key-0001"};assert.equal((await fetch(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)})).status,401);assert.equal((await fetch(url,{method:"POST",headers:{"content-type":"application/json",authorization:"Bearer token"},body:JSON.stringify({...body,officialDomains:["not a domain /x"]})})).status,400);const response=await fetch(url,{method:"POST",headers:{"content-type":"application/json",authorization:"Bearer token"},body:JSON.stringify(body)});assert.equal(response.status,201);assert.equal((await response.json()).rows[0].keyword,"마케팅");assert.equal(received.input.officialDomains[0],"example.com")})});

test("콘텐츠 자동 제작은 인증과 허용 채널 검증 뒤에만 호출한다",async()=>{let received;await withServer({verifyIdToken:async()=>({uid:"user-a"}),repository:{},contentPackService:{run:async value=>{received=value;return{runId:"run-a",status:"succeeded",markdown:"# 초안"}}}},async base=>{const url=`${base}/v1/workspaces/workspace-a/content-pack-runs`,body={projectId:"project-a",campaign:"신제품",facts:"확인된 사실",sourceDraft:"",audience:"직장인",callToAction:"문의",channels:["블로그"],idempotencyKey:"random-request-key-0001"};assert.equal((await fetch(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)})).status,401);assert.equal((await fetch(url,{method:"POST",headers:{"content-type":"application/json",authorization:"Bearer token"},body:JSON.stringify({...body,channels:["자동 게시"]})})).status,400);const response=await fetch(url,{method:"POST",headers:{"content-type":"application/json",authorization:"Bearer token"},body:JSON.stringify(body)});assert.equal(response.status,201);assert.equal((await response.json()).markdown,"# 초안");assert.equal(received.input.channels[0],"블로그")})});

test("프로젝트 생성은 인증과 입력 정규화 뒤 서버 저장소에 전달한다", async () => {
  let received;
  await withServer({
    verifyIdToken: async () => ({ uid: "user-a" }),
    repository: { createProject: async value => { received = value; return { projectId: "project-a", projectLimit: 1 }; } }
  }, async base => {
    const response = await requestProject(base);
    assert.equal(response.status, 201);
    assert.equal((await response.json()).projectId, "project-a");
    assert.deepEqual(received, {
      workspaceId: "workspace-a",
      uid: "user-a",
      input: { name: "브랜드 모니터링", brandName: "오토웍스", keywords: ["오토웍스"] }
    });
  });
});

test("프로젝트 생성은 비로그인·잘못된 입력·요금제 한도를 구분한다", async () => {
  let called = 0;
  const dependencies = {
    verifyIdToken: async token => {
      if (token === "invalid") throw new Error("invalid");
      return { uid: "user-a" };
    },
    repository: { createProject: async () => { called += 1; throw new ApiError("PROJECT_LIMIT_EXCEEDED", "이 요금제는 프로젝트를 1개까지 만들 수 있습니다.", 409); } }
  };
  await withServer(dependencies, async base => {
    assert.equal((await fetch(`${base}/v1/workspaces/workspace-a/projects`, { method:"POST", headers:{ "content-type":"application/json" }, body:"{}" })).status, 401);
    assert.equal((await requestProject(base, { name:"", brandName:"오토웍스", keywords:[] })).status, 400);
    const limited = await requestProject(base);
    assert.equal(limited.status, 409);
    assert.equal((await limited.json()).error.code, "PROJECT_LIMIT_EXCEEDED");
    assert.equal(called, 1);
  });
});

test("로그인 토큰이 없으면 repository를 호출하지 않는다", async () => {
  let called = false;
  await withServer({ verifyIdToken: async () => ({ uid: "user-a" }), repository: { reserveBrandSearchRun: async () => { called = true; } } }, async base => {
    const response = await fetch(`${base}/v1/workspaces/workspace-a/brand-search-runs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(validBody) });
    assert.equal(response.status, 401);
    assert.equal(called, false);
  });
});

test("JSON이 아닌 본문은 인증·repository 호출 전에 거부한다", async () => {
  let authCalled = false;
  let repositoryCalled = false;
  await withServer({
    verifyIdToken: async () => { authCalled = true; return { uid: "user-a" }; },
    repository: { reserveBrandSearchRun: async () => { repositoryCalled = true; } }
  }, async base => {
    const response = await fetch(`${base}/v1/workspaces/workspace-a/brand-search-runs`, {
      method: "POST",
      headers: { "content-type": "text/plain", authorization: "Bearer token" },
      body: "not-json"
    });
    assert.equal(response.status, 415);
    assert.equal(authCalled, false);
    assert.equal(repositoryCalled, false);
  });
});

test("64KB를 넘는 본문은 repository 호출 전에 거부한다", async () => {
  let called = false;
  await withServer({
    verifyIdToken: async () => ({ uid: "user-a" }),
    repository: { reserveBrandSearchRun: async () => { called = true; } }
  }, async base => {
    const response = await requestRun(base, { ...validBody, brand: "가".repeat(70 * 1024) });
    assert.equal(response.status, 413);
    assert.equal(called, false);
  });
});

test("정상 요청은 uid와 정규화된 입력으로 실행을 예약한다", async () => {
  let received;
  await withServer({
    verifyIdToken: async () => ({ uid: "user-a" }),
    repository: { reserveBrandSearchRun: async value => { received = value; return { runId: "run-a", status: "queued", reused: false }; } }
  }, async base => {
    const response = await requestRun(base);
    assert.equal(response.status, 202);
    const body = await response.json();
    assert.equal(body.runId, "run-a");
    assert.equal(body.reused, false);
    assert.equal(received.uid, "user-a");
    assert.deepEqual(received.input.keywords, ["오토웍스", "마케팅 자동화"]);
  });
});

test("같은 멱등 요청은 기존 실행을 반환한다", async () => {
  const dispatched = [];
  await withServer({
    verifyIdToken: async () => ({ uid: "user-a" }),
    repository: { reserveBrandSearchRun: async () => ({ runId: "run-a", status: "queued", reused: true }) },
    taskDispatcher: { dispatch: async value => dispatched.push(value) }
  }, async base => {
    const response = await requestRun(base);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).reused, true);
    assert.deepEqual(dispatched, [{ workspaceId: "workspace-a", runId: "run-a" }]);
  });
});

test("큐 등록 실패 후 같은 멱등 요청을 재시도할 수 있게 503을 반환한다", async () => {
  await withServer({
    verifyIdToken: async () => ({ uid: "user-a" }),
    repository: { reserveBrandSearchRun: async () => ({ runId: "run-a", status: "queued", reused: false }) },
    taskDispatcher: { dispatch: async () => { throw new ApiError("TASK_DISPATCH_FAILED", "같은 요청으로 다시 시도해주세요.", 503); } }
  }, async base => {
    const response = await requestRun(base);
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.equal(body.error.code, "TASK_DISPATCH_FAILED");
  });
});

test("로그인한 소유자의 실행 취소 요청을 저장소에 전달한다", async () => {
  let received;
  await withServer({
    verifyIdToken: async () => ({ uid: "user-a" }),
    repository: { cancelBrandSearchRun: async value => { received = value; return { status: "canceled", reused: false }; } }
  }, async base => {
    const response = await fetch(`${base}/v1/workspaces/workspace-a/brand-search-runs/run-a:cancel?projectId=project-a`, { method: "POST", headers: { authorization: "Bearer token" } });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).status, "canceled");
    assert.deepEqual(received, { workspaceId: "workspace-a", runId: "run-a", projectId: "project-a", uid: "user-a" });
  });
});

test("실행 상태와 UTF-8 CSV 결과를 인증 후 반환한다", async () => {
  const received = [];
  await withServer({
    verifyIdToken: async () => ({ uid: "user-a" }),
    repository: {
      getBrandSearchRun: async value => { received.push(value); return { runId: "run-a", status: "succeeded", resultReady: true }; },
      getBrandSearchReport: async value => { received.push(value); return { rows: [{ keyword: "=위험", pc: 1, mobile: 2, total: 3, recordedAt: { toDate: () => new Date("2026-11-03T00:00:00Z") } }] }; }
    }
  }, async base => {
    const headers = { authorization: "Bearer token" };
    const statusResponse = await fetch(`${base}/v1/workspaces/workspace-a/brand-search-runs/run-a?projectId=project-a`, { headers });
    assert.equal(statusResponse.status, 200);
    const statusBody = await statusResponse.json();
    assert.equal(statusBody.resultReady, true);
    assert.deepEqual(Object.keys(statusBody).sort(), ["requestId", "resultReady", "runId", "status"]);
    const csvResponse = await fetch(`${base}/v1/workspaces/workspace-a/brand-search-runs/run-a/report.csv?projectId=project-a`, { headers });
    const body = await csvResponse.text();
    assert.equal(csvResponse.status, 200);
    assert.match(csvResponse.headers.get("content-disposition"), /brand-search-run-a\.csv/);
    assert.equal(body.includes("'=위험"), true);
    assert.equal(body.includes("2026-11-03T00:00:00.000Z"), true);
    assert.deepEqual(received, [
      { workspaceId: "workspace-a", runId: "run-a", projectId: "project-a", uid: "user-a" },
      { workspaceId: "workspace-a", runId: "run-a", projectId: "project-a", uid: "user-a" }
    ]);
  });
});

test("실행 상태·취소·결과 요청은 프로젝트 ID 없이는 저장소를 호출하지 않는다", async () => {
  let called = false;
  const repository = {
    getBrandSearchRun: async () => { called = true; },
    getBrandSearchReport: async () => { called = true; },
    cancelBrandSearchRun: async () => { called = true; }
  };
  await withServer({ verifyIdToken: async () => ({ uid: "user-a" }), repository }, async base => {
    const headers = { authorization: "Bearer token" };
    assert.equal((await fetch(`${base}/v1/workspaces/workspace-a/brand-search-runs/run-a`, { headers })).status, 400);
    assert.equal((await fetch(`${base}/v1/workspaces/workspace-a/brand-search-runs/run-a/report.csv`, { headers })).status, 400);
    assert.equal((await fetch(`${base}/v1/workspaces/workspace-a/brand-search-runs/run-a:cancel`, { method: "POST", headers })).status, 400);
    assert.equal(called, false);
  });
});

test("최근 실행 목록은 인증 uid와 프로젝트·제한 개수를 저장소에 전달한다", async () => {
  let received;
  await withServer({
    verifyIdToken: async () => ({ uid: "user-a" }),
    repository: { listBrandSearchRuns: async value => { received = value; return [{ runId: "run-a", status: "succeeded", resultReady: true }]; } }
  }, async base => {
    const response = await fetch(`${base}/v1/workspaces/workspace-a/brand-search-runs?limit=10&projectId=project-a`, { headers: { authorization: "Bearer token" } });
    assert.equal(response.status, 200);
    assert.deepEqual(received, { workspaceId: "workspace-a", uid: "user-a", projectId: "project-a", limit: 10 });
    assert.equal((await response.json()).runs[0].runId, "run-a");
  });
});

test("최근 실행 목록의 잘못된 프로젝트 ID는 저장소 호출 전에 거부한다", async () => {
  let called = false;
  await withServer({
    verifyIdToken: async () => ({ uid: "user-a" }),
    repository: { listBrandSearchRuns: async () => { called = true; return []; } }
  }, async base => {
    const response = await fetch(`${base}/v1/workspaces/workspace-a/brand-search-runs?projectId=bad%20project`, { headers: { authorization: "Bearer token" } });
    assert.equal(response.status, 400);
    assert.equal(called, false);
  });
});

test("최근 실행 목록의 과도한 개수는 저장소 호출 전에 거부한다", async () => {
  let called = false;
  await withServer({
    verifyIdToken: async () => ({ uid: "user-a" }),
    repository: { listBrandSearchRuns: async () => { called = true; return []; } }
  }, async base => {
    const response = await fetch(`${base}/v1/workspaces/workspace-a/brand-search-runs?limit=100`, { headers: { authorization: "Bearer token" } });
    assert.equal(response.status, 400);
    assert.equal(called, false);
  });
});

test("로그인 토큰 없이는 실행 취소 저장소를 호출하지 않는다", async () => {
  let called = false;
  await withServer({ verifyIdToken: async () => ({ uid: "user-a" }), repository: { cancelBrandSearchRun: async () => { called = true; } } }, async base => {
    const response = await fetch(`${base}/v1/workspaces/workspace-a/brand-search-runs/run-a:cancel`, { method: "POST" });
    assert.equal(response.status, 401);
    assert.equal(called, false);
  });
});

test("도메인 오류는 안전한 코드로 반환한다", async () => {
  await withServer({
    verifyIdToken: async () => ({ uid: "user-a" }),
    repository: { reserveBrandSearchRun: async () => { throw new ApiError("USAGE_LIMIT_EXCEEDED", "이번 기간의 실행 한도를 초과했습니다.", 429); } }
  }, async base => {
    const response = await requestRun(base);
    assert.equal(response.status, 429);
    assert.equal((await response.json()).error.code, "USAGE_LIMIT_EXCEEDED");
  });
});

test("예상하지 못한 오류 내용은 고객 응답에 노출하지 않는다", async () => {
  const logs = [];
  await withServer({
    verifyIdToken: async () => ({ uid: "user-a" }),
    repository: { reserveBrandSearchRun: async () => { throw new Error("secret database detail"); } },
    logger: { error: (...args) => logs.push(args) }
  }, async base => {
    const response = await requestRun(base);
    const body = await response.json();
    assert.equal(response.status, 500);
    assert.equal(body.error.code, "INTERNAL_ERROR");
    assert.equal(JSON.stringify(body).includes("secret database detail"), false);
    assert.equal(logs.length, 1);
  });
});

test("키 관리 서비스가 없으면 API 연결 경로를 공개하지 않는다", async () => {
  await withServer({ verifyIdToken: async () => ({ uid: "user-a" }), repository: {} }, async base => {
    const response = await fetch(`${base}/v1/workspaces/workspace-a/provider-credentials/naver-searchad`, { headers: { authorization: "Bearer token" } });
    assert.equal(response.status, 404);
  });
});

test("API 연결 상태 조회는 토큰 uid와 워크스페이스를 서비스에 전달한다", async () => {
  let received;
  await withServer({
    verifyIdToken: async () => ({ uid: "user-a" }),
    repository: {},
    credentialService: { status: async value => { received = value; return { provider: "naver-searchad", status: "active", apiKeyHint: "••••1234" }; } }
  }, async base => {
    const response = await fetch(`${base}/v1/workspaces/workspace-a/provider-credentials/naver-searchad`, { headers: { authorization: "Bearer token" } });
    assert.equal(response.status, 200);
    assert.deepEqual(received, { workspaceId: "workspace-a", provider: "naver-searchad", uid: "user-a" });
    assert.equal(JSON.stringify(await response.json()).includes("ciphertext"), false);
  });
});

test("API 연결 저장 응답에는 원문 인증정보가 포함되지 않는다", async () => {
  let received;
  await withServer({
    verifyIdToken: async () => ({ uid: "user-a" }), repository: {},
    credentialService: { save: async value => { received = value; return { provider: "naver-searchad", status: "active", apiKeyHint: "••••1234" }; } }
  }, async base => {
    const credentials = { apiKey: "license-1234", secretKey: "very-secret", customerId: "987654" };
    const response = await fetch(`${base}/v1/workspaces/workspace-a/provider-credentials/naver-searchad`, {
      method: "PUT", headers: { authorization: "Bearer token", "content-type": "application/json" }, body: JSON.stringify(credentials)
    });
    assert.equal(response.status, 200);
    assert.deepEqual(received.credentials, credentials);
    const body = JSON.stringify(await response.json());
    assert.equal(body.includes("very-secret"), false);
    assert.equal(body.includes("license-1234"), false);
  });
});

test("API 연결 해제는 토큰 uid를 검증한 뒤 서비스에 위임한다", async () => {
  let received;
  await withServer({
    verifyIdToken: async () => ({ uid: "user-a" }), repository: {},
    credentialService: { remove: async value => { received = value; return { provider: "naver-searchad", status: "disconnected" }; } }
  }, async base => {
    const response = await fetch(`${base}/v1/workspaces/workspace-a/provider-credentials/naver-searchad`, { method: "DELETE", headers: { authorization: "Bearer token" } });
    assert.equal(response.status, 200);
    assert.equal(received.uid, "user-a");
  });
});

test("광고 매체별 자격정보 경로를 허용한다", async () => {
  const received = [];
  await withServer({
    verifyIdToken: async () => ({ uid: "user-a" }), repository: {},
    credentialService: { status: async value => { received.push(value); return { provider: value.provider, status: "disconnected" }; } }
  }, async base => {
    for (const provider of ["meta-ads", "google-ads", "kakao-moment"]) {
      const response = await fetch(`${base}/v1/workspaces/workspace-a/provider-credentials/${provider}`, { headers: { authorization: "Bearer token" } });
      assert.equal(response.status, 200);
    }
  });
  assert.deepEqual(received.map(value => value.provider), ["meta-ads", "google-ads", "kakao-moment"]);
});


import { buildTopicCandidates } from "./content-topics.js";

const apiBase = String(window.AUTOWORKS_API_BASE || "").replace(/\/$/, "");
const hosts = new Set(["localhost", "127.0.0.1", "autoworks-c9a6a.web.app", "autoworks-c9a6a.firebaseapp.com"]);
const ids = ["packForm", "login", "project", "topicHook", "makeTopics", "topicIdeas", "campaign", "facts", "sourceDraft", "audience", "callToAction", "channels", "submit", "status", "history", "draft", "meta", "copy", "download"];
const el = Object.fromEntries(ids.map(id => [id, document.getElementById(id)]));
const topicHelp = el.makeTopics.nextElementSibling;
if (topicHelp?.classList.contains("meta")) topicHelp.textContent = "저장된 프로젝트 키워드와 최근 브랜드 검색량 결과로 후보 순서를 정합니다. 검색량이 없으면 프로젝트 순서를 유지하며 뉴스 신호는 반영하지 않습니다.";
let user = null, workspaceId = null, database, generation = 0, reports = new Map(), requestKey = null, topicSignals = [], loadSignals = async () => {};

function message(value, type = "") { el.status.textContent = value; el.status.className = `status ${type}`.trim(); }
function selectedChannels() { return [...el.channels.querySelectorAll("input:checked")].map(input => input.value); }
function update() {
  el.makeTopics.disabled = !user || !workspaceId || !el.project.value;
  el.submit.disabled = !apiBase || !user || !workspaceId || !el.project.value;
  el.copy.disabled = el.download.disabled = !el.draft.value;
}
function show(report) {
  el.draft.value = report?.markdown || "";
  el.meta.textContent = report?.markdown ? `${(report.channels || []).join(" · ")} · ${report.model || "AI 모델"} · 미게시 · 검토 필요` : "미게시 상태로만 저장됩니다.";
  update();
}
async function history(getDocs, collection, query, where, orderBy, limit) {
  const currentUser = user, currentWorkspace = workspaceId;
  const snapshot = await getDocs(query(collection(database, "workspaces", currentWorkspace, "reports"), where("tool", "==", "content-pack"), orderBy("createdAt", "desc"), limit(50)));
  if (currentUser !== user || currentWorkspace !== workspaceId) return;
  reports = new Map(snapshot.docs.filter(item => typeof item.data().markdown === "string").map(item => [item.id, item.data()]));
  el.history.replaceChildren(new Option(reports.size ? "저장된 콘텐츠 선택" : "저장된 콘텐츠 없음", ""));
  for (const [id, report] of reports) el.history.add(new Option(report.summary || "콘텐츠 묶음", id));
  el.history.disabled = !reports.size;
}

el.history.addEventListener("change", () => show(reports.get(el.history.value)));
el.project.addEventListener("change", () => { requestKey = null; topicSignals = []; el.topicIdeas.replaceChildren(); update(); loadSignals(); });
el.packForm.addEventListener("input", () => { requestKey = null; });
el.audience.addEventListener("input", () => el.topicIdeas.replaceChildren());
el.topicHook.addEventListener("change", () => el.topicIdeas.replaceChildren());
el.makeTopics.addEventListener("click", () => {
  const keywords = (el.project.selectedOptions[0]?.dataset.keywords || "").split("\n");
  const ideas = buildTopicCandidates(keywords, el.audience.value, el.topicHook.value, topicSignals);
  el.topicIdeas.replaceChildren();
  if (!ideas.length) return message("프로젝트 키워드와 타깃을 먼저 입력해 주세요.", "error");
  for (const idea of ideas) {
    const button = document.createElement("button");
    button.type = "button"; button.className = "secondary"; button.textContent = `${idea.title} · ${idea.note}`;
    button.addEventListener("click", () => { el.campaign.value = idea.title; requestKey = null; message("주제를 캠페인에 넣었습니다. 확인된 사실을 입력해 주세요."); });
    el.topicIdeas.append(button);
  }
  const signaled = ideas.filter(idea => idea.searchVolume !== null).length;
  const stale = ideas.filter(idea => idea.searchStale).length;
  message(stale ? `${stale}개 검색량이 30일 이상 지난 참고값입니다. 새 조회 후 다시 확인하세요.` : signaled ? `최근 월간 검색량이 있는 후보 ${signaled}개를 우선했습니다.` : "저장된 검색량이 없어 프로젝트 키워드 순서로 후보를 만들었습니다.", stale ? "error" : "");
});
el.copy.addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(el.draft.value); message("복사했습니다.", "success"); }
  catch { message("복사하지 못했습니다.", "error"); }
});
el.download.addEventListener("click", () => {
  const url = URL.createObjectURL(new Blob([el.draft.value], { type: "text/markdown;charset=utf-8" }));
  const link = document.createElement("a"); link.href = url; link.download = "autoworks-content-pack.md"; link.click(); URL.revokeObjectURL(url);
});

async function initialize() {
  if (!hosts.has(location.hostname)) { message("배포된 웹에서 로그인할 수 있습니다.", "error"); return; }
  const [{ initializeApp, getApps }, { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged },
    { getFirestore, collection, query, where, orderBy, limit, getDocs }] = await Promise.all([
      import("https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js"),
      import("https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js"),
      import("https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js")
    ]);
  const app = getApps()[0] || initializeApp({ apiKey: "AIzaSyC4j2aelRB3uEyGmZJbvW0OGNL5-Oi2uvA", authDomain: "autoworks-c9a6a.firebaseapp.com", projectId: "autoworks-c9a6a", appId: "1:823085494995:web:3be4bdd40fe0519bc59a26" });
  const auth = getAuth(app); database = getFirestore(app);
  el.login.addEventListener("click", () => signInWithPopup(auth, new GoogleAuthProvider()).catch(() => message("로그인하지 못했습니다.", "error")));
  loadSignals = async () => {
    const currentUser = user, currentWorkspace = workspaceId, projectId = el.project.value;
    if (!currentUser || !currentWorkspace || !projectId) return;
    try {
      const snapshot = await getDocs(query(collection(database, "workspaces", currentWorkspace, "reports"), where("tool", "==", "brand-search"), orderBy("createdAt", "desc"), limit(50)));
      if (currentUser !== user || currentWorkspace !== workspaceId || projectId !== el.project.value) return;
      const latest = new Map();
      for (const document of snapshot.docs) {
        const report = document.data();
        if (report.projectId !== projectId || !Array.isArray(report.rows)) continue;
        for (const row of report.rows) {
          if (typeof row.keyword !== "string" || !Number.isFinite(row.total) || latest.has(row.keyword.trim())) continue;
          latest.set(row.keyword.trim(), { total: row.total, recordedAt: row.recordedAt });
        }
      }
      topicSignals = [...latest].map(([keyword, signal]) => ({ keyword, ...signal }));
      message(topicSignals.length ? `저장된 최근 월간 검색량 ${topicSignals.length}개를 주제 후보에 연결했습니다.` : "이 프로젝트의 저장된 검색량이 없어 키워드 순서를 사용합니다.");
    } catch { topicSignals = []; message("검색량 신호를 불러오지 못해 프로젝트 키워드 순서를 사용합니다."); }
  };
  onAuthStateChanged(auth, async signedIn => {
    const current = ++generation;
    user = signedIn; workspaceId = null; reports.clear(); requestKey = null; topicSignals = []; show();
    el.login.hidden = Boolean(user); el.project.replaceChildren(new Option(user ? "프로젝트 불러오는 중" : "로그인 후 선택", "")); el.project.disabled = true; update();
    if (!user) return message("로그인 후 프로젝트를 선택해 주세요.");
    try {
      const workspaces = await getDocs(query(collection(database, "workspaces"), where("ownerUid", "==", user.uid), limit(1)));
      if (current !== generation) return;
      if (workspaces.empty) return message("먼저 홈에서 프로젝트를 만들어 주세요.", "error");
      workspaceId = workspaces.docs[0].id;
      const projects = await getDocs(collection(database, "workspaces", workspaceId, "projects"));
      if (current !== generation) return;
      el.project.replaceChildren(new Option("프로젝트 선택", ""));
      for (const item of projects.docs) {
        const option = new Option(item.data().name || "프로젝트", item.id);
        option.dataset.keywords = Array.isArray(item.data().keywords) ? item.data().keywords.join("\n") : "";
        el.project.add(option);
      }
      el.project.disabled = false; update();
      await history(getDocs, collection, query, where, orderBy, limit);
      message(apiBase ? "사실과 채널을 선택해 콘텐츠 묶음을 만드세요." : "서버 배포 전이라 실제 생성은 비활성입니다.");
    } catch { message("계정 정보를 불러오지 못했습니다.", "error"); }
  });
  el.packForm.addEventListener("submit", async event => {
    event.preventDefault();
    const channels = selectedChannels();
    if (!channels.length) return message("제작 채널을 하나 이상 선택해 주세요.", "error");
    const currentUser = user, currentWorkspace = workspaceId;
    el.submit.disabled = true; message("채널별 검토용 콘텐츠를 만들고 있습니다."); requestKey ||= crypto.randomUUID().replaceAll("-", "");
    try {
      const response = await fetch(`${apiBase}/v1/workspaces/${encodeURIComponent(currentWorkspace)}/content-pack-runs`, {
        method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${await currentUser.getIdToken()}` },
        body: JSON.stringify({ projectId: el.project.value, campaign: el.campaign.value.trim(), facts: el.facts.value.trim(), sourceDraft: el.sourceDraft.value.trim(), audience: el.audience.value.trim(), callToAction: el.callToAction.value.trim(), channels, idempotencyKey: requestKey })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) { if (body.error?.code !== "INTERNAL_ERROR") requestKey = null; throw new Error(body.error?.message || "생성에 실패했습니다."); }
      if (currentUser !== user || currentWorkspace !== workspaceId) return;
      show({ ...body, channels }); requestKey = null; message("미게시 상태로 저장했습니다. 사용 전에 검토하세요.", "success");
      await history(getDocs, collection, query, where, orderBy, limit);
    } catch (error) { message(error.message, "error"); }
    finally { update(); }
  });
}

initialize().catch(() => message("화면을 준비하지 못했습니다.", "error"));

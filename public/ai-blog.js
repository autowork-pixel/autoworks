const apiBase = String(window.AUTOWORKS_API_BASE || "").replace(/\/$/, "");
const hosts = new Set(["localhost", "127.0.0.1", "autoworks-c9a6a.web.app", "autoworks-c9a6a.firebaseapp.com"]);
const ids = ["blogForm", "login", "project", "topic", "facts", "keywords", "contentType", "tone", "targetLength", "sourceDraft", "submit", "status", "history", "draft", "meta", "copy", "download"];
const el = Object.fromEntries(ids.map(id => [id, document.getElementById(id)]));
let user = null, workspaceId = null, database, auth, generation = 0, requestGeneration = 0, historyGeneration = 0;
let reports = new Map(), requestKey = null, firestoreHistory = null;

function message(text, type = "") { el.status.textContent = text; el.status.className = `status ${type}`.trim(); }
function keywords() { return el.keywords.value.split(",").map(value => value.trim()).filter(Boolean); }
function update() {
  el.submit.disabled = !navigator.onLine || !apiBase || !user || !workspaceId || !el.project.value;
  const ready = Boolean(el.draft.value); el.copy.disabled = !ready; el.download.disabled = !ready;
}
function show(report) {
  el.draft.value = report?.draft || "";
  el.meta.textContent = report?.draft
    ? `${report.model || "AI 모델"} · 입력 ${report.inputTokens ?? "미집계"} 토큰 · 출력 ${report.outputTokens ?? "미집계"} 토큰 · 게시 전 검토 필요`
    : "자동 게시되지 않습니다.";
  update();
}
function formFingerprint() {
  return JSON.stringify([el.topic.value.trim(), el.facts.value.trim(), keywords(), el.contentType.value,
    el.tone.value, el.targetLength.value, el.sourceDraft.value.trim()]);
}
function requestCurrent(context) {
  return context.generation === requestGeneration && context.user === user && context.workspaceId === workspaceId
    && context.projectId === el.project.value && context.fingerprint === formFingerprint();
}

async function loadHistory(getDocs, collection, query, where, orderBy, limit) {
  const currentHistoryGeneration = ++historyGeneration, currentUser = user, currentWorkspace = workspaceId, projectId = el.project.value;
  reports.clear(); el.history.replaceChildren(new Option(projectId ? "초안 불러오는 중" : "프로젝트 선택 후 불러옵니다.", "")); el.history.disabled = true;
  if (!currentUser || !currentWorkspace || !projectId) return;
  try {
    const snapshot = await getDocs(query(collection(database, "workspaces", currentWorkspace, "reports"),
      where("tool", "==", "ai-blog"), where("projectId", "==", projectId), orderBy("createdAt", "desc"), limit(50)));
    if (currentHistoryGeneration !== historyGeneration || currentUser !== user || currentWorkspace !== workspaceId || projectId !== el.project.value) return;
    reports = new Map(snapshot.docs.filter(doc => typeof doc.data().draft === "string").map(doc => [doc.id, doc.data()]));
    el.history.replaceChildren(new Option(reports.size ? "저장된 초안 선택" : "저장된 초안 없음", ""));
    for (const [id, report] of reports) el.history.add(new Option(report.summary || "AI 블로그 초안", id));
    el.history.disabled = !reports.size;
  } catch {
    if (currentHistoryGeneration === historyGeneration && currentUser === user && currentWorkspace === workspaceId && projectId === el.project.value)
      el.history.replaceChildren(new Option("저장된 초안을 불러오지 못했습니다.", ""));
  }
}

el.history.addEventListener("change", () => show(reports.get(el.history.value)));
el.project.addEventListener("change", () => {
  requestGeneration++; requestKey = null; show(); update();
  if (firestoreHistory) loadHistory(...firestoreHistory);
});
el.blogForm.addEventListener("input", () => { requestGeneration++; requestKey = null; show(); update(); });
el.copy.addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(el.draft.value); message("초안을 복사했습니다.", "success"); }
  catch { message("복사하지 못했습니다.", "error"); }
});
el.download.addEventListener("click", () => {
  const blob = new Blob([el.draft.value], { type: "text/markdown;charset=utf-8" }), url = URL.createObjectURL(blob), link = document.createElement("a");
  link.href = url; link.download = "autoworks-ai-draft.md"; link.click(); URL.revokeObjectURL(url);
});

async function initialize() {
  if (!hosts.has(location.hostname)) { message("배포된 웹에서 로그인할 수 있습니다.", "error"); return; }
  const [{ initializeApp, getApps }, { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged },
    { getFirestore, collection, query, where, orderBy, limit, getDocs }] = await Promise.all([
    import("https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js"),
    import("https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js"),
    import("https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js")
  ]);
  firestoreHistory = [getDocs, collection, query, where, orderBy, limit];
  const app = getApps()[0] || initializeApp({ apiKey: "AIzaSyC4j2aelRB3uEyGmZJbvW0OGNL5-Oi2uvA",
    authDomain: "autoworks-c9a6a.firebaseapp.com", projectId: "autoworks-c9a6a", appId: "1:823085494995:web:3be4bdd40fe0519bc59a26" });
  auth = getAuth(app); database = getFirestore(app);
  el.login.addEventListener("click", () => signInWithPopup(auth, new GoogleAuthProvider()).catch(() => message("로그인하지 못했습니다.", "error")));
  async function renderAccount(signedIn) {
    const current = ++generation; requestGeneration++; historyGeneration++;
    user = signedIn; workspaceId = null; reports.clear(); requestKey = null; show();
    el.login.hidden = Boolean(user); el.project.replaceChildren(new Option(user ? "프로젝트 불러오는 중" : "로그인 후 선택", "")); el.project.disabled = true;
    el.history.replaceChildren(new Option(user ? "초안 불러오는 중" : "로그인 후 불러옵니다.", "")); el.history.disabled = true; update();
    if (!user) return message("로그인 후 프로젝트를 선택해 주세요.");
    try {
      const workspaces = await getDocs(query(collection(database, "workspaces"), where("ownerUid", "==", user.uid), limit(1)));
      if (current !== generation) return;
      if (workspaces.empty) return message("먼저 홈에서 프로젝트를 만들어 주세요.", "error");
      workspaceId = workspaces.docs[0].id;
      const projects = await getDocs(collection(database, "workspaces", workspaceId, "projects"));
      if (current !== generation) return;
      el.project.replaceChildren(new Option("프로젝트 선택", ""));
      for (const item of projects.docs) el.project.add(new Option(item.data().name || "프로젝트", item.id));
      el.project.disabled = false; update();
      await loadHistory(getDocs, collection, query, where, orderBy, limit);
      if (current === generation) message(apiBase ? "사실과 조건을 입력하고 검토용 초안을 만들어 보세요." : "서버 배포 전이라 실제 생성은 비활성입니다.");
    } catch { if (current === generation) message("계정 정보를 불러오지 못했습니다.", "error"); }
  }
  onAuthStateChanged(auth, renderAccount);
  window.addEventListener("pagehide", event => {
    if (!event.persisted) return;
    generation++; requestGeneration++; historyGeneration++; requestKey = null;
  });
  window.addEventListener("pageshow", event => {
    if (event.persisted) renderAccount(auth.currentUser);
  });
  el.blogForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (!navigator.onLine) return message("인터넷 연결을 확인한 뒤 같은 조건으로 다시 시도해 주세요.", "error");
    const context = { generation: ++requestGeneration, user, workspaceId, projectId: el.project.value, fingerprint: formFingerprint() };
    const currentUser = context.user, currentWorkspace = context.workspaceId, selectedProject = context.projectId;
    const list = keywords(), topic = el.topic.value.trim(), facts = el.facts.value.trim(), contentType = el.contentType.value;
    const tone = el.tone.value, targetLength = Number(el.targetLength.value), sourceDraft = el.sourceDraft.value.trim();
    if (!list.length || list.length > 8) return message("키워드는 1~8개여야 합니다.", "error");
    el.submit.disabled = true; message("검토용 초안을 생성하고 있습니다."); requestKey ||= crypto.randomUUID().replaceAll("-", "");
    try {
      const response = await fetch(`${apiBase}/v1/workspaces/${encodeURIComponent(currentWorkspace)}/ai-blog-runs`, {
        method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${await currentUser.getIdToken()}` },
        body: JSON.stringify({ projectId: selectedProject, topic, facts, keywords: list, contentType, tone, targetLength, sourceDraft, idempotencyKey: requestKey })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) { if (body.error?.code !== "INTERNAL_ERROR") requestKey = null; throw new Error(body.error?.message || "초안 생성에 실패했습니다."); }
      if (!requestCurrent(context)) return;
      show(body); requestKey = null; message("초안을 저장했습니다. 게시 전에 반드시 검토하세요.", "success");
      await loadHistory(getDocs, collection, query, where, orderBy, limit);
    } catch (error) { if (requestCurrent(context)) message(error.message, "error"); }
    finally { if (requestCurrent(context)) update(); }
  });
}
window.addEventListener("offline", () => { requestGeneration++; historyGeneration++; update(); message("인터넷 연결이 끊겼습니다. 연결 후 같은 조건으로 다시 시도해 주세요.", "error"); });
window.addEventListener("online", () => { update(); message("인터넷 연결이 복구되었습니다. 같은 조건으로 다시 실행할 수 있습니다."); });
initialize().catch(() => message("화면을 준비하지 못했습니다.", "error"));


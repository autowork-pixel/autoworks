const apiBase = String(window.AUTOWORKS_API_BASE || "").replace(/\/$/, "");
const hosts = new Set(["localhost", "127.0.0.1", "autoworks-c9a6a.web.app", "autoworks-c9a6a.firebaseapp.com"]);
const ids = ["visibilityForm", "login", "project", "brand", "aliases", "domains", "keywords", "resultCount", "submit", "status", "history", "results"];
const el = Object.fromEntries(ids.map(id => [id, document.getElementById(id)]));
let user = null, workspaceId = null, database, generation = 0, requestGeneration = 0, historyGeneration = 0;
let reports = new Map(), requestKey = null, firestoreHistory = null;

document.querySelector(".eyebrow").textContent = "P7 · 공식 검색 API";
const exportCsv = document.createElement("button");
exportCsv.type = "button"; exportCsv.className = "secondary"; exportCsv.textContent = "선택 결과 CSV"; exportCsv.disabled = true;
el.history.after(exportCsv);
function csvCell(value) {
  const text = value == null ? "" : String(value), safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}
el.history.addEventListener("change", () => { exportCsv.disabled = !reports.get(el.history.value); });
exportCsv.addEventListener("click", () => {
  const report = reports.get(el.history.value); if (!report) return;
  const lines = [["키워드", "블로그 순위", "블로그 제목", "블로그 URL", "웹문서 순위", "웹문서 제목", "웹문서 URL"].map(csvCell).join(","),
    ...report.rows.map(row => [row.keyword, row.blog?.rank, row.blog?.title, row.blog?.url, row.web?.rank, row.web?.title, row.web?.url].map(csvCell).join(","))];
  const url = URL.createObjectURL(new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" })), link = document.createElement("a");
  link.href = url; link.download = "naver-visibility.csv"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 0);
});
function message(value, type = "") { el.status.textContent = value; el.status.className = `status ${type}`.trim(); }
function list(id) { return el[id].value.split(",").map(value => value.trim()).filter(Boolean); }
function update() { el.submit.disabled = !navigator.onLine || !apiBase || !user || !workspaceId || !el.project.value; }
function safeLink(value) {
  try { const url = new URL(value); return url.protocol === "https:" || url.protocol === "http:" ? url.href : null; }
  catch { return null; }
}
function render(rows = []) {
  el.results.replaceChildren();
  if (!rows.length) { el.results.innerHTML = '<p class="empty">아직 저장된 점검 결과가 없습니다.</p>'; return; }
  const table = document.createElement("table"); table.className = "table";
  table.innerHTML = "<thead><tr><th>키워드</th><th>블로그 API</th><th>웹문서 API</th></tr></thead>";
  const body = document.createElement("tbody");
  for (const row of rows) {
    const tableRow = document.createElement("tr"), keyword = document.createElement("td"); keyword.textContent = row.keyword; tableRow.append(keyword);
    for (const result of [row.blog, row.web]) {
      const cell = document.createElement("td");
      if (result?.rank) {
        cell.append(document.createTextNode(`${result.rank}위 · `));
        const href = safeLink(result.url), link = document.createElement("a"); link.textContent = result.title || "결과 열기";
        if (href) { link.href = href; link.target = "_blank"; link.rel = "noopener noreferrer"; }
        cell.append(link);
      } else cell.textContent = "확인 범위 내 미노출";
      tableRow.append(cell);
    }
    body.append(tableRow);
  }
  table.append(body); el.results.append(table);
}
function formFingerprint() {
  return JSON.stringify([el.brand.value.trim(), list("aliases"), list("domains"), list("keywords"), el.resultCount.value]);
}
function requestCurrent(context) {
  return context.generation === requestGeneration && context.user === user && context.workspaceId === workspaceId
    && context.projectId === el.project.value && context.fingerprint === formFingerprint();
}
async function loadHistory(getDocs, collection, query, where, orderBy, limit) {
  const currentHistoryGeneration = ++historyGeneration, currentUser = user, currentWorkspace = workspaceId, projectId = el.project.value;
  reports.clear(); el.history.replaceChildren(new Option(projectId ? "결과 불러오는 중" : "프로젝트 선택 후 불러옵니다.", ""));
  el.history.disabled = true; exportCsv.disabled = true;
  if (!currentUser || !currentWorkspace || !projectId) return;
  try {
    const snapshot = await getDocs(query(collection(database, "workspaces", currentWorkspace, "reports"),
      where("tool", "==", "naver-visibility"), where("projectId", "==", projectId), orderBy("createdAt", "desc"), limit(50)));
    if (currentHistoryGeneration !== historyGeneration || currentUser !== user || currentWorkspace !== workspaceId || projectId !== el.project.value) return;
    reports = new Map(snapshot.docs.filter(doc => Array.isArray(doc.data().rows)).map(doc => [doc.id, doc.data()]));
    el.history.replaceChildren(new Option(reports.size ? "저장된 결과 선택" : "저장된 결과 없음", ""));
    for (const [id, report] of reports) el.history.add(new Option(report.summary || "네이버 검색 노출 점검", id));
    el.history.disabled = !reports.size;
  } catch {
    if (currentHistoryGeneration === historyGeneration && currentUser === user && currentWorkspace === workspaceId && projectId === el.project.value)
      el.history.replaceChildren(new Option("저장된 결과를 불러오지 못했습니다.", ""));
  }
}
el.history.addEventListener("change", () => { const report = reports.get(el.history.value); if (report) render(report.rows); });
el.project.addEventListener("change", () => {
  requestGeneration++; requestKey = null; render(); update();
  if (firestoreHistory) loadHistory(...firestoreHistory);
});
el.visibilityForm.addEventListener("input", () => { requestGeneration++; requestKey = null; render(); update(); });

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
  const auth = getAuth(app); database = getFirestore(app);
  el.login.addEventListener("click", () => signInWithPopup(auth, new GoogleAuthProvider()).catch(() => message("로그인하지 못했습니다.", "error")));
  async function renderAccount(signedIn) {
    const current = ++generation; requestGeneration++; historyGeneration++;
    user = signedIn; workspaceId = null; reports.clear(); requestKey = null; render();
    el.login.hidden = Boolean(user); el.project.replaceChildren(new Option(user ? "프로젝트 불러오는 중" : "로그인 후 선택", ""));
    el.project.disabled = true; update();
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
      if (current === generation) message(apiBase ? "조건을 입력하고 공식 API 결과를 점검하세요." : "서버 배포 전이라 실제 점검은 비활성입니다.");
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
  el.visibilityForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (!navigator.onLine) return message("인터넷 연결을 확인한 뒤 같은 조건으로 다시 시도해 주세요.", "error");
    const keywordValues = list("keywords"), aliases = list("aliases"), officialDomains = list("domains");
    if (!keywordValues.length || keywordValues.length > 10 || aliases.length > 5 || !officialDomains.length || officialDomains.length > 5)
      return message("키워드 1~10개, 별칭 0~5개, 도메인 1~5개를 확인해 주세요.", "error");
    const context = { generation: ++requestGeneration, user, workspaceId, projectId: el.project.value, fingerprint: formFingerprint() };
    const currentUser = context.user, currentWorkspace = context.workspaceId, selectedProject = context.projectId;
    const brand = el.brand.value.trim(), resultCount = Number(el.resultCount.value);
    el.submit.disabled = true; message("네이버 공식 검색 API를 조회하고 있습니다."); requestKey ||= crypto.randomUUID().replaceAll("-", "");
    try {
      const response = await fetch(`${apiBase}/v1/workspaces/${encodeURIComponent(currentWorkspace)}/naver-visibility-runs`, {
        method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${await currentUser.getIdToken()}` },
        body: JSON.stringify({ projectId: selectedProject, brand, aliases, officialDomains, keywords: keywordValues, resultCount, idempotencyKey: requestKey })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) { if (body.error?.code !== "INTERNAL_ERROR") requestKey = null; throw new Error(body.error?.message || "점검에 실패했습니다."); }
      if (!requestCurrent(context)) return;
      render(body.rows); requestKey = null; message(`${body.rows?.length || 0}개 키워드 결과를 저장했습니다. 통합검색 순위가 아닙니다.`, "success");
      await loadHistory(getDocs, collection, query, where, orderBy, limit);
    } catch (error) { if (requestCurrent(context)) message(error.message, "error"); }
    finally { if (requestCurrent(context)) update(); }
  });
}
window.addEventListener("offline", () => { requestGeneration++; historyGeneration++; update(); message("인터넷 연결이 끊겼습니다. 연결 후 같은 조건으로 다시 시도해 주세요.", "error"); });
window.addEventListener("online", () => { update(); message("인터넷 연결이 복구되었습니다. 같은 조건으로 다시 실행할 수 있습니다."); });
initialize().catch(() => message("화면을 준비하지 못했습니다.", "error"));


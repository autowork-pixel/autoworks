const apiBase = String(window.AUTOWORKS_API_BASE || "").replace(/\/$/, "");
const hosts = new Set(["localhost", "127.0.0.1", "autoworks-c9a6a.web.app", "autoworks-c9a6a.firebaseapp.com"]);
const ids = ["referenceForm", "login", "project", "brand", "category", "keywords", "target", "strengths", "periodDays", "collectCount", "submit", "status", "history", "results", "downloadCsv", "downloadJson", "resultMeta"];
const el = Object.fromEntries(ids.map(id => [id, document.getElementById(id)]));
let user = null, workspaceId = null, database, auth, generation = 0, reports = new Map(), requestKey = null, reloadHistory = async () => {};
let currentRows = [], currentTitle = "화제 콘텐츠 레퍼런스";

function message(text, type = "") {
  el.status.textContent = text;
  el.status.className = `status ${type}`.trim();
}
function values(id) {
  return el[id].value.split(",").map(value => value.trim()).filter(Boolean);
}
function update() {
  el.submit.disabled = !apiBase || !user || !workspaceId || !el.project.value;
}
function date(value) {
  const seconds = value?._seconds ?? value?.seconds;
  if (Number.isFinite(seconds)) return new Date(seconds * 1000).toLocaleString("ko-KR");
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "날짜 없음" : parsed.toLocaleString("ko-KR");
}
function safeCell(value) {
  const text = value == null ? "" : String(value);
  const protectedText = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${protectedText.replaceAll('"', '""')}"`;
}
function fileName(extension) {
  return `content-reference-${new Date().toISOString().slice(0, 10)}.${extension}`;
}
function download(content, type, name) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
function setExportState(rows, capturedAt) {
  currentRows = Array.isArray(rows) ? rows : [];
  const firstCapturedAt = capturedAt || currentRows.find(row => row?.capturedAt)?.capturedAt;
  el.downloadCsv.disabled = !currentRows.length;
  el.downloadJson.disabled = !currentRows.length;
  el.resultMeta.textContent = currentRows.length
    ? `${currentTitle} · ${currentRows.length}개 · 수집 ${date(firstCapturedAt)} · 출처 YouTube 공개 API`
    : "저장된 결과를 선택하면 수집 시각과 출처를 확인할 수 있습니다.";
}
function render(rows = [], capturedAt) {
  el.results.replaceChildren();
  setExportState(rows, capturedAt);
  if (!rows.length) {
    el.results.innerHTML = '<p class="empty">아직 수집한 레퍼런스가 없습니다.</p>';
    return;
  }
  for (const row of rows) {
    if (!/^https:\/\/www\.youtube\.com\/watch\?v=[A-Za-z0-9_-]{11}$/.test(row.sourceUrl || "")) continue;
    const link = document.createElement("a");
    link.className = "item";
    link.href = row.sourceUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    const image = document.createElement("img");
    if (/^https:\/\/i\.ytimg\.com\//.test(row.thumbnailUrl || "")) image.src = row.thumbnailUrl;
    image.alt = "";
    image.loading = "lazy";
    const copy = document.createElement("div"), title = document.createElement("b"), meta = document.createElement("span"), metrics = document.createElement("span");
    title.textContent = row.title || "제목 없음";
    meta.textContent = `${row.channelTitle || "채널 정보 없음"} · 게시 ${date(row.publishedAt)} · 수집 ${date(row.capturedAt || capturedAt)}`;
    metrics.textContent = `조회 ${row.viewCount == null ? "미제공" : Number(row.viewCount).toLocaleString()} · 좋아요 ${row.likeCount == null ? "미제공" : Number(row.likeCount).toLocaleString()} · 댓글 ${row.commentCount == null ? "미제공" : Number(row.commentCount).toLocaleString()} · 참여율 ${row.engagementRate == null ? "계산 불가" : `${row.engagementRate}%`}`;
    copy.append(title, meta, metrics);
    link.append(image, copy);
    el.results.append(link);
  }
}
async function loadHistory(getDocs, collection, query, where, orderBy, limit) {
  const currentUser = user, currentWorkspace = workspaceId, projectId = el.project.value;
  reports.clear(); el.history.replaceChildren(new Option(projectId ? "결과 불러오는 중" : "프로젝트 선택 후 불러옵니다.", "")); el.history.disabled = true;
  if (!currentUser || !currentWorkspace || !projectId) return;
  const snapshot = await getDocs(query(collection(database, "workspaces", currentWorkspace, "reports"), where("tool", "==", "content-reference"), where("projectId", "==", projectId), orderBy("createdAt", "desc"), limit(50)));
  if (currentUser !== user || currentWorkspace !== workspaceId || projectId !== el.project.value) return;
  reports = new Map(snapshot.docs.filter(doc => Array.isArray(doc.data().rows)).map(doc => [doc.id, doc.data()]));
  el.history.replaceChildren(new Option(reports.size ? "저장된 결과 선택" : "저장된 결과 없음", ""));
  for (const [id, report] of reports) el.history.add(new Option(`${report.query || "검색"} · ${report.rows.length}개 · ${date(report.capturedAt || report.createdAt)}`, id));
  el.history.disabled = !reports.size;
}

el.history.addEventListener("change", () => {
  const report = reports.get(el.history.value);
  if (!report) return render();
  currentTitle = report.query || "화제 콘텐츠 레퍼런스";
  render(report.rows, report.capturedAt || report.createdAt);
});
el.downloadCsv.addEventListener("click", () => {
  if (!currentRows.length) return;
  const headers = ["제목", "채널", "게시 시각", "수집 시각", "조회수", "좋아요", "댓글", "참여율", "원본 URL"];
  const lines = [headers.map(safeCell).join(","), ...currentRows.map(row => [
    row.title, row.channelTitle, date(row.publishedAt), date(row.capturedAt),
    row.viewCount, row.likeCount, row.commentCount, row.engagementRate, row.sourceUrl
  ].map(safeCell).join(","))];
  download("\uFEFF" + lines.join("\r\n"), "text/csv;charset=utf-8", fileName("csv"));
});
el.downloadJson.addEventListener("click", () => {
  if (!currentRows.length) return;
  download(JSON.stringify({ title: currentTitle, source: "YouTube public API", exportedAt: new Date().toISOString(), rows: currentRows }, null, 2), "application/json;charset=utf-8", fileName("json"));
});
el.project.addEventListener("change", () => {
  requestKey = null; render(); reloadHistory().catch(() => message("저장된 결과를 불러오지 못했습니다.", "error"));
  update();
});
el.referenceForm.addEventListener("input", event => {
  if (event.target !== el.submit) requestKey = null;
});

async function initialize() {
  if (!hosts.has(location.hostname)) return message("배포된 웹에서 로그인할 수 있습니다.", "error");
  const [{ initializeApp, getApps }, { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged }, { getFirestore, collection, query, where, orderBy, limit, getDocs }] = await Promise.all([
    import("https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js"),
    import("https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js"),
    import("https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js")
  ]);
  const app = getApps()[0] || initializeApp({ apiKey: "AIzaSyC4j2aelRB3uEyGmZJbvW0OGNL5-Oi2uvA", authDomain: "autoworks-c9a6a.firebaseapp.com", projectId: "autoworks-c9a6a", appId: "1:823085494995:web:3be4bdd40fe0519bc59a26" });
  auth = getAuth(app);
  database = getFirestore(app);
  reloadHistory = () => loadHistory(getDocs, collection, query, where, orderBy, limit);
  el.login.addEventListener("click", () => signInWithPopup(auth, new GoogleAuthProvider()).catch(() => message("로그인하지 못했습니다.", "error")));
  onAuthStateChanged(auth, async signedIn => {
    const current = ++generation;
    user = signedIn;
    workspaceId = null;
    reports.clear();
    requestKey = null;
    currentTitle = "화제 콘텐츠 레퍼런스";
    render();
    el.login.hidden = Boolean(user);
    el.project.replaceChildren(new Option(user ? "프로젝트 불러오는 중" : "로그인 후 선택", ""));
    el.project.disabled = true;
    el.history.replaceChildren(new Option(user ? "결과 불러오는 중" : "로그인 후 불러옵니다.", ""));
    el.history.disabled = true;
    update();
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
      el.project.disabled = false;
      update();
      await reloadHistory();
      message(apiBase ? "조건을 입력하고 레퍼런스를 찾아보세요." : "서버 배포 전이라 실제 검색은 비활성입니다.");
    } catch {
      if (current === generation) message("계정 정보를 불러오지 못했습니다. 잠시 후 새로고침해 주세요.", "error");
    }
  });
  el.referenceForm.addEventListener("submit", async event => {
    event.preventDefault();
    const currentUser = user, currentWorkspace = workspaceId, selectedProject = el.project.value, keywords = values("keywords"), strengths = values("strengths");
    if (!keywords.length || keywords.length > 5 || strengths.length > 5) return message("키워드와 강점은 각각 최대 5개입니다.", "error");
    el.submit.disabled = true;
    message("YouTube 공개 콘텐츠를 수집하고 있습니다.");
    requestKey ||= crypto.randomUUID().replaceAll("-", "");
    try {
      const response = await fetch(`${apiBase}/v1/workspaces/${encodeURIComponent(currentWorkspace)}/content-reference-runs`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${await currentUser.getIdToken()}` },
        body: JSON.stringify({ projectId: selectedProject, brand: el.brand.value.trim(), category: el.category.value.trim(), keywords, target: el.target.value.trim(), strengths, periodDays: Number(el.periodDays.value), collectCount: Number(el.collectCount.value), idempotencyKey: requestKey })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (body.error?.code !== "INTERNAL_ERROR") requestKey = null;
        throw new Error(body.error?.message || "수집에 실패했습니다. 입력을 유지했으니 같은 조건으로 다시 시도해 주세요.");
      }
      if (currentUser !== user || currentWorkspace !== workspaceId || selectedProject !== el.project.value) return;
      currentTitle = `${el.brand.value.trim()} · ${el.category.value.trim()}`;
      render(body.rows, body.capturedAt);
      requestKey = null;
      message(`${body.rows?.length || 0}개 레퍼런스를 저장했습니다.`, "success");
      await reloadHistory();
    } catch (error) {
      if (currentUser === user && currentWorkspace === workspaceId) message(error.message, "error");
    } finally {
      update();
    }
  });
}
initialize().catch(() => message("화면을 준비하지 못했습니다. 새로고침 후 다시 시도해 주세요.", "error"));

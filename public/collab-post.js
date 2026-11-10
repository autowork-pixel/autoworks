const apiBase = String(window.AUTOWORKS_API_BASE || "").replace(/\/$/, "");
const hosts = new Set(["localhost", "127.0.0.1", "autoworks-c9a6a.web.app", "autoworks-c9a6a.firebaseapp.com"]);
const project = document.getElementById("project"), history = document.getElementById("history");
const lookup = document.getElementById("lookup"), lookupStatus = document.getElementById("lookupStatus");
const accountStatus = document.getElementById("accountStatus"), postUrl = document.getElementById("postUrl");
const platform = document.getElementById("platform"), credentialGuide = document.getElementById("credentialGuide");
const addCompare = document.getElementById("addCompare"), downloadCurrent = document.getElementById("downloadCurrent");
const downloadCompare = document.getElementById("downloadCompare"), clearCompare = document.getElementById("clearCompare");
const compareBody = document.getElementById("compareBody"), compareCount = document.getElementById("compareCount");
let user = null, workspaceId = null, database, auth, generation = 0, lookupGeneration = 0, historyGeneration = 0, reportById = new Map(), requestKey = null, reloadHistory = async () => {};
let currentPost = null, comparePosts = [];
const displayCount = value => value == null ? "미제공" : Number(value).toLocaleString("ko-KR");
function updateAvailability() { lookup.disabled = !apiBase || !user || !workspaceId || !project.value || !postUrl.value.trim(); }
function lookupCurrent(context) {
  return context.generation === lookupGeneration && context.user === user && context.workspaceId === workspaceId
    && context.projectId === project.value && context.platform === platform.value && context.url === postUrl.value.trim();
}
function safeCell(value) {
  const text = value == null ? "" : String(value), protectedText = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${protectedText.replaceAll('"', '""')}"`;
}
function download(content, type, name) {
  const url = URL.createObjectURL(new Blob([content], { type })), link = document.createElement("a");
  link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 0);
}
function clearResult() {
  currentPost = null; addCompare.disabled = true; downloadCurrent.disabled = true;
  document.getElementById("result").hidden = true;
}
function showResult(post) {
  const valid = post?.platform === "YouTube"
    ? /^https:\/\/www\.youtube\.com\/watch\?v=[A-Za-z0-9_-]{11}$/.test(post.url || "")
    : post?.platform === "Instagram" && /^https:\/\/www\.instagram\.com\/(p|reel)\/[A-Za-z0-9_-]{4,64}\/$/.test(post.url || "");
  if (!valid) return;
  document.getElementById("title").textContent = post.title || "제목 미제공";
  document.getElementById("captured").textContent = `${post.platform} · 조회 시각 ${new Date(post.capturedAt).toLocaleString("ko-KR")}`;
  for (const key of ["views", "likes", "comments"]) document.getElementById(key).textContent = displayCount(post[key]);
  document.getElementById("postLink").href = post.url;
  document.getElementById("postLink").textContent = `${post.platform} 게시물 열기 ↗`;
  currentPost = post; addCompare.disabled = false; downloadCurrent.disabled = false;
  document.getElementById("result").hidden = false;
}
function renderComparison() {
  compareBody.replaceChildren();
  compareCount.textContent = `${comparePosts.length}/4`;
  downloadCompare.disabled = !comparePosts.length; clearCompare.disabled = !comparePosts.length;
  if (!comparePosts.length) {
    const row = compareBody.insertRow(), cell = row.insertCell();
    cell.colSpan = 5; cell.textContent = "비교할 결과를 추가해 주세요.";
    return;
  }
  for (const post of comparePosts) {
    const row = compareBody.insertRow();
    const values = [`${post.platform} · ${post.title || "제목 미제공"}`, displayCount(post.views), displayCount(post.likes), displayCount(post.comments), new Date(post.capturedAt).toLocaleString("ko-KR")];
    values.forEach(value => { const cell = row.insertCell(); cell.textContent = value; });
  }
}
postUrl.addEventListener("input", () => { lookupGeneration++; requestKey = null; clearResult(); updateAvailability(); });
project.addEventListener("change", () => {
  lookupGeneration++; requestKey = null; reportById.clear(); comparePosts = []; renderComparison(); clearResult(); updateAvailability();
  const requestHistoryGeneration = historyGeneration + 1, selectedProject = project.value, currentUser = user, currentWorkspace = workspaceId;
  reloadHistory().catch(() => {
    if (requestHistoryGeneration === historyGeneration && currentUser === user && currentWorkspace === workspaceId && selectedProject === project.value)
      history.replaceChildren(new Option("저장된 결과를 불러오지 못했습니다.", ""));
  });
});
platform.addEventListener("change", () => {
  lookupGeneration++; requestKey = null; postUrl.value = ""; clearResult();
  const instagram = platform.value === "instagram";
  document.getElementById("urlLabel").textContent = instagram ? "게시물 또는 릴스 URL" : "영상 또는 Shorts URL";
  postUrl.placeholder = instagram ? "https://www.instagram.com/reel/.../" : "https://www.youtube.com/watch?v=...";
  credentialGuide.textContent = instagram ? "Apify API 토큰 연결 방법 →" : "YouTube API 키 연결 방법 →";
  lookupStatus.textContent = apiBase ? `${instagram ? "Instagram" : "YouTube"} URL을 입력해 주세요.` : "서버 연결 전에는 실제 조회할 수 없습니다.";
  updateAvailability();
});
history.addEventListener("change", () => { const report = reportById.get(history.value); if (report) showResult(report.post); });
addCompare.addEventListener("click", () => {
  if (!currentPost) return;
  if (comparePosts.some(post => post.url === currentPost.url && post.capturedAt === currentPost.capturedAt)) {
    lookupStatus.textContent = "이미 비교함에 있는 결과입니다."; return;
  }
  if (comparePosts.length >= 4) { lookupStatus.textContent = "비교함에는 최대 4개까지 추가할 수 있습니다."; return; }
  comparePosts.push(currentPost); renderComparison();
});
downloadCurrent.addEventListener("click", () => {
  if (!currentPost) return;
  download(JSON.stringify({ exportedAt: new Date().toISOString(), post: currentPost }, null, 2), "application/json;charset=utf-8", `collab-post-${new Date().toISOString().slice(0, 10)}.json`);
});
downloadCompare.addEventListener("click", () => {
  if (!comparePosts.length) return;
  const headers = ["플랫폼", "제목", "URL", "조회수", "좋아요", "댓글", "조회 시각"];
  const lines = [headers.map(safeCell).join(","), ...comparePosts.map(post => [post.platform, post.title, post.url, post.views, post.likes, post.comments, post.capturedAt].map(safeCell).join(","))];
  download("\uFEFF" + lines.join("\r\n"), "text/csv;charset=utf-8", `collab-compare-${new Date().toISOString().slice(0, 10)}.csv`);
});
clearCompare.addEventListener("click", () => { comparePosts = []; renderComparison(); });

async function loadHistory(getDocs, collection, query, where, orderBy, limit) {
  const requestHistoryGeneration = ++historyGeneration, currentUser = user, currentWorkspace = workspaceId, projectId = project.value;
  reportById.clear(); history.replaceChildren(new Option(projectId ? "결과 불러오는 중" : "프로젝트 선택 후 결과 조회", "")); history.disabled = true;
  if (!currentUser || !currentWorkspace || !projectId) return;
  const snapshot = await getDocs(query(collection(database, "workspaces", currentWorkspace, "reports"), where("tool", "==", "collab-post"), where("projectId", "==", projectId), orderBy("createdAt", "desc"), limit(50)));
  if (requestHistoryGeneration !== historyGeneration || currentUser !== user || currentWorkspace !== workspaceId || projectId !== project.value) return;
  reportById = new Map(snapshot.docs.filter(doc => ["YouTube", "Instagram"].includes(doc.data().post?.platform))
    .map(doc => [doc.id, doc.data()]));
  history.replaceChildren(new Option(reportById.size ? "저장된 결과 선택" : "저장된 조회 결과 없음", ""));
  for (const [id, report] of reportById) history.add(new Option(`${report.post.platform} · ${report.post.title || "제목 미제공"} · ${displayCount(report.post.views)}회`, id));
  history.disabled = reportById.size === 0;
}

async function initialize() {
  if (!hosts.has(location.hostname)) { accountStatus.textContent = "배포된 웹에서 로그인할 수 있습니다."; return; }
  const [{ initializeApp, getApps }, { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged },
    { getFirestore, collection, query, where, orderBy, limit, getDocs }] = await Promise.all([
    import("https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js"),
    import("https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js"),
    import("https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js")
  ]);
  const app = getApps()[0] || initializeApp({ apiKey: "AIzaSyC4j2aelRB3uEyGmZJbvW0OGNL5-Oi2uvA",
    authDomain: "autoworks-c9a6a.firebaseapp.com", projectId: "autoworks-c9a6a",
    appId: "1:823085494995:web:3be4bdd40fe0519bc59a26" });
  auth = getAuth(app); database = getFirestore(app);
  reloadHistory = () => loadHistory(getDocs, collection, query, where, orderBy, limit);
  document.getElementById("login").addEventListener("click", () => signInWithPopup(auth, new GoogleAuthProvider())
    .catch(() => { accountStatus.textContent = "로그인하지 못했습니다."; }));
  onAuthStateChanged(auth, async signedIn => {
    const current = ++generation;
    lookupGeneration++; historyGeneration++; user = signedIn; workspaceId = null; requestKey = null; reportById.clear(); comparePosts = []; renderComparison(); clearResult();
    document.getElementById("login").hidden = Boolean(user);
    project.replaceChildren(new Option(user ? "프로젝트 불러오는 중" : "로그인 후 프로젝트 선택", "")); project.disabled = true;
    history.replaceChildren(new Option(user ? "저장된 결과 불러오는 중" : "로그인 후 결과 조회", "")); history.disabled = true;
    accountStatus.textContent = user ? "프로젝트를 확인하고 있습니다." : "로그인 후 프로젝트를 선택해 주세요.";
    updateAvailability();
    if (!user) return;
    try {
      const workspaces = await getDocs(query(collection(database, "workspaces"), where("ownerUid", "==", user.uid), limit(1)));
      if (current !== generation) return;
      if (workspaces.empty) { accountStatus.textContent = "먼저 홈에서 프로젝트를 만들어 주세요."; return; }
      workspaceId = workspaces.docs[0].id;
      const projects = await getDocs(collection(database, "workspaces", workspaceId, "projects"));
      if (current !== generation) return;
      project.replaceChildren(new Option("조회할 프로젝트 선택", ""));
      for (const item of projects.docs) project.add(new Option(item.data().name || "프로젝트", item.id));
      project.disabled = false; accountStatus.textContent = "프로젝트를 선택해 주세요.";
      updateAvailability();
      await reloadHistory();
    } catch { if (current === generation) accountStatus.textContent = "계정 정보를 불러오지 못했습니다."; }
  });
  lookup.addEventListener("click", async () => {
    if (lookup.disabled) return;
    const context = { generation: ++lookupGeneration, user, workspaceId, projectId: project.value, platform: platform.value, url: postUrl.value.trim() };
    const currentUser = context.user, currentWorkspace = context.workspaceId, selectedProject = context.projectId;
    const selectedPlatform = context.platform;
    lookup.disabled = true; lookupStatus.textContent = `${selectedPlatform === "instagram" ? "Instagram" : "YouTube"} 공개 지표를 조회하고 있습니다.`;
    requestKey ||= crypto.randomUUID().replaceAll("-", "");
    try {
      const response = await fetch(`${apiBase}/v1/workspaces/${encodeURIComponent(currentWorkspace)}/collab-${selectedPlatform}-runs`, {
        method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${await currentUser.getIdToken()}` },
        body: JSON.stringify({ projectId: selectedProject, url: context.url, idempotencyKey: requestKey })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (body.error?.code && body.error.code !== "INTERNAL_ERROR") requestKey = null;
        throw new Error(body.error?.message || "조회에 실패했습니다.");
      }
      if (!lookupCurrent(context)) return;
      if (body.post) { showResult(body.post); lookupStatus.textContent = "조회 결과를 내 계정에 저장했습니다."; }
      else lookupStatus.textContent = body.status === "running" ? "같은 요청이 진행 중입니다. 잠시 후 저장된 결과를 확인해 주세요." : "저장된 결과를 다시 확인해 주세요.";
      if (body.status !== "running") requestKey = null;
      await reloadHistory().catch(() => { if (lookupCurrent(context)) lookupStatus.textContent += " 목록은 새로고침 후 확인할 수 있습니다."; });
    } catch (error) { if (lookupCurrent(context)) lookupStatus.textContent = error.message; }
    finally { if (lookupCurrent(context)) updateAvailability(); }
  });
  lookupStatus.textContent = apiBase ? "프로젝트와 YouTube URL을 입력해 주세요." : "서버 연결 전에는 실제 조회할 수 없습니다.";
}
renderComparison();
initialize().catch(() => { accountStatus.textContent = "계정 화면을 준비하지 못했습니다."; });

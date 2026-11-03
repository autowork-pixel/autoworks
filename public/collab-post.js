const apiBase = String(window.AUTOWORKS_API_BASE || "").replace(/\/$/, "");
const hosts = new Set(["localhost", "127.0.0.1", "autoworks-c9a6a.web.app", "autoworks-c9a6a.firebaseapp.com"]);
const project = document.getElementById("project"), history = document.getElementById("history");
const lookup = document.getElementById("lookup"), lookupStatus = document.getElementById("lookupStatus");
const accountStatus = document.getElementById("accountStatus"), postUrl = document.getElementById("postUrl");
const platform = document.getElementById("platform"), credentialGuide = document.getElementById("credentialGuide");
let user = null, workspaceId = null, database, auth, generation = 0, reportById = new Map(), requestKey = null;
const displayCount = value => value == null ? "미제공" : Number(value).toLocaleString("ko-KR");
function updateAvailability() { lookup.disabled = !apiBase || !user || !workspaceId || !project.value || !postUrl.value.trim(); }
function clearResult() { document.getElementById("result").hidden = true; }
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
  document.getElementById("result").hidden = false;
}
postUrl.addEventListener("input", () => { requestKey = null; updateAvailability(); });
project.addEventListener("change", () => { requestKey = null; updateAvailability(); });
platform.addEventListener("change", () => {
  requestKey = null; postUrl.value = ""; clearResult();
  const instagram = platform.value === "instagram";
  document.getElementById("urlLabel").textContent = instagram ? "게시물 또는 릴스 URL" : "영상 또는 Shorts URL";
  postUrl.placeholder = instagram ? "https://www.instagram.com/reel/.../" : "https://www.youtube.com/watch?v=...";
  credentialGuide.textContent = instagram ? "Apify API 토큰 연결 방법 →" : "YouTube API 키 연결 방법 →";
  lookupStatus.textContent = apiBase ? `${instagram ? "Instagram" : "YouTube"} URL을 입력해 주세요.` : "서버 연결 전에는 실제 조회할 수 없습니다.";
  updateAvailability();
});
history.addEventListener("change", () => { const report = reportById.get(history.value); if (report) showResult(report.post); });

async function loadHistory(getDocs, collection, query, orderBy, limit) {
  const currentUser = user, currentWorkspace = workspaceId;
  const snapshot = await getDocs(query(collection(database, "workspaces", currentWorkspace, "reports"), orderBy("createdAt", "desc"), limit(50)));
  if (currentUser !== user || currentWorkspace !== workspaceId) return;
  reportById = new Map(snapshot.docs.filter(doc => doc.data().tool === "collab-post" && ["YouTube", "Instagram"].includes(doc.data().post?.platform))
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
  const app = getApps()[0] || initializeApp({ apiKey: "AIzaSyBHcgYeZM8-n_PPSLbsazSfGx32BMDnB2M",
    authDomain: "autoworks-c9a6a.firebaseapp.com", projectId: "autoworks-c9a6a",
    appId: "1:576193408775:web:fae402ea7b94045d21ba1f" });
  auth = getAuth(app); database = getFirestore(app);
  document.getElementById("login").addEventListener("click", () => signInWithPopup(auth, new GoogleAuthProvider())
    .catch(() => { accountStatus.textContent = "로그인하지 못했습니다."; }));
  onAuthStateChanged(auth, async signedIn => {
    const current = ++generation;
    user = signedIn; workspaceId = null; requestKey = null; reportById.clear(); clearResult();
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
      await loadHistory(getDocs, collection, query, orderBy, limit);
    } catch { if (current === generation) accountStatus.textContent = "계정 정보를 불러오지 못했습니다."; }
  });
  lookup.addEventListener("click", async () => {
    if (lookup.disabled) return;
    const currentUser = user, currentWorkspace = workspaceId, selectedProject = project.value;
    const selectedPlatform = platform.value;
    lookup.disabled = true; lookupStatus.textContent = `${selectedPlatform === "instagram" ? "Instagram" : "YouTube"} 공개 지표를 조회하고 있습니다.`;
    requestKey ||= crypto.randomUUID().replaceAll("-", "");
    try {
      const response = await fetch(`${apiBase}/v1/workspaces/${encodeURIComponent(currentWorkspace)}/collab-${selectedPlatform}-runs`, {
        method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${await currentUser.getIdToken()}` },
        body: JSON.stringify({ projectId: selectedProject, url: postUrl.value.trim(), idempotencyKey: requestKey })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (body.error?.code && body.error.code !== "INTERNAL_ERROR") requestKey = null;
        throw new Error(body.error?.message || "조회에 실패했습니다.");
      }
      if (currentUser !== user || currentWorkspace !== workspaceId || selectedPlatform !== platform.value) return;
      if (body.post) { showResult(body.post); lookupStatus.textContent = "조회 결과를 내 계정에 저장했습니다."; }
      else lookupStatus.textContent = body.status === "running" ? "같은 요청이 진행 중입니다. 잠시 후 저장된 결과를 확인해 주세요." : "저장된 결과를 다시 확인해 주세요.";
      if (body.status !== "running") requestKey = null;
      await loadHistory(getDocs, collection, query, orderBy, limit).catch(() => { lookupStatus.textContent += " 목록은 새로고침 후 확인할 수 있습니다."; });
    } catch (error) { if (currentUser === user && currentWorkspace === workspaceId) lookupStatus.textContent = error.message; }
    finally { updateAvailability(); }
  });
  lookupStatus.textContent = apiBase ? "프로젝트와 YouTube URL을 입력해 주세요." : "서버 연결 전에는 실제 조회할 수 없습니다.";
}
initialize().catch(() => { accountStatus.textContent = "계정 화면을 준비하지 못했습니다."; });

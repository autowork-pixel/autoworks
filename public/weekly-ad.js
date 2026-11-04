const aliases = {
  campaign: ["캠페인", "캠페인명"], group: ["광고그룹", "광고그룹명"], keyword: ["검색어", "키워드"],
  impr: ["노출수", "노출"], click: ["클릭수", "클릭"], cost: ["총비용", "광고비", "비용"],
  conv: ["총 전환수", "전환수", "구매완료 전환수"],
  revenue: ["총 전환매출액(원)", "전환매출액", "매출액", "구매완료 전환매출액(원)"]
};
const normalize = value => String(value ?? "").replace(/\s+/g, "").toLowerCase();
const number = value => Number(String(value ?? "").replaceAll(",", "").replaceAll("%", "").trim()) || 0;
const integer = value => Math.round(value).toLocaleString("ko-KR");
const money = value => `${integer(value)}원`;
const percent = value => `${value.toFixed(1)}%`;
const apiBase = String(window.AUTOWORKS_API_BASE || "").replace(/\/$/, "");
const accountState = { user: null, workspaceId: null };
const account = document.createElement("div"), loginButton = document.createElement("button"), projectSelect = document.createElement("select"), historySelect = document.createElement("select"), saveButton = document.createElement("button"), saveStatus = document.createElement("p");
account.className = "card";
account.innerHTML = "<h2>내 계정에 결과 저장</h2>";
loginButton.type = "button"; loginButton.textContent = "Google로 로그인";
projectSelect.setAttribute("aria-label", "저장할 프로젝트"); projectSelect.add(new Option("로그인 후 프로젝트 선택", "")); projectSelect.disabled = true;
historySelect.setAttribute("aria-label", "저장된 주간 광고 결과"); historySelect.add(new Option("로그인 후 결과 조회", "")); historySelect.disabled = true;
saveButton.type = "button"; saveButton.textContent = "내 계정에 저장"; saveButton.disabled = true;
saveStatus.className = "state";
saveStatus.textContent = apiBase ? "로그인하고 프로젝트를 선택해 주세요." : "서버 연결 전에는 결과를 계정에 저장할 수 없습니다.";
account.append(loginButton, projectSelect, saveButton, saveStatus, historySelect);
document.getElementById("results").after(account);
let viewedStored = false;
function enableSave() { saveButton.disabled = !latest || viewedStored || !apiBase || !accountState.user || !accountState.workspaceId || !projectSelect.value; }

async function unzip(buffer) {
  const bytes = new Uint8Array(buffer), view = new DataView(buffer), decoder = new TextDecoder();
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new Error("올바른 Excel 파일이 아닙니다.");
  const count = view.getUint16(end + 10, true), entries = new Map();
  let offset = view.getUint32(end + 16, true), expanded = 0;
  if (count > 500) throw new Error("Excel 파일의 내부 항목이 너무 많습니다.");
  for (let i = 0; i < count; i++) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error("Excel 압축 구조를 읽을 수 없습니다.");
    const method = view.getUint16(offset + 10, true), size = view.getUint32(offset + 20, true);
    const outputSize = view.getUint32(offset + 24, true), nameSize = view.getUint16(offset + 28, true);
    const extraSize = view.getUint16(offset + 30, true), commentSize = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameSize));
    expanded += outputSize;
    if (expanded > 30 * 1024 * 1024) throw new Error("압축을 푼 Excel 크기가 너무 큽니다.");
    if (name === "xl/workbook.xml" || name === "xl/_rels/workbook.xml.rels" || name === "xl/sharedStrings.xml" || /^xl\/worksheets\/[^/]+\.xml$/.test(name)) {
      if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error("Excel 내부 파일을 읽을 수 없습니다.");
      const start = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
      const part = bytes.slice(start, start + size);
      let data;
      if (method === 0) data = part;
      else if (method === 8) {
        const stream = new Blob([part]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
        data = new Uint8Array(await new Response(stream).arrayBuffer());
      } else throw new Error("지원하지 않는 Excel 압축 방식입니다.");
      if (data.length !== outputSize) throw new Error("Excel 내부 파일의 크기가 올바르지 않습니다.");
      entries.set(name, decoder.decode(data));
    }
    offset += 46 + nameSize + extraSize + commentSize;
  }
  return entries;
}

function xml(source) {
  if (!source) throw new Error("Excel 내부 파일이 없습니다.");
  const document = new DOMParser().parseFromString(source, "application/xml");
  if (document.querySelector("parsererror")) throw new Error("Excel 내용을 읽을 수 없습니다.");
  return document;
}
const elements = (node, name) => [...node.getElementsByTagNameNS("*", name)];
function workbookSheets(entries) {
  const workbook = xml(entries.get("xl/workbook.xml"));
  const relations = xml(entries.get("xl/_rels/workbook.xml.rels"));
  const targets = new Map(elements(relations, "Relationship").map(item => [item.getAttribute("Id"), item.getAttribute("Target")]));
  const shared = entries.has("xl/sharedStrings.xml")
    ? elements(xml(entries.get("xl/sharedStrings.xml")), "si").map(item => elements(item, "t").map(part => part.textContent).join("")) : [];
  const sheets = new Map();
  for (const sheet of elements(workbook, "sheet")) {
    const target = targets.get(sheet.getAttribute("r:id"));
    if (!target) continue;
    const path = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
    const document = xml(entries.get(path));
    const rows = [];
    for (const row of elements(document, "row")) {
      if (rows.length > 10000) throw new Error("데이터가 10,000행을 넘습니다.");
      const values = [];
      for (const cell of elements(row, "c")) {
        const letters = cell.getAttribute("r")?.match(/^[A-Z]+/)?.[0];
        if (!letters) continue;
        const index = [...letters].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0) - 1;
        if (index > 200) throw new Error("열이 너무 많습니다.");
        const kind = cell.getAttribute("t"), raw = elements(cell, "v")[0]?.textContent ?? "";
        values[index] = kind === "s" ? shared[Number(raw)] ?? "" : kind === "inlineStr"
          ? elements(cell, "t").map(part => part.textContent).join("") : raw;
      }
      if (values.some(value => value !== undefined && value !== "")) rows.push(values);
    }
    sheets.set(sheet.getAttribute("name"), rows);
  }
  return sheets;
}

function findTable(sheets) {
  let best;
  for (const [name, rows] of sheets) for (let i = 0; i < Math.min(30, rows.length); i++) {
    const header = rows[i].map(normalize), mapping = {};
    for (const [key, choices] of Object.entries(aliases)) {
      const index = header.findIndex(value => choices.some(choice => normalize(choice) === value));
      if (index >= 0) mapping[key] = index;
    }
    if (["impr", "click", "cost"].every(key => key in mapping) && (!best || Object.keys(mapping).length > best.score)) {
      best = { name, rows, index: i, mapping, score: Object.keys(mapping).length };
    }
  }
  if (!best) throw new Error("노출수·클릭수·비용 열을 찾지 못했습니다.");
  const { name, rows, index, mapping } = best;
  const parsed = rows.slice(index + 1).map(row => {
    const get = key => row[mapping[key]] ?? "";
    return { campaign: String(get("campaign") || "미분류"), group: String(get("group")), keyword: String(get("keyword")),
      impr: number(get("impr")), click: number(get("click")), cost: number(get("cost")),
      conv: number(get("conv")), revenue: number(get("revenue")) };
  }).filter(row => row.impr || row.click || row.cost);
  if (!parsed.length) throw new Error("분석할 광고 데이터 행이 없습니다.");
  return { sheet: name, rows: parsed };
}

function aggregate(rows) {
  const result = Object.fromEntries(["impr", "click", "cost", "conv", "revenue"].map(key => [key, rows.reduce((sum, row) => sum + row[key], 0)]));
  result.ctr = result.impr ? result.click / result.impr * 100 : 0;
  result.cpc = result.click ? result.cost / result.click : 0;
  result.cvr = result.click ? result.conv / result.click * 100 : 0;
  result.roas = result.cost ? result.revenue / result.cost * 100 : 0;
  return result;
}
function analyze(rows) {
  const total = aggregate(rows), groups = new Map();
  for (const row of rows) groups.set(row.campaign, [...(groups.get(row.campaign) || []), row]);
  const campaigns = [...groups].map(([name, items]) => ({ name, ...aggregate(items) })).sort((a, b) => b.cost - a.cost).slice(0, 20);
  const enriched = rows.map(row => ({ ...row, ...aggregate([row]) }));
  const waste = enriched.filter(row => row.cost >= 1000 && (!row.conv || (total.roas && row.roas < total.roas * .5))).sort((a, b) => b.cost - a.cost).slice(0, 30);
  const winners = enriched.filter(row => row.revenue > 0).sort((a, b) => b.roas - a.roas || b.revenue - a.revenue).slice(0, 20);
  return { total, campaigns, waste, winners, rowCount: rows.length };
}

function addTable(target, rows) {
  target.replaceChildren();
  if (!rows.length) {
    const row = target.insertRow(), cell = row.insertCell(); cell.colSpan = 5; cell.textContent = "해당 항목 없음";
  }
  for (const item of rows) {
    const row = target.insertRow();
    for (const value of [item.keyword || item.name || item.campaign, money(item.cost), integer(item.click), item.conv.toFixed(1), percent(item.roas)]) {
      row.insertCell().textContent = value;
    }
  }
}
function render(source, sheet, result) {
  document.getElementById("source").textContent = `${source} · ${sheet} 탭 · ${integer(result.rowCount)}행 · 규칙 기반 분석`;
  const metrics = [["광고비", money(result.total.cost)], ["전환매출", money(result.total.revenue)], ["ROAS", percent(result.total.roas)],
    ["CTR", percent(result.total.ctr)], ["CPC", money(result.total.cpc)], ["전환수", result.total.conv.toFixed(1)]];
  const grid = document.getElementById("metrics"); grid.replaceChildren();
  for (const [label, value] of metrics) {
    const box = document.createElement("div"), title = document.createElement("span"), number = document.createElement("b");
    box.className = "metric"; title.textContent = label; number.textContent = value; box.append(title, number); grid.append(box);
  }
  const insights = document.getElementById("insights"); insights.replaceChildren();
  for (const value of [
    `총 광고비 ${money(result.total.cost)}, 전환매출 ${money(result.total.revenue)}, ROAS ${percent(result.total.roas)}입니다.`,
    `전환이 없거나 평균 ROAS 절반 미만인 고비용 검색어가 ${result.waste.length}개 탐지됐습니다.`,
    "낭비 후보는 검색 의도와 전환 지연을 확인한 뒤 입찰가·소재·랜딩을 순서대로 점검하세요."
  ]) { const item = document.createElement("li"); item.textContent = value; insights.append(item); }
  addTable(document.getElementById("campaigns"), result.campaigns);
  addTable(document.getElementById("waste"), result.waste);
  addTable(document.getElementById("winners"), result.winners);
  document.getElementById("results").hidden = false;
}

let latest;
document.getElementById("analyze").addEventListener("click", async () => {
  const file = document.getElementById("file").files[0], status = document.getElementById("status"), button = document.getElementById("analyze");
  latest = null; viewedStored = false; document.getElementById("results").hidden = true; document.getElementById("download").disabled = true; enableSave();
  if (!file || !/\.xlsx$/i.test(file.name) || file.size > 5 * 1024 * 1024) { status.textContent = "5MB 이하의 .xlsx 파일을 선택해 주세요."; return; }
  button.disabled = true; status.textContent = "Excel 파일을 분석하고 있습니다.";
  try {
    const { sheet, rows } = findTable(workbookSheets(await unzip(await file.arrayBuffer())));
    const analysis = analyze(rows);
    latest = { generatedAt: new Date().toISOString(), source: file.name, sheet, analysis, analysisMode: "규칙 기반" };
    render(file.name, sheet, analysis);
    status.textContent = `${integer(analysis.rowCount)}행 분석을 마쳤습니다. 결과는 이 브라우저에서만 볼 수 있습니다.`;
    document.getElementById("download").disabled = false;
    enableSave();
  } catch (error) { status.textContent = error.message || "Excel 파일을 분석하지 못했습니다."; }
  finally { button.disabled = false; }
});
document.getElementById("download").addEventListener("click", () => {
  if (!latest) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(latest, null, 2)], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = "weekly-ad-analysis.json"; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
projectSelect.addEventListener("change", enableSave);
historySelect.addEventListener("change", () => {
  const report = accountState.reports?.get(historySelect.value);
  if (!report) return;
  viewedStored = true;
  latest = { generatedAt: new Date().toISOString(), source: report.sourceName, sheet: report.sheet, analysis: report.analysis, analysisMode: report.analysisMode };
  render(report.sourceName, report.sheet, report.analysis);
  document.getElementById("download").disabled = false;
  document.getElementById("status").textContent = "내 계정에 저장된 결과를 불러왔습니다.";
  enableSave();
});
saveButton.addEventListener("click", async () => {
  if (saveButton.disabled || !latest) return;
  const user = accountState.user, workspaceId = accountState.workspaceId;
  saveButton.disabled = true; saveStatus.textContent = "결과를 계정에 저장하고 있습니다.";
  try {
    const response = await fetch(`${apiBase}/v1/workspaces/${encodeURIComponent(workspaceId)}/weekly-ad-reports`, {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${await user.getIdToken()}` },
      body: JSON.stringify({ projectId: projectSelect.value, sourceName: latest.source, sheet: latest.sheet,
        analysis: latest.analysis, idempotencyKey: crypto.randomUUID().replaceAll("-", "") })
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error?.code || "REQUEST_FAILED");
    }
    if (user !== accountState.user || workspaceId !== accountState.workspaceId) return;
    viewedStored = true;
    saveStatus.textContent = "내 계정에 결과를 저장했습니다.";
    try { await accountState.loadReports?.(); }
    catch { saveStatus.textContent = "결과를 저장했습니다. 목록은 새로고침 후 확인해 주세요."; }
  } catch (error) { if (user === accountState.user && workspaceId === accountState.workspaceId) saveStatus.textContent = `저장하지 못했습니다. (${error.message})`; }
  finally { enableSave(); }
});

async function initAccount() {
  if (!new Set(["localhost", "127.0.0.1", "autoworks-c9a6a.web.app", "autoworks-c9a6a.firebaseapp.com"]).has(location.hostname)) return;
  const [{ initializeApp }, { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged },
    { getFirestore, collection, query, where, orderBy, limit, getDocs }] = await Promise.all([
      import("https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js"),
      import("https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js"),
      import("https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js")
    ]);
  const app = initializeApp({ apiKey: "AIzaSyC4j2aelRB3uEyGmZJbvW0OGNL5-Oi2uvA", authDomain: "autoworks-c9a6a.firebaseapp.com",
    projectId: "autoworks-c9a6a", appId: "1:823085494995:web:3be4bdd40fe0519bc59a26" });
  const auth = getAuth(app), database = getFirestore(app);
  accountState.loadReports = async () => {
    if (!accountState.workspaceId) return;
    const workspaceId = accountState.workspaceId, user = accountState.user;
    const snapshot = await getDocs(query(collection(database, "workspaces", workspaceId, "reports"), orderBy("createdAt", "desc"), limit(20)));
    if (workspaceId !== accountState.workspaceId || user !== accountState.user) return;
    accountState.reports = new Map(snapshot.docs.filter(item => item.data().tool === "weekly-ad").map(item => [item.id, item.data()]));
    historySelect.replaceChildren(new Option(accountState.reports.size ? "저장된 결과 선택" : "저장된 주간 광고 결과 없음", ""));
    for (const [id, report] of accountState.reports) historySelect.add(new Option(`${report.sourceName} · ${report.summary}`, id));
    historySelect.disabled = accountState.reports.size === 0;
  };
  loginButton.addEventListener("click", async () => {
    try { await signInWithPopup(auth, new GoogleAuthProvider()); }
    catch { saveStatus.textContent = "Google 로그인에 실패했습니다."; }
  });
  let generation = 0;
  onAuthStateChanged(auth, async user => {
    const current = ++generation;
    accountState.user = user; accountState.workspaceId = null;
    latest = null; viewedStored = false; document.getElementById("results").hidden = true;
    document.getElementById("download").disabled = true;
    saveStatus.textContent = user ? "프로젝트를 확인하고 있습니다." : (apiBase ? "로그인하고 프로젝트를 선택해 주세요." : "서버 연결 전에는 결과를 계정에 저장할 수 없습니다.");
    loginButton.hidden = Boolean(user); projectSelect.disabled = true; historySelect.disabled = true; accountState.reports = new Map();
    projectSelect.replaceChildren(new Option(user ? "프로젝트 불러오는 중" : "로그인 후 프로젝트 선택", "")); enableSave();
    historySelect.replaceChildren(new Option(user ? "저장된 결과 불러오는 중" : "로그인 후 결과 조회", ""));
    if (!user) return;
    try {
      const workspaces = await getDocs(query(collection(database, "workspaces"), where("ownerUid", "==", user.uid), limit(1)));
      if (current !== generation) return;
      if (workspaces.empty) { saveStatus.textContent = "먼저 홈에서 프로젝트를 만들어 주세요."; return; }
      accountState.workspaceId = workspaces.docs[0].id;
      const projects = await getDocs(collection(database, "workspaces", accountState.workspaceId, "projects"));
      if (current !== generation) return;
      projectSelect.replaceChildren(new Option("저장할 프로젝트 선택", ""));
      for (const project of projects.docs) projectSelect.add(new Option(project.data().name || "프로젝트", project.id));
      projectSelect.disabled = false; enableSave();
      await accountState.loadReports();
      saveStatus.textContent = apiBase ? "분석 결과를 프로젝트에 저장할 수 있습니다." : "서버 연결 전에는 결과를 계정에 저장할 수 없습니다.";
    } catch { if (current === generation) saveStatus.textContent = "프로젝트를 불러오지 못했습니다."; }
  });
}
initAccount().catch(() => { saveStatus.textContent = "계정 연결 화면을 준비하지 못했습니다."; });

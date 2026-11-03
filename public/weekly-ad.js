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
  latest = null; document.getElementById("results").hidden = true; document.getElementById("download").disabled = true;
  if (!file || !/\.xlsx$/i.test(file.name) || file.size > 5 * 1024 * 1024) { status.textContent = "5MB 이하의 .xlsx 파일을 선택해 주세요."; return; }
  button.disabled = true; status.textContent = "Excel 파일을 분석하고 있습니다.";
  try {
    const { sheet, rows } = findTable(workbookSheets(await unzip(await file.arrayBuffer())));
    const analysis = analyze(rows);
    latest = { generatedAt: new Date().toISOString(), source: file.name, sheet, analysis, analysisMode: "규칙 기반" };
    render(file.name, sheet, analysis);
    status.textContent = `${integer(analysis.rowCount)}행 분석을 마쳤습니다. 결과는 이 브라우저에서만 볼 수 있습니다.`;
    document.getElementById("download").disabled = false;
  } catch (error) { status.textContent = error.message || "Excel 파일을 분석하지 못했습니다."; }
  finally { button.disabled = false; }
});
document.getElementById("download").addEventListener("click", () => {
  if (!latest) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(latest, null, 2)], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = "weekly-ad-analysis.json"; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

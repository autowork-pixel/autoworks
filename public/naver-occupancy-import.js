const fileInput = document.getElementById("occupancyFile"), status = document.getElementById("occupancyStatus"), output = document.getElementById("occupancyResults");
const percent = value => { const number = Number(String(value || "").replace(/[^0-9.]/g, "")); return Number.isFinite(number) ? Math.min(100, Math.max(0, number)) : 0; };
function node(tag, className, text) { const element = document.createElement(tag); if (className) element.className = className; if (text != null) element.textContent = text; return element; }
function readReport(markup) {
  const document = new DOMParser().parseFromString(markup, "text/html");
  const cards = [...document.querySelectorAll(".teampanel[data-bi='0'] .bcard")];
  const brands = cards.map(card => {
    const measures = [...card.querySelectorAll(".bmet .mv")].map(item => item.textContent.trim());
    const keywords = [...card.querySelectorAll(".bkw .r")].map(row => {
      const parts = [...row.children]; const values = parts[1]?.textContent.match(/\d+(?:\.\d+)?%/g) || [];
      return { name: parts[0]?.textContent.trim() || "키워드", total: percent(values[0]), organic: percent(values[1]) };
    });
    return { name: card.querySelector(".bname")?.textContent.trim() || "브랜드", category: card.querySelector(".bcat")?.textContent.trim() || "", total: percent(measures[0]), organic: percent(measures[1]), leading: measures[2] || "—", audit: card.querySelector(".baudit")?.textContent.trim() || "", keywords };
  });
  if (!brands.length || brands.some(brand => !brand.keywords.length)) throw new Error("지원하는 생활용품팀 리포트 형식이 아닙니다.");
  return { brands, measuredAt: document.querySelector(".teampanel[data-bi='0'] .tmeta")?.textContent.trim() || "측정 시각 미기재" };
}
function occupancyBar(value, organic) {
  const track = node("div", "bar"); track.style.height = "15px"; track.style.position = "relative";
  const total = node("i"); total.style.width = `${value}%`; total.style.background = "#8dd8bd";
  const core = node("i"); core.style.width = `${organic}%`; core.style.background = "#0b8769"; core.style.position = "absolute"; core.style.left = "0"; core.style.top = "0";
  track.append(total, core); return track;
}
function renderBrand(brand, region) {
  region.replaceChildren();
  const metrics = node("div", "summary-grid");
  for (const [label, value, note] of [["평균 종합 점유", `${brand.total}%`, "첫화면 전체 칸"], ["평균 오가닉 점유", `${brand.organic}%`, "광고 제외"], ["선두권 키워드", brand.leading, "종합 점유 10% 이상"]]) {
    const card = node("div", "metric"); card.append(node("small", "", label), node("strong", "", value), node("span", "", note)); metrics.append(card);
  }
  region.append(metrics, node("p", "section-note", brand.audit));
  for (const keyword of brand.keywords) {
    const row = node("div", "audit-row"), left = node("div"), value = node("div");
    left.style.flex = "1"; left.append(node("b", "", keyword.name), occupancyBar(keyword.total, keyword.organic));
    value.style.textAlign = "right"; value.append(node("b", "", `${keyword.total}%`), node("small", "", `오가닉 ${keyword.organic}%`)); row.append(left, value); region.append(row);
  }
}
function render(report) {
  output.replaceChildren();
  output.append(node("p", "fineprint", `${report.measuredAt} · 종합=첫화면 전체 칸 중 자사 비중 · 오가닉=광고 제외`));
  const tabs = node("div", "tabs"), detail = node("div"); output.append(tabs, detail);
  for (const [index, brand] of report.brands.entries()) {
    const button = node("button", index === 0 ? "active" : "", brand.name); button.type = "button";
    button.addEventListener("click", () => { for (const tab of tabs.children) tab.classList.toggle("active", tab === button); renderBrand(brand, detail); });
    tabs.append(button);
  }
  renderBrand(report.brands[0], detail);
}
fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0]; if (!file) return;
  try {
    if (file.size > 5_000_000) throw new Error("리포트 파일은 5MB 이하만 읽을 수 있습니다.");
    const report = readReport(await file.text()); render(report);
    status.textContent = `${report.brands.length}개 브랜드의 점유 리포트를 불러왔습니다.`; status.className = "status success";
  } catch (error) { output.replaceChildren(); status.textContent = error.message; status.className = "status error"; }
});

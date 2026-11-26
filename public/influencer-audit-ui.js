import { analyzeInfluencerPosts } from "./influencer-audit.js";

const data = document.getElementById("auditData"), button = document.getElementById("analyzeAudit");
const status = document.getElementById("auditStatus"), output = document.getElementById("auditResults");
function metric(label, value, note) {
  const box = document.createElement("div"); box.className = "metric";
  const small = document.createElement("small"), strong = document.createElement("strong"), span = document.createElement("span");
  small.textContent = label; strong.textContent = value; span.textContent = note;
  box.append(small, strong, span); return box;
}
button.addEventListener("click", () => {
  try {
    if (data.value.length > 2_000_000) throw new Error("입력 자료가 너무 큽니다.");
    const result = analyzeInfluencerPosts(JSON.parse(data.value));
    output.replaceChildren();
    const summary = document.createElement("div"); summary.className = "summary-grid";
    summary.append(metric("광고 게시물", `${result.adCount} / ${result.recentCount}`, `최근 3개월 · 최신 15개 · ${result.cutoff} 이후`),
      metric("검색 반등 확인", `${result.reboundCount} / ${result.reboundChecked}`, `광고 ${result.adCount}건 중 자료 제공 ${result.reboundChecked}건`),
      metric("진성도 검토 표본", `${result.instagramReelsSample} / ${result.youtubeVideosSample}`, "릴스 최대 30 · YouTube 최대 50"));
    output.append(summary);
    if (result.duplicateCampaignGroups) {
      const warning = document.createElement("p"); warning.className = "notice";
      warning.textContent = `같은 날짜·브랜드의 광고 묶음 ${result.duplicateCampaignGroups}개가 있습니다. 게시물 수에는 각각 포함하며, 캠페인 중복 여부는 따로 검토하세요.`;
      output.append(warning);
    }
    const heading = document.createElement("h3"); heading.textContent = "광고 게시물별 검색 변화"; output.append(heading);
    const list = document.createElement("div"); list.className = "audit-list";
    for (const ad of result.ads) {
      const row = document.createElement("div"); row.className = "audit-row";
      const label = document.createElement("div"), title = document.createElement("b"), sub = document.createElement("small"), value = document.createElement("span");
      title.textContent = ad.brand || "브랜드 미입력"; sub.textContent = `${ad.date} · ${ad.platform} ${ad.type}`;
      value.textContent = ad.searchLiftPercent === null ? "자료 없음" : `${ad.searchLiftPercent > 0 ? "+" : ""}${ad.searchLiftPercent}%`;
      label.append(title, sub); row.append(label, value); list.append(row);
    }
    if (!result.ads.length) { const empty = document.createElement("p"); empty.className = "empty"; empty.textContent = "기준 범위의 광고 게시물이 없습니다."; list.append(empty); }
    output.append(list); status.textContent = "게시물 기준 분석을 완료했습니다. 검색 반등과 광고 효과는 별도로 해석해야 합니다."; status.className = "status success";
  } catch (error) { status.textContent = error instanceof SyntaxError ? "JSON 형식을 확인해 주세요." : error.message; status.className = "status error"; }
});

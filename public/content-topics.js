const hooks = {
  SCS: keyword => `${keyword}: 어떤 문제를 해결해야 할까?`,
  QQA: keyword => `${keyword} 선택 전에 확인할 질문 3가지`,
  BAD: keyword => `${keyword} 선택 전후, 무엇을 비교해야 할까?`
};

function normalized(value) {
  return String(value || "").trim().toLocaleLowerCase("ko-KR").replace(/\s+/g, "");
}

export function buildTopicCandidates(keywords, audience, hook, searchSignals = []) {
  const target = String(audience || "").trim();
  if (!target || !Object.hasOwn(hooks, hook)) return [];
  const unique = [...new Set((Array.isArray(keywords) ? keywords : [])
    .filter(value => typeof value === "string")
    .map(value => value.trim())
    .filter(Boolean))];
  const volumes = new Map();
  for (const item of Array.isArray(searchSignals) ? searchSignals : []) {
    const key = normalized(item?.keyword);
    if (key && Number.isFinite(item.total) && item.total >= 0 && !volumes.has(key)) volumes.set(key, Math.round(item.total));
  }
  const ranked = unique.map((keyword, index) => ({ keyword, index, volume: volumes.get(normalized(keyword)) ?? null }))
    .sort((a, b) => Number(b.volume !== null) - Number(a.volume !== null) || (b.volume ?? 0) - (a.volume ?? 0) || a.index - b.index)
    .slice(0, 3);
  return ranked.map(({ keyword, volume }) => ({
    keyword,
    title: hooks[hook](keyword),
    searchVolume: volume,
    note: `${target} 관점에서 다룰 질문입니다.${volume === null ? "" : ` 최근 조회한 월간 검색량 ${volume.toLocaleString("ko-KR")}회를 참고했습니다.`} 주장과 수치는 확인된 사실을 입력한 뒤 검토하세요.`
  }));
}

const hooks = {
  SCS: keyword => `${keyword}: 어떤 문제를 해결해야 할까?`,
  QQA: keyword => `${keyword} 선택 전에 확인할 질문 3가지`,
  BAD: keyword => `${keyword} 선택 전후, 무엇을 비교해야 할까?`
};

function normalized(value) {
  return String(value || "").trim().toLocaleLowerCase("ko-KR").replace(/\s+/g, "");
}

const DAY_MS = 24 * 60 * 60 * 1000;

function recordedDate(value) {
  let candidate = value;
  try {
    if (typeof candidate?.toDate === "function") candidate = candidate.toDate();
    else if (Number.isFinite(candidate?.seconds)) candidate = new Date(candidate.seconds * 1000);
  } catch { return null; }
  const date = candidate instanceof Date ? candidate : new Date(candidate);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(date);
  const part = type => parts.find(item => item.type === type)?.value;
  return { label: `${part("year")}-${part("month")}-${part("day")}`, timestamp: date.getTime() };
}

export function buildTopicCandidates(keywords, audience, hook, searchSignals = [], options = {}) {
  const target = String(audience || "").trim();
  if (!target || !Object.hasOwn(hooks, hook)) return [];
  const unique = [...new Set((Array.isArray(keywords) ? keywords : [])
    .filter(value => typeof value === "string")
    .map(value => value.trim())
    .filter(Boolean))];
  const volumes = new Map();
  for (const item of Array.isArray(searchSignals) ? searchSignals : []) {
    const key = normalized(item?.keyword);
    if (key && Number.isFinite(item.total) && item.total >= 0 && !volumes.has(key)) {
      volumes.set(key, { volume: Math.round(item.total), recorded: recordedDate(item.recordedAt) });
    }
  }
  const ranked = unique.map((keyword, index) => {
    const signal = volumes.get(normalized(keyword));
    return { keyword, index, volume: signal?.volume ?? null, recorded: signal?.recorded ?? null };
  })
    .sort((a, b) => Number(b.volume !== null) - Number(a.volume !== null) || (b.volume ?? 0) - (a.volume ?? 0) || a.index - b.index)
    .slice(0, 3);
  const nowCandidate = options.now instanceof Date ? options.now : new Date(options.now ?? Date.now());
  const now = Number.isFinite(nowCandidate.getTime()) ? nowCandidate.getTime() : Date.now();
  const staleAfterDays = Number.isFinite(options.staleAfterDays) && options.staleAfterDays > 0 ? options.staleAfterDays : 30;
  return ranked.map(({ keyword, volume, recorded }) => {
    const stale = recorded ? now - recorded.timestamp >= staleAfterDays * DAY_MS : false;
    return {
      keyword,
      title: hooks[hook](keyword),
      searchVolume: volume,
      searchRecordedAt: recorded?.label ?? null,
      searchStale: stale,
      note: `${target} 관점에서 다룰 질문입니다.${volume === null ? "" : ` ${recorded ? `${recorded.label} 조회 기준${stale ? ` · ${staleAfterDays}일 이상 지난 참고값` : ""} ` : "조회일 미확인 "}월간 검색량 ${volume.toLocaleString("ko-KR")}회를 참고했습니다.`} 주장과 수치는 확인된 사실을 입력한 뒤 검토하세요.`
    };
  });
}

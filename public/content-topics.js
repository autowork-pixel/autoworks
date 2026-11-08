const hooks = {
  SCS: keyword => `${keyword}: 어떤 문제를 해결해야 할까?`,
  QQA: keyword => `${keyword} 선택 전에 확인할 질문 3가지`,
  BAD: keyword => `${keyword} 선택 전후, 무엇을 비교해야 할까?`
};

export function buildTopicCandidates(keywords, audience, hook) {
  const target = String(audience || "").trim();
  if (!target || !Object.hasOwn(hooks, hook)) return [];
  const unique = [...new Set((Array.isArray(keywords) ? keywords : [])
    .filter(value => typeof value === "string")
    .map(value => value.trim())
    .filter(Boolean))].slice(0, 3);
  return unique.map(keyword => ({
    keyword,
    title: hooks[hook](keyword),
    note: `${target} 관점에서 다룰 질문입니다. 주장과 수치는 확인된 사실을 입력한 뒤 검토하세요.`
  }));
}

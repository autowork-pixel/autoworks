import { createHash } from "node:crypto";
import { ApiError } from "./domain.mjs";

const contentTypes = new Set(["정보형", "후기형", "비교형", "가이드형"]);
const tones = new Set(["전문적", "친근한", "설득력 있는", "담백한"]);
const lengths = new Set([800, 1500, 2500]);

function text(value, label, maximum, required = true) {
  if ((!required && (value == null || value === ""))) return "";
  if (typeof value !== "string" || !value.trim() || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new ApiError("INVALID_INPUT", `${label} 값이 올바르지 않습니다.`);
  }
  return value.trim();
}

function list(value, label, maximum) {
  if (!Array.isArray(value) || value.length < 1 || value.length > maximum) throw new ApiError("INVALID_INPUT", `${label}은 1~${maximum}개여야 합니다.`);
  return [...new Set(value.map(item => text(item, label, 80)))];
}

export function normalizeAiBlogInput(body) {
  if (!body || typeof body !== "object" || Array.isArray(body) || !/^[A-Za-z0-9_-]{1,128}$/.test(body.projectId || "") || !/^[A-Za-z0-9_-]{16,128}$/.test(body.idempotencyKey || "")) {
    throw new ApiError("INVALID_INPUT", "AI 블로그 요청 정보가 올바르지 않습니다.");
  }
  if (!contentTypes.has(body.contentType) || !tones.has(body.tone) || !lengths.has(body.targetLength)) throw new ApiError("INVALID_INPUT", "글 유형·톤·목표 분량이 올바르지 않습니다.");
  return {
    projectId: body.projectId,
    topic: text(body.topic, "주제", 160),
    facts: text(body.facts, "확인된 사실", 4000),
    keywords: list(body.keywords, "키워드", 8),
    contentType: body.contentType,
    tone: body.tone,
    targetLength: body.targetLength,
    sourceDraft: text(body.sourceDraft, "기존 초안", 12000, false),
    idempotencyKey: body.idempotencyKey
  };
}

export function aiBlogDigest(input) {
  const { idempotencyKey, ...stable } = input;
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

function outputText(payload) {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) return payload.output_text.trim();
  const parts = [];
  for (const item of Array.isArray(payload?.output) ? payload.output : []) for (const content of Array.isArray(item?.content) ? item.content : []) {
    if (content?.type === "output_text" && typeof content.text === "string") parts.push(content.text);
  }
  return parts.join("\n").trim();
}

export async function generateAiBlogDraft({ input, apiKey, model, fetchImpl = fetch, now = () => new Date() }) {
  if (typeof apiKey !== "string" || !apiKey) throw new ApiError("PROVIDER_CREDENTIAL_REQUIRED", "OpenAI API 키 연결이 필요합니다.", 409);
  if (typeof model !== "string" || !/^[A-Za-z0-9._-]{2,80}$/.test(model)) throw new ApiError("PROVIDER_UNAVAILABLE", "AI 모델 설정을 확인할 수 없습니다.", 503);
  const instructions = "당신은 한국어 브랜드 콘텐츠 편집자입니다. 사용자가 제공한 '확인된 사실'만 사실 주장에 사용하세요. 없는 수치·후기·효능·인용·출처를 만들지 말고, 불확실한 부분은 [확인 필요]로 표시하세요. 제목, 도입, 소제목, 본문, 마무리를 갖춘 Markdown 초안을 작성하세요. 자동 게시용 완성본이 아니라 사람의 사실 확인과 편집이 필요한 초안입니다.";
  const prompt = [`주제: ${input.topic}`, `글 유형: ${input.contentType}`, `톤: ${input.tone}`, `목표 분량: 약 ${input.targetLength}자`, `핵심 키워드: ${input.keywords.join(", ")}`, `확인된 사실:\n${input.facts}`, input.sourceDraft ? `기존 초안(개선 대상):\n${input.sourceDraft}` : "기존 초안: 없음"].join("\n\n");
  let response;
  try {
    response = await fetchImpl("https://api.openai.com/v1/responses", {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(45_000),
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ model, instructions, input: [{ role: "user", content: [{ type: "input_text", text: prompt }] }], max_output_tokens: Math.min(5000, Math.max(1200, Math.ceil(input.targetLength * 1.8))) })
    });
  } catch { throw new ApiError("PROVIDER_UNAVAILABLE", "OpenAI API에 연결하지 못했습니다.", 503); }
  if (!response.ok) {
    const code = [400, 401, 403].includes(response.status) ? "PROVIDER_AUTH_FAILED" : response.status === 429 ? "PROVIDER_RATE_LIMIT" : "PROVIDER_UNAVAILABLE";
    throw new ApiError(code, "AI 초안을 생성하지 못했습니다.", response.status === 429 ? 429 : 502);
  }
  let payload;
  try { payload = await response.json(); } catch { throw new ApiError("PROVIDER_INVALID_RESPONSE", "AI 응답을 읽지 못했습니다.", 502); }
  const draft = outputText(payload);
  if (!draft) throw new ApiError("PROVIDER_INVALID_RESPONSE", "AI 응답에 초안이 없습니다.", 502);
  const usage = payload.usage || {};
  return {
    draft: draft.slice(0, 30000), model, generatedAt: now().toISOString(),
    inputTokens: Number.isSafeInteger(usage.input_tokens) && usage.input_tokens >= 0 ? usage.input_tokens : null,
    outputTokens: Number.isSafeInteger(usage.output_tokens) && usage.output_tokens >= 0 ? usage.output_tokens : null
  };
}

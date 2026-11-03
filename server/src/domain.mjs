import { createHash, randomUUID } from "node:crypto";

const periodValues = new Set([7, 28, 180]);
const roundingValues = new Set([1, 10, 100]);
const idPattern = /^[A-Za-z0-9_-]{1,128}$/;

export class ApiError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

function text(value, field, max) {
  if (typeof value !== "string") throw new ApiError("INVALID_INPUT", `${field} 형식이 올바르지 않습니다.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > max) throw new ApiError("INVALID_INPUT", `${field} 길이가 올바르지 않습니다.`);
  if (/[\u0000-\u001f\u007f]/.test(normalized)) throw new ApiError("INVALID_INPUT", `${field}에 허용되지 않는 문자가 있습니다.`);
  return normalized;
}

function textList(value, field, maxItems) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > maxItems) throw new ApiError("INVALID_INPUT", `${field} 개수가 올바르지 않습니다.`);
  return value.map((item, index) => text(item, `${field}[${index}]`, 80));
}

export function normalizeBrandSearchInput(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ApiError("INVALID_INPUT", "요청 본문이 올바르지 않습니다.");
  const projectId = text(body.projectId, "projectId", 128);
  if (!idPattern.test(projectId)) throw new ApiError("INVALID_INPUT", "projectId 형식이 올바르지 않습니다.");
  const brand = text(body.brand, "brand", 80);
  const competitors = textList(body.competitors, "competitors", 5);
  const requestedKeywords = textList(body.keywords, "keywords", 20);
  const deduped = [];
  const seen = new Set();
  for (const keyword of [brand, ...competitors, ...requestedKeywords]) {
    const key = keyword.toLocaleLowerCase("ko-KR");
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(keyword);
    }
  }
  if (deduped.length > 20) throw new ApiError("INVALID_INPUT", "전체 키워드는 최대 20개입니다.");
  if (!periodValues.has(body.displayPeriodDays)) throw new ApiError("INVALID_INPUT", "displayPeriodDays 값이 올바르지 않습니다.");
  if (!roundingValues.has(body.roundingUnit)) throw new ApiError("INVALID_INPUT", "roundingUnit 값이 올바르지 않습니다.");
  const idempotencyKey = text(body.idempotencyKey, "idempotencyKey", 128);
  if (!idPattern.test(idempotencyKey) || idempotencyKey.length < 16) {
    throw new ApiError("INVALID_INPUT", "idempotencyKey는 16자 이상의 무작위 값이어야 합니다.");
  }
  return {
    projectId,
    brand,
    competitors,
    keywords: deduped,
    displayPeriodDays: body.displayPeriodDays,
    roundingUnit: body.roundingUnit,
    idempotencyKey
  };
}

export function requestDigest(input) {
  const stable = JSON.stringify({
    projectId: input.projectId,
    brand: input.brand,
    competitors: input.competitors,
    keywords: input.keywords,
    displayPeriodDays: input.displayPeriodDays,
    roundingUnit: input.roundingUnit
  });
  return createHash("sha256").update(stable).digest("hex");
}

export function privateIdempotencyId(uid, key) {
  return createHash("sha256").update(`${uid}:${key}`).digest("hex");
}

export function newRequestId() {
  return randomUUID();
}

import { createHash } from "node:crypto";
import { ApiError } from "./domain.mjs";

const providers = new Set(["meta-ads", "google-ads", "kakao-moment"]);
const idPattern = /^[A-Za-z0-9_-]{1,128}$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function date(value, label) {
  if (typeof value !== "string" || !datePattern.test(value)) throw new ApiError("INVALID_INPUT", `${label} 형식이 올바르지 않습니다.`);
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new ApiError("INVALID_INPUT", `${label} 날짜가 올바르지 않습니다.`);
  return parsed;
}

export function normalizeAdReportInput(body) {
  if (!body || typeof body !== "object" || Array.isArray(body) || !idPattern.test(body.projectId || "") ||
      !/^[A-Za-z0-9_-]{16,128}$/.test(body.idempotencyKey || "") || !providers.has(body.provider)) {
    throw new ApiError("INVALID_INPUT", "광고 보고서 요청 정보가 올바르지 않습니다.");
  }
  const since = date(body.since, "시작일"), until = date(body.until, "종료일");
  const days = Math.round((until - since) / 86_400_000) + 1;
  if (days < 1 || days > 31) throw new ApiError("INVALID_INPUT", "광고 보고서 기간은 1~31일이어야 합니다.");
  return { projectId: body.projectId, provider: body.provider, since: body.since, until: body.until, idempotencyKey: body.idempotencyKey };
}

export function adReportDigest(input) {
  const { idempotencyKey, ...stable } = input;
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

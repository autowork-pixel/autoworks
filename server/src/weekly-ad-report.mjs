import { createHash } from "node:crypto";
import { ApiError } from "./domain.mjs";

const identifier = /^[A-Za-z0-9_-]{1,128}$/;
const metrics = ["impr", "click", "cost", "conv", "revenue", "ctr", "cpc", "cvr", "roas"];

function label(value, name, maximum) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new ApiError("INVALID_INPUT", `${name} 형식이 올바르지 않습니다.`);
  }
  return value.trim();
}
function metric(value, name) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1e15) {
    throw new ApiError("INVALID_INPUT", `${name} 수치가 올바르지 않습니다.`);
  }
  return value;
}
function summary(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiError("INVALID_INPUT", `${name}이 올바르지 않습니다.`);
  return Object.fromEntries(metrics.map(key => [key, metric(value[key], `${name}.${key}`)]));
}
function entries(value, name, maximum) {
  if (!Array.isArray(value) || value.length > maximum) throw new ApiError("INVALID_INPUT", `${name} 개수가 올바르지 않습니다.`);
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new ApiError("INVALID_INPUT", `${name}[${index}] 형식이 올바르지 않습니다.`);
    return ({
    name: label(item.keyword || item.name || item.campaign, `${name}[${index}]`, 80),
    campaign: item.campaign ? label(item.campaign, "campaign", 80) : "",
    ...summary(item, `${name}[${index}]`)
    });
  });
}

export function normalizeWeeklyAdReport(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ApiError("INVALID_INPUT", "요청 본문이 올바르지 않습니다.");
  const projectId = label(body.projectId, "projectId", 128);
  const idempotencyKey = label(body.idempotencyKey, "idempotencyKey", 128);
  if (!identifier.test(projectId) || !identifier.test(idempotencyKey) || idempotencyKey.length < 16) {
    throw new ApiError("INVALID_INPUT", "프로젝트 또는 요청 식별자가 올바르지 않습니다.");
  }
  const sourceName = label(body.sourceName, "sourceName", 120);
  if (!/\.xlsx$/i.test(sourceName) || /[/\\]/.test(sourceName)) throw new ApiError("INVALID_INPUT", "Excel 파일 이름이 올바르지 않습니다.");
  const sheet = label(body.sheet, "sheet", 80);
  const analysis = body.analysis;
  if (!analysis || !Number.isInteger(analysis.rowCount) || analysis.rowCount < 1 || analysis.rowCount > 10000) {
    throw new ApiError("INVALID_INPUT", "분석 행 수가 올바르지 않습니다.");
  }
  return {
    projectId, idempotencyKey, sourceName, sheet,
    analysis: { rowCount: analysis.rowCount, total: summary(analysis.total, "total"),
      campaigns: entries(analysis.campaigns, "campaigns", 20),
      waste: entries(analysis.waste, "waste", 30),
      winners: entries(analysis.winners, "winners", 20) }
  };
}

export function weeklyAdReportDigest(input) {
  return createHash("sha256").update(JSON.stringify({
    projectId: input.projectId, sourceName: input.sourceName, sheet: input.sheet, analysis: input.analysis
  })).digest("hex");
}

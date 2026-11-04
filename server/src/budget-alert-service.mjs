import { createHash } from "node:crypto";
import { ApiError } from "./domain.mjs";

function finite(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new ApiError("INVALID_INPUT", `예산 알림의 ${name} 값이 올바르지 않습니다.`, 400);
  return number;
}

function decodeData(value) {
  if (typeof value !== "string" || value.length > 32_768 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new ApiError("INVALID_INPUT", "예산 알림 본문이 올바르지 않습니다.", 400);
  }
  try { return JSON.parse(Buffer.from(value, "base64").toString("utf8")); }
  catch { throw new ApiError("INVALID_INPUT", "예산 알림 본문이 올바르지 않습니다.", 400); }
}

export function normalizeBudgetPush(body, expectedBudgetDisplayName) {
  const message = body?.message;
  if (!message || typeof message !== "object" || typeof message.messageId !== "string" || !/^\d{1,40}$/.test(message.messageId)) {
    throw new ApiError("INVALID_INPUT", "예산 알림 식별자가 올바르지 않습니다.", 400);
  }
  if (message.attributes?.schemaVersion !== "1.0") throw new ApiError("INVALID_INPUT", "지원하지 않는 예산 알림 형식입니다.", 400);
  const data = decodeData(message.data);
  if (data.budgetDisplayName !== expectedBudgetDisplayName) throw new ApiError("INVALID_INPUT", "허용되지 않은 예산 알림입니다.", 403);
  const costAmount = finite(data.costAmount, "누적 비용");
  const budgetAmount = finite(data.budgetAmount, "예산");
  const alertThresholdExceeded = finite(data.alertThresholdExceeded ?? 0, "초과 기준");
  if (budgetAmount <= 0) throw new ApiError("INVALID_INPUT", "예산 금액이 올바르지 않습니다.", 400);
  const costIntervalStart = new Date(data.costIntervalStart);
  if (Number.isNaN(costIntervalStart.valueOf())) throw new ApiError("INVALID_INPUT", "예산 기간이 올바르지 않습니다.", 400);
  return {
    eventId: createHash("sha256").update(message.messageId).digest("hex"),
    budgetDisplayName: expectedBudgetDisplayName,
    costRatio: costAmount / budgetAmount,
    alertThresholdExceeded,
    costIntervalStart,
    shouldBlock: costAmount >= budgetAmount || alertThresholdExceeded >= 1
  };
}

export function createBudgetAlertService({ repository, expectedBudgetDisplayName }) {
  if (!repository || !expectedBudgetDisplayName) throw new Error("Budget alert service configuration is incomplete");
  return { process: body => repository.record(normalizeBudgetPush(body, expectedBudgetDisplayName)) };
}

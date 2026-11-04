import { createHash } from "node:crypto";
import { ApiError } from "./domain.mjs";
import { PAID_PLANS } from "./plan-catalog.mjs";
import { decryptCredentialPayload } from "./credential-crypto.mjs";

const DAY_MS = 86_400_000;

function asDate(value, name) {
  const date = value?.toDate ? value.toDate() : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new ApiError("PAYMENT_STATE_INVALID", `${name}을 확인할 수 없습니다.`, 503);
  return date;
}

function renewalIdentity(workspaceId, periodEnd) {
  return createHash("sha256").update(`${workspaceId}:${periodEnd.toISOString()}`).digest("hex");
}

function validatePayment(payment, expected) {
  const approvedAt = asDate(payment?.approvedAt, "결제 승인 시각");
  if (!payment || payment.orderId !== expected.orderId || payment.status !== "DONE" || payment.currency !== "KRW" ||
      payment.totalAmount !== expected.amount || typeof payment.paymentKey !== "string" || !payment.paymentKey) {
    throw new ApiError("PAYMENT_RESPONSE_INVALID", "정기결제 승인 결과가 주문과 일치하지 않습니다.", 502);
  }
  return { ...payment, approvedAt };
}

export function createBillingRenewalService({ repository, provider, keyManager, now = () => new Date(), batchSize = 20 }) {
  if (!repository || !provider || !keyManager) throw new Error("Billing renewal service configuration is incomplete");
  return {
    async runOnce() {
      const current = now();
      const candidates = await repository.listDue({ now: current, limit: batchSize });
      const result = { examined: candidates.length, succeeded: 0, failed: 0, skipped: 0 };
      for (const candidate of candidates) {
        let claim;
        try {
          claim = await repository.claim({ workspaceId: candidate.workspaceId, now: current });
          if (!claim) { result.skipped += 1; continue; }
          const plan = PAID_PLANS[claim.planId];
          if (!plan) throw new ApiError("PAYMENT_STATE_INVALID", "구독 요금 정보를 확인할 수 없습니다.", 503);
          const periodEnd = asDate(claim.periodEnd, "구독 종료일");
          const digest = renewalIdentity(candidate.workspaceId, periodEnd);
          const orderId = `aw_r_${digest.slice(0, 48)}`;
          const idempotencyKey = `renew_${digest}`;
          const plaintextDataKey = await keyManager.decryptDataKey({
            workspaceId: candidate.workspaceId, provider: "toss-billing",
            encryptedDataKey: claim.envelope.encryptedDataKey, keyVersion: claim.envelope.keyVersion
          });
          let credentials;
          try { credentials = decryptCredentialPayload({ envelope: claim.envelope, plaintextDataKey, provider: "toss-billing" }); }
          finally { plaintextDataKey.fill(0); }
          let payment;
          try {
            payment = await provider.charge({ billingKey: credentials.billingKey, customerKey: credentials.customerKey,
              amount: plan.priceKrw, orderId, orderName: `오토웍스 ${plan.planLabel} 월 구독 갱신`, idempotencyKey });
          } catch (error) {
            if (error?.code !== "PAYMENT_TEMPORARILY_UNAVAILABLE") throw error;
            payment = await provider.findByOrderId(orderId);
          }
          await repository.succeed({ workspaceId: candidate.workspaceId, claimToken: claim.claimToken, plan,
            previousPeriodEnd: periodEnd, payment: validatePayment(payment, { orderId, amount: plan.priceKrw }) });
          result.succeeded += 1;
        } catch (error) {
          if (claim?.claimToken) {
            const periodEnd = asDate(claim.periodEnd, "구독 종료일");
            const graceEnd = new Date(periodEnd.getTime() + 3 * DAY_MS);
            const nextRenewalAt = claim.attempt === 1 ? new Date(periodEnd.getTime() + DAY_MS) :
              claim.attempt === 2 ? graceEnd : null;
            try { await repository.failRenewal({ workspaceId: candidate.workspaceId, claimToken: claim.claimToken,
              attempt: claim.attempt, errorCode: error?.code || "INTERNAL_ERROR", graceEnd, nextRenewalAt }); }
            catch { result.skipped += 1; continue; }
          }
          result.failed += 1;
        }
      }
      return result;
    }
  };
}


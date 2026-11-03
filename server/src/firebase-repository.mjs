import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { ApiError, privateIdempotencyId, requestDigest } from "./domain.mjs";
import { createRunRepository } from "./run-repository.mjs";

if (!getApps().length) initializeApp();
const database = getFirestore();
const runLifecycleRepository = createRunRepository({ database, serverTimestamp: () => FieldValue.serverTimestamp() });

function usagePeriod(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit" })
    .format(now)
    .slice(0, 7);
}

export const verifyIdToken = token => getAuth().verifyIdToken(token, true);

export const repository = {
  cancelBrandSearchRun: input => runLifecycleRepository.cancelBrandSearchRun(input),

  async reserveBrandSearchRun({ workspaceId, uid, input, requestId }) {
    const workspace = database.doc(`workspaces/${workspaceId}`);
    const project = workspace.collection("projects").doc(input.projectId);
    const access = workspace.collection("serverControls").doc("access");
    const subscription = workspace.collection("subscriptions").doc("current");
    const credential = workspace.collection("providerCredentials").doc("naver-searchad");
    const period = usagePeriod();
    const usage = workspace.collection("usage").doc(period);
    const idempotency = workspace.collection("runRequests").doc(privateIdempotencyId(uid, input.idempotencyKey));
    const digest = requestDigest(input);

    return database.runTransaction(async transaction => {
      const [workspaceSnapshot, projectSnapshot, accessSnapshot, subscriptionSnapshot, credentialSnapshot, usageSnapshot, requestSnapshot] =
        await Promise.all([workspace, project, access, subscription, credential, usage, idempotency].map(ref => transaction.get(ref)));
      if (!workspaceSnapshot.exists || workspaceSnapshot.data().ownerUid !== uid) {
        throw new ApiError("AUTH_REQUIRED", "워크스페이스 권한을 확인할 수 없습니다.", 403);
      }
      if (!projectSnapshot.exists) throw new ApiError("INVALID_INPUT", "프로젝트를 찾을 수 없습니다.", 404);
      if (accessSnapshot.exists && accessSnapshot.data().blocked === true) {
        throw new ApiError("AUTH_REQUIRED", "현재 실행할 수 없는 계정입니다.", 403);
      }
      const plan = subscriptionSnapshot.data();
      if (!subscriptionSnapshot.exists || !["trialing", "active"].includes(plan.status)) {
        throw new ApiError("SUBSCRIPTION_REQUIRED", "이용 가능한 구독이 필요합니다.", 403);
      }
      if (!credentialSnapshot.exists || credentialSnapshot.data().status !== "active" || !credentialSnapshot.data().ciphertext) {
        throw new ApiError("PROVIDER_CREDENTIAL_REQUIRED", "네이버 검색광고 API 연결이 필요합니다.", 409);
      }
      if (requestSnapshot.exists) {
        const existing = requestSnapshot.data();
        if (existing.requestDigest !== digest) throw new ApiError("INVALID_INPUT", "같은 멱등키를 다른 요청에 사용할 수 없습니다.", 409);
        return { runId: existing.runId, status: existing.status || "queued", reused: true };
      }
      const currentUsage = usageSnapshot.data() || {};
      const reservedRuns = Number(currentUsage.runsReserved || 0);
      const completedRuns = Number(currentUsage.runs || 0);
      const reservedKeywords = Number(currentUsage.keywordLookupsReserved || 0);
      const completedKeywords = Number(currentUsage.keywordLookups || 0);
      if (Number.isFinite(plan.runLimit) && completedRuns + reservedRuns + 1 > plan.runLimit) {
        throw new ApiError("USAGE_LIMIT_EXCEEDED", "이번 기간의 실행 한도를 초과했습니다.", 429);
      }
      if (Number.isFinite(plan.keywordLookupLimit) && completedKeywords + reservedKeywords + input.keywords.length > plan.keywordLookupLimit) {
        throw new ApiError("USAGE_LIMIT_EXCEEDED", "이번 기간의 키워드 조회 한도를 초과했습니다.", 429);
      }
      const run = workspace.collection("runs").doc();
      const runInput = workspace.collection("runInputs").doc(run.id);
      const reservation = workspace.collection("usageReservations").doc(run.id);
      const timestamp = FieldValue.serverTimestamp();
      transaction.set(run, {
        projectId: input.projectId,
        tool: "brand-search",
        toolLabel: "브랜드 검색량",
        status: "queued",
        inputSummary: { brand: input.brand, keywordCount: input.keywords.length, displayPeriodDays: input.displayPeriodDays },
        requestId,
        requestDocumentId: idempotency.id,
        usagePeriod: period,
        attempt: 0,
        maxAttempts: 3,
        retryable: true,
        inputId: runInput.id,
        usageReservationId: reservation.id,
        createdAt: timestamp
      });
      transaction.set(runInput, {
        projectId: input.projectId,
        brand: input.brand,
        competitors: input.competitors,
        keywords: input.keywords,
        displayPeriodDays: input.displayPeriodDays,
        roundingUnit: input.roundingUnit,
        createdAt: timestamp
      });
      transaction.set(reservation, {
        runId: run.id,
        status: "reserved",
        runs: 1,
        keywordLookups: input.keywords.length,
        usagePeriod: period,
        createdAt: timestamp,
        updatedAt: timestamp
      });
      transaction.set(usage, {
        runsReserved: reservedRuns + 1,
        keywordLookupsReserved: reservedKeywords + input.keywords.length,
        runs: completedRuns,
        keywordLookups: completedKeywords,
        succeeded: Number(currentUsage.succeeded || 0),
        failed: Number(currentUsage.failed || 0),
        updatedAt: timestamp
      }, { merge: true });
      transaction.set(idempotency, { runId: run.id, status: "queued", requestDigest: digest, createdAt: timestamp });
      return { runId: run.id, status: "queued", reused: false };
    });
  }
};

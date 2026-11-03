import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { ApiError, privateIdempotencyId, requestDigest } from "./domain.mjs";
import { createRunRepository } from "./run-repository.mjs";
import { reserveUsageCapacity } from "./usage-policy.mjs";
import { assertUsableSubscription, resolveBrandSearchPlan } from "./subscription-policy.mjs";
import { assertAutomationAllowed } from "./automation-control-policy.mjs";
import { PAID_PLANS } from "./plan-catalog.mjs";
import { weeklyAdReportDigest } from "./weekly-ad-report.mjs";
import { collabYouTubeDigest } from "./collab-youtube.mjs";

if (!getApps().length) initializeApp();
export const database = getFirestore();
export const serverTimestamp = () => FieldValue.serverTimestamp();
export const runLifecycleRepository = createRunRepository({ database, serverTimestamp });
export const tokenIssuer = getAuth();

function usagePeriod(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit" })
    .format(now)
    .slice(0, 7);
}

export const verifyIdToken = token => tokenIssuer.verifyIdToken(token, true);

export const repository = {
  listBrandSearchRuns: input => runLifecycleRepository.listBrandSearchRuns(input),
  cancelBrandSearchRun: input => runLifecycleRepository.cancelBrandSearchRun(input),
  getBrandSearchRun: input => runLifecycleRepository.getBrandSearchRun(input),
  getBrandSearchReport: input => runLifecycleRepository.getBrandSearchReport(input),

  async createProject({ workspaceId, uid, input }) {
    const workspace = database.doc(`workspaces/${workspaceId}`);
    const subscription = workspace.collection("subscriptions").doc("current");
    const projects = workspace.collection("projects");
    return database.runTransaction(async transaction => {
      const [workspaceSnapshot, subscriptionSnapshot] = await Promise.all([
        transaction.get(workspace), transaction.get(subscription)
      ]);
      if (!workspaceSnapshot.exists || workspaceSnapshot.data().ownerUid !== uid) {
        throw new ApiError("AUTH_REQUIRED", "워크스페이스 권한을 확인할 수 없습니다.", 403);
      }
      const plan = resolveBrandSearchPlan(subscriptionSnapshot.exists ? subscriptionSnapshot.data() : null);
      const existing = await transaction.get(projects.limit(plan.projectLimit));
      if (existing.size >= plan.projectLimit) {
        throw new ApiError("PROJECT_LIMIT_EXCEEDED", `이 요금제는 프로젝트를 ${plan.projectLimit}개까지 만들 수 있습니다.`, 409);
      }
      const project = projects.doc();
      const timestamp = FieldValue.serverTimestamp();
      transaction.create(project, { ...input, createdAt: timestamp, updatedAt: timestamp });
      return { projectId: project.id, projectLimit: plan.projectLimit };
    });
  },

  async saveWeeklyAdReport({ workspaceId, uid, input }) {
    const workspace = database.doc(`workspaces/${workspaceId}`);
    const project = workspace.collection("projects").doc(input.projectId);
    const subscription = workspace.collection("subscriptions").doc("current");
    const access = workspace.collection("serverControls").doc("access");
    const control = database.doc("systemControls/automation");
    const usage = workspace.collection("usage").doc(usagePeriod());
    const idempotency = workspace.collection("runRequests").doc(privateIdempotencyId(uid, input.idempotencyKey));
    const digest = weeklyAdReportDigest(input);
    return database.runTransaction(async transaction => {
      const [workspaceSnapshot, projectSnapshot, subscriptionSnapshot, accessSnapshot, controlSnapshot, usageSnapshot, requestSnapshot] =
        await Promise.all([workspace, project, subscription, access, control, usage, idempotency].map(ref => transaction.get(ref)));
      assertAutomationAllowed(controlSnapshot.exists ? controlSnapshot.data() : null);
      if (!workspaceSnapshot.exists || workspaceSnapshot.data().ownerUid !== uid) {
        throw new ApiError("AUTH_REQUIRED", "워크스페이스 권한을 확인할 수 없습니다.", 403);
      }
      if (!projectSnapshot.exists) throw new ApiError("INVALID_INPUT", "프로젝트를 찾을 수 없습니다.", 404);
      if (accessSnapshot.exists && accessSnapshot.data().blocked === true) {
        throw new ApiError("AUTH_REQUIRED", "현재 실행할 수 없는 계정입니다.", 403);
      }
      const active = assertUsableSubscription(subscriptionSnapshot.exists ? subscriptionSnapshot.data() : null);
      const catalogPlan = PAID_PLANS[active.planId];
      if (!catalogPlan) throw new ApiError("SUBSCRIPTION_REQUIRED", "주간 광고 결과 저장은 유료 구독에서 사용할 수 있습니다.", 403);
      if (requestSnapshot.exists) {
        const previous = requestSnapshot.data();
        if (previous.requestDigest !== digest) throw new ApiError("INVALID_INPUT", "같은 요청 식별자를 다른 결과에 사용할 수 없습니다.", 409);
        return { runId: previous.runId, reused: true };
      }
      const capacity = reserveUsageCapacity({ plan: catalogPlan, usage: usageSnapshot.data() || {}, requestedKeywords: 0, allowZeroKeywords: true });
      const run = workspace.collection("runs").doc();
      const report = workspace.collection("reports").doc(run.id);
      const timestamp = FieldValue.serverTimestamp();
      transaction.set(run, {
        projectId: input.projectId, tool: "weekly-ad", toolLabel: "주간 광고 분석", status: "succeeded",
        inputSummary: `${input.sourceName} · ${input.analysis.rowCount}행`, reportId: report.id,
        usagePeriod: usage.id, createdAt: timestamp, completedAt: timestamp
      });
      transaction.set(report, {
        projectId: input.projectId, runId: run.id, tool: "weekly-ad", status: "ready", title: "주간 광고 분석",
        summary: `광고비 ${Math.round(input.analysis.total.cost).toLocaleString("ko-KR")}원 · ROAS ${input.analysis.total.roas.toFixed(1)}%`,
        sourceName: input.sourceName, sheet: input.sheet, analysisMode: "브라우저 계산·고객 제출",
        analysis: input.analysis, createdAt: timestamp
      });
      transaction.set(usage, {
        runs: capacity.runs + 1, succeeded: capacity.succeeded + 1,
        runsReserved: capacity.runsReserved, keywordLookups: capacity.keywordLookups,
        keywordLookupsReserved: capacity.keywordLookupsReserved, failed: capacity.failed,
        updatedAt: timestamp
      }, { merge: true });
      transaction.set(idempotency, { runId: run.id, status: "succeeded", requestDigest: digest, createdAt: timestamp });
      return { runId: run.id, reused: false };
    });
  },

  async reserveCollabYouTubeRun({ workspaceId, uid, input }) {
    const workspace = database.doc(`workspaces/${workspaceId}`);
    const project = workspace.collection("projects").doc(input.projectId);
    const subscription = workspace.collection("subscriptions").doc("current");
    const access = workspace.collection("serverControls").doc("access");
    const control = database.doc("systemControls/automation");
    const credential = workspace.collection("providerCredentials").doc("youtube");
    const usage = workspace.collection("usage").doc(usagePeriod());
    const request = workspace.collection("runRequests").doc(privateIdempotencyId(uid, input.idempotencyKey));
    const digest = collabYouTubeDigest(input);
    return database.runTransaction(async transaction => {
      const [owner, projectDoc, planDoc, accessDoc, controlDoc, credentialDoc, usageDoc, requestDoc] =
        await Promise.all([workspace, project, subscription, access, control, credential, usage, request].map(ref => transaction.get(ref)));
      assertAutomationAllowed(controlDoc.exists ? controlDoc.data() : null);
      if (!owner.exists || owner.data().ownerUid !== uid) throw new ApiError("AUTH_REQUIRED", "워크스페이스 권한을 확인할 수 없습니다.", 403);
      if (!projectDoc.exists) throw new ApiError("INVALID_INPUT", "프로젝트를 찾을 수 없습니다.", 404);
      if (accessDoc.exists && accessDoc.data().blocked === true) throw new ApiError("AUTH_REQUIRED", "현재 실행할 수 없는 계정입니다.", 403);
      const active = assertUsableSubscription(planDoc.exists ? planDoc.data() : null);
      const plan = PAID_PLANS[active.planId];
      if (!plan) throw new ApiError("SUBSCRIPTION_REQUIRED", "협업 게시물 조회는 유료 구독에서 사용할 수 있습니다.", 403);
      if (requestDoc.exists) {
        const previous = requestDoc.data();
        if (previous.requestDigest !== digest) throw new ApiError("INVALID_INPUT", "같은 요청 식별자를 다른 게시물에 사용할 수 없습니다.", 409);
        return { runId: previous.runId, status: previous.status, reused: true };
      }
      if (!credentialDoc.exists || credentialDoc.data().status !== "active" || !credentialDoc.data().ciphertext) {
        throw new ApiError("PROVIDER_CREDENTIAL_REQUIRED", "YouTube API 키 연결이 필요합니다.", 409);
      }
      const capacity = reserveUsageCapacity({ plan, usage: usageDoc.data() || {}, requestedKeywords: 0, allowZeroKeywords: true });
      const run = workspace.collection("runs").doc();
      const reservation = workspace.collection("usageReservations").doc(run.id);
      const timestamp = FieldValue.serverTimestamp();
      transaction.set(run, {
        projectId: input.projectId, tool: "collab-post", toolLabel: "협업 게시물 성과 조회", status: "running",
        platform: "YouTube", inputSummary: input.url, usagePeriod: usage.id, requestDocumentId: request.id,
        createdAt: timestamp, startedAt: timestamp
      });
      transaction.set(reservation, { runId: run.id, status: "reserved", runs: 1, keywordLookups: 0, usagePeriod: usage.id, createdAt: timestamp });
      transaction.set(usage, { runsReserved: capacity.nextRunsReserved, updatedAt: timestamp }, { merge: true });
      transaction.set(request, { runId: run.id, status: "running", requestDigest: digest, createdAt: timestamp });
      return { runId: run.id, status: "running", reused: false, envelope: credentialDoc.data() };
    });
  },

  async finishCollabYouTubeRun({ workspaceId, runId, post, errorCode, providerCalled }) {
    const workspace = database.doc(`workspaces/${workspaceId}`);
    const run = workspace.collection("runs").doc(runId);
    const reservation = workspace.collection("usageReservations").doc(runId);
    return database.runTransaction(async transaction => {
      const [runDoc, reservationDoc] = await Promise.all([transaction.get(run), transaction.get(reservation)]);
      if (!runDoc.exists || !reservationDoc.exists || runDoc.data().tool !== "collab-post") throw new ApiError("INVALID_INPUT", "실행을 찾을 수 없습니다.", 404);
      if (runDoc.data().status !== "running" || reservationDoc.data().status !== "reserved") return { status: runDoc.data().status, reused: true };
      const usage = workspace.collection("usage").doc(reservationDoc.data().usagePeriod);
      const usageDoc = await transaction.get(usage);
      const current = usageDoc.data() || {};
      const runsReserved = Number(current.runsReserved || 0);
      if (!Number.isSafeInteger(runsReserved) || runsReserved < 1) throw new ApiError("USAGE_STATE_INVALID", "사용량 상태를 확인할 수 없습니다.", 503);
      const succeeded = Boolean(post);
      const timestamp = FieldValue.serverTimestamp();
      if (succeeded) transaction.set(workspace.collection("reports").doc(runId), {
        runId, projectId: runDoc.data().projectId, tool: "collab-post", status: "ready", title: "협업 게시물 성과 조회",
        summary: `YouTube · 조회수 ${post.views == null ? "미제공" : post.views.toLocaleString("ko-KR")}`,
        post, capturedAt: post.capturedAt, createdAt: timestamp
      });
      transaction.set(usage, {
        runsReserved: runsReserved - 1, runs: Number(current.runs || 0) + 1,
        succeeded: Number(current.succeeded || 0) + Number(succeeded), failed: Number(current.failed || 0) + Number(!succeeded),
        youtubeCalls: Number(current.youtubeCalls || 0) + Number(providerCalled), updatedAt: timestamp
      }, { merge: true });
      transaction.set(reservation, { status: "committed", actualRuns: 1, youtubeCalls: Number(providerCalled), updatedAt: timestamp }, { merge: true });
      transaction.set(run, { status: succeeded ? "succeeded" : "failed", resultReportId: succeeded ? runId : null,
        errorCode: succeeded ? null : errorCode || "PROVIDER_UNAVAILABLE", completedAt: timestamp, updatedAt: timestamp }, { merge: true });
      transaction.set(workspace.collection("runRequests").doc(runDoc.data().requestDocumentId), {
        status: succeeded ? "succeeded" : "failed", updatedAt: timestamp
      }, { merge: true });
      return { status: succeeded ? "succeeded" : "failed", reused: false };
    });
  },

  async reserveBrandSearchRun({ workspaceId, uid, input, requestId }) {
    const workspace = database.doc(`workspaces/${workspaceId}`);
    const automationControl = database.doc("systemControls/automation");
    const project = workspace.collection("projects").doc(input.projectId);
    const access = workspace.collection("serverControls").doc("access");
    const subscription = workspace.collection("subscriptions").doc("current");
    const credential = workspace.collection("providerCredentials").doc("naver-searchad");
    const period = usagePeriod();
    const usage = workspace.collection("usage").doc(period);
    const idempotency = workspace.collection("runRequests").doc(privateIdempotencyId(uid, input.idempotencyKey));
    const digest = requestDigest(input);

    return database.runTransaction(async transaction => {
      const [automationSnapshot, workspaceSnapshot, projectSnapshot, accessSnapshot, subscriptionSnapshot, credentialSnapshot, usageSnapshot, requestSnapshot] =
        await Promise.all([automationControl, workspace, project, access, subscription, credential, usage, idempotency].map(ref => transaction.get(ref)));
      assertAutomationAllowed(automationSnapshot.exists ? automationSnapshot.data() : null);
      if (!workspaceSnapshot.exists || workspaceSnapshot.data().ownerUid !== uid) {
        throw new ApiError("AUTH_REQUIRED", "워크스페이스 권한을 확인할 수 없습니다.", 403);
      }
      if (!projectSnapshot.exists) throw new ApiError("INVALID_INPUT", "프로젝트를 찾을 수 없습니다.", 404);
      if (accessSnapshot.exists && accessSnapshot.data().blocked === true) {
        throw new ApiError("AUTH_REQUIRED", "현재 실행할 수 없는 계정입니다.", 403);
      }
      const plan = resolveBrandSearchPlan(subscriptionSnapshot.exists ? subscriptionSnapshot.data() : null);
      if (!credentialSnapshot.exists || credentialSnapshot.data().status !== "active" || !credentialSnapshot.data().ciphertext) {
        throw new ApiError("PROVIDER_CREDENTIAL_REQUIRED", "네이버 검색광고 API 연결이 필요합니다.", 409);
      }
      if (requestSnapshot.exists) {
        const existing = requestSnapshot.data();
        if (existing.requestDigest !== digest) throw new ApiError("INVALID_INPUT", "같은 멱등키를 다른 요청에 사용할 수 없습니다.", 409);
        return { runId: existing.runId, status: existing.status || "queued", reused: true };
      }
      const currentUsage = usageSnapshot.data() || {};
      const capacity = reserveUsageCapacity({ plan, usage: currentUsage, requestedKeywords: input.keywords.length });
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
        runsReserved: capacity.nextRunsReserved,
        keywordLookupsReserved: capacity.nextKeywordLookupsReserved,
        runs: capacity.runs,
        keywordLookups: capacity.keywordLookups,
        succeeded: capacity.succeeded,
        failed: capacity.failed,
        updatedAt: timestamp
      }, { merge: true });
      transaction.set(idempotency, { runId: run.id, status: "queued", requestDigest: digest, createdAt: timestamp });
      return { runId: run.id, status: "queued", reused: false };
    });
  }
};

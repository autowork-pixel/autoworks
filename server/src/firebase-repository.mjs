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
import { collabInstagramDigest } from "./collab-instagram.mjs";
import { contentReferenceDigest } from "./content-reference.mjs";
import { influencerCandidateDigest } from "./influencer-candidate.mjs";
import { aiBlogDigest } from "./ai-blog.mjs";
import { naverVisibilityDigest } from "./naver-search-visibility.mjs";

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

  async reserveCollabInstagramRun({ workspaceId, uid, input }) {
    const workspace = database.doc(`workspaces/${workspaceId}`);
    const project = workspace.collection("projects").doc(input.projectId);
    const subscription = workspace.collection("subscriptions").doc("current");
    const access = workspace.collection("serverControls").doc("access");
    const control = database.doc("systemControls/automation");
    const credential = workspace.collection("providerCredentials").doc("apify");
    const usage = workspace.collection("usage").doc(usagePeriod());
    const request = workspace.collection("runRequests").doc(privateIdempotencyId(uid, input.idempotencyKey));
    const digest = collabInstagramDigest(input);
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
        throw new ApiError("PROVIDER_CREDENTIAL_REQUIRED", "Apify API 토큰 연결이 필요합니다.", 409);
      }
      const capacity = reserveUsageCapacity({ plan, usage: usageDoc.data() || {}, requestedKeywords: 0, allowZeroKeywords: true });
      const run = workspace.collection("runs").doc();
      const reservation = workspace.collection("usageReservations").doc(run.id);
      const timestamp = FieldValue.serverTimestamp();
      transaction.set(run, {
        projectId: input.projectId, tool: "collab-post", toolLabel: "협업 게시물 성과 조회", status: "running",
        platform: "Instagram", inputSummary: input.url, usagePeriod: usage.id, requestDocumentId: request.id,
        createdAt: timestamp, startedAt: timestamp
      });
      transaction.set(reservation, { runId: run.id, status: "reserved", runs: 1, keywordLookups: 0, usagePeriod: usage.id, createdAt: timestamp });
      transaction.set(usage, { runsReserved: capacity.nextRunsReserved, updatedAt: timestamp }, { merge: true });
      transaction.set(request, { runId: run.id, status: "running", requestDigest: digest, createdAt: timestamp });
      return { runId: run.id, status: "running", reused: false, envelope: credentialDoc.data() };
    });
  },

  async finishCollabInstagramRun({ workspaceId, runId, post, errorCode, providerCalled }) {
    const workspace = database.doc(`workspaces/${workspaceId}`);
    const run = workspace.collection("runs").doc(runId);
    const reservation = workspace.collection("usageReservations").doc(runId);
    return database.runTransaction(async transaction => {
      const [runDoc, reservationDoc] = await Promise.all([transaction.get(run), transaction.get(reservation)]);
      if (!runDoc.exists || !reservationDoc.exists || runDoc.data().tool !== "collab-post" || runDoc.data().platform !== "Instagram") {
        throw new ApiError("INVALID_INPUT", "실행을 찾을 수 없습니다.", 404);
      }
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
        summary: `Instagram · ${post.views == null ? "조회수 미제공" : `조회수 ${post.views.toLocaleString("ko-KR")}`}`,
        post, capturedAt: post.capturedAt, createdAt: timestamp
      });
      transaction.set(usage, {
        runsReserved: runsReserved - 1, runs: Number(current.runs || 0) + 1,
        succeeded: Number(current.succeeded || 0) + Number(succeeded), failed: Number(current.failed || 0) + Number(!succeeded),
        apifyCalls: Number(current.apifyCalls || 0) + Number(providerCalled), updatedAt: timestamp
      }, { merge: true });
      transaction.set(reservation, { status: "committed", actualRuns: 1, apifyCalls: Number(providerCalled), updatedAt: timestamp }, { merge: true });
      transaction.set(run, { status: succeeded ? "succeeded" : "failed", resultReportId: succeeded ? runId : null,
        errorCode: succeeded ? null : errorCode || "PROVIDER_UNAVAILABLE", completedAt: timestamp, updatedAt: timestamp }, { merge: true });
      transaction.set(workspace.collection("runRequests").doc(runDoc.data().requestDocumentId), {
        status: succeeded ? "succeeded" : "failed", updatedAt: timestamp
      }, { merge: true });
      return { status: succeeded ? "succeeded" : "failed", reused: false };
    });
  },

  async reserveContentReferenceRun({ workspaceId, uid, input }) {
    const workspace = database.doc(`workspaces/${workspaceId}`);
    const project = workspace.collection("projects").doc(input.projectId);
    const subscription = workspace.collection("subscriptions").doc("current");
    const access = workspace.collection("serverControls").doc("access");
    const control = database.doc("systemControls/automation");
    const credential = workspace.collection("providerCredentials").doc("youtube");
    const usage = workspace.collection("usage").doc(usagePeriod());
    const request = workspace.collection("runRequests").doc(privateIdempotencyId(uid, input.idempotencyKey));
    const digest = contentReferenceDigest(input);
    return database.runTransaction(async transaction => {
      const [owner, projectDoc, planDoc, accessDoc, controlDoc, credentialDoc, usageDoc, requestDoc] =
        await Promise.all([workspace, project, subscription, access, control, credential, usage, request].map(ref => transaction.get(ref)));
      assertAutomationAllowed(controlDoc.exists ? controlDoc.data() : null);
      if (!owner.exists || owner.data().ownerUid !== uid) throw new ApiError("AUTH_REQUIRED", "워크스페이스 권한을 확인할 수 없습니다.", 403);
      if (!projectDoc.exists) throw new ApiError("INVALID_INPUT", "프로젝트를 찾을 수 없습니다.", 404);
      if (accessDoc.exists && accessDoc.data().blocked === true) throw new ApiError("AUTH_REQUIRED", "현재 실행할 수 없는 계정입니다.", 403);
      const active = assertUsableSubscription(planDoc.exists ? planDoc.data() : null);
      const plan = PAID_PLANS[active.planId];
      if (!plan) throw new ApiError("SUBSCRIPTION_REQUIRED", "화제 콘텐츠 레퍼런스는 유료 구독에서 사용할 수 있습니다.", 403);
      if (requestDoc.exists) {
        const previous = requestDoc.data();
        if (previous.requestDigest !== digest) throw new ApiError("INVALID_INPUT", "같은 요청 식별자를 다른 조건에 사용할 수 없습니다.", 409);
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
        projectId: input.projectId, tool: "content-reference", toolLabel: "화제 콘텐츠 레퍼런스", status: "running",
        inputSummary: { brand: input.brand, category: input.category, periodDays: input.periodDays, collectCount: input.collectCount },
        usagePeriod: usage.id, requestDocumentId: request.id, createdAt: timestamp, startedAt: timestamp
      });
      transaction.set(reservation, { runId: run.id, status: "reserved", runs: 1, keywordLookups: 0, usagePeriod: usage.id, createdAt: timestamp });
      transaction.set(usage, { runsReserved: capacity.nextRunsReserved, updatedAt: timestamp }, { merge: true });
      transaction.set(request, { runId: run.id, status: "running", requestDigest: digest, createdAt: timestamp });
      return { runId: run.id, status: "running", reused: false, envelope: credentialDoc.data() };
    });
  },

  async finishContentReferenceRun({ workspaceId, runId, result, errorCode, providerCalled }) {
    const workspace = database.doc(`workspaces/${workspaceId}`);
    const run = workspace.collection("runs").doc(runId);
    const reservation = workspace.collection("usageReservations").doc(runId);
    return database.runTransaction(async transaction => {
      const [runDoc, reservationDoc] = await Promise.all([transaction.get(run), transaction.get(reservation)]);
      if (!runDoc.exists || !reservationDoc.exists || runDoc.data().tool !== "content-reference") throw new ApiError("INVALID_INPUT", "실행을 찾을 수 없습니다.", 404);
      if (runDoc.data().status !== "running" || reservationDoc.data().status !== "reserved") return { status: runDoc.data().status, reused: true };
      const usage = workspace.collection("usage").doc(reservationDoc.data().usagePeriod);
      const usageDoc = await transaction.get(usage);
      const current = usageDoc.data() || {};
      const runsReserved = Number(current.runsReserved || 0);
      if (!Number.isSafeInteger(runsReserved) || runsReserved < 1) throw new ApiError("USAGE_STATE_INVALID", "사용량 상태를 확인할 수 없습니다.", 503);
      const succeeded = Boolean(result?.rows?.length);
      const timestamp = FieldValue.serverTimestamp();
      if (succeeded) transaction.set(workspace.collection("reports").doc(runId), {
        runId, projectId: runDoc.data().projectId, tool: "content-reference", status: "ready", title: "화제 콘텐츠 레퍼런스",
        query: result.query, publishedAfter: result.publishedAfter, capturedAt: result.capturedAt,
        summary: `${result.rows.length}개 공개 영상 수집`, rows: result.rows, createdAt: timestamp
      });
      transaction.set(usage, {
        runsReserved: runsReserved - 1, runs: Number(current.runs || 0) + 1,
        succeeded: Number(current.succeeded || 0) + Number(succeeded), failed: Number(current.failed || 0) + Number(!succeeded),
        youtubeSearchAttempts: Number(current.youtubeSearchAttempts || 0) + Number(providerCalled),
        youtubeCalls: Number(current.youtubeCalls || 0) + (succeeded ? 2 : 0),
        youtubeQuotaUnits: Number(current.youtubeQuotaUnits || 0) + (succeeded ? 101 : 0), updatedAt: timestamp
      }, { merge: true });
      transaction.set(reservation, { status: "committed", actualRuns: 1, youtubeSearchAttempts: Number(providerCalled),
        youtubeCalls: succeeded ? 2 : 0, youtubeQuotaUnits: succeeded ? 101 : 0, updatedAt: timestamp }, { merge: true });
      transaction.set(run, { status: succeeded ? "succeeded" : "failed", resultReportId: succeeded ? runId : null,
        succeededItems: succeeded ? result.rows.length : 0, failedItems: succeeded ? 0 : 1,
        errorCode: succeeded ? null : errorCode || "PROVIDER_UNAVAILABLE", completedAt: timestamp, updatedAt: timestamp }, { merge: true });
      transaction.set(workspace.collection("runRequests").doc(runDoc.data().requestDocumentId), { status: succeeded ? "succeeded" : "failed", updatedAt: timestamp }, { merge: true });
      return { status: succeeded ? "succeeded" : "failed", reused: false };
    });
  },

  async reserveInfluencerCandidateRun({ workspaceId, uid, input }) {
    const workspace = database.doc(`workspaces/${workspaceId}`), project = workspace.collection("projects").doc(input.projectId), subscription = workspace.collection("subscriptions").doc("current"), access = workspace.collection("serverControls").doc("access"), control = database.doc("systemControls/automation"), credential = workspace.collection("providerCredentials").doc("youtube"), usage = workspace.collection("usage").doc(usagePeriod()), request = workspace.collection("runRequests").doc(privateIdempotencyId(uid, input.idempotencyKey));
    const digest = influencerCandidateDigest(input);
    return database.runTransaction(async transaction => {
      const [owner, projectDoc, planDoc, accessDoc, controlDoc, credentialDoc, usageDoc, requestDoc] = await Promise.all([workspace, project, subscription, access, control, credential, usage, request].map(ref => transaction.get(ref)));
      assertAutomationAllowed(controlDoc.exists ? controlDoc.data() : null);
      if (!owner.exists || owner.data().ownerUid !== uid) throw new ApiError("AUTH_REQUIRED", "워크스페이스 권한을 확인할 수 없습니다.", 403);
      if (!projectDoc.exists) throw new ApiError("INVALID_INPUT", "프로젝트를 찾을 수 없습니다.", 404);
      if (accessDoc.exists && accessDoc.data().blocked === true) throw new ApiError("AUTH_REQUIRED", "현재 실행할 수 없는 계정입니다.", 403);
      const active = assertUsableSubscription(planDoc.exists ? planDoc.data() : null), plan = PAID_PLANS[active.planId];
      if (!plan) throw new ApiError("SUBSCRIPTION_REQUIRED", "인플루언서 후보 찾기는 유료 구독에서 사용할 수 있습니다.", 403);
      if (requestDoc.exists) { const previous = requestDoc.data(); if (previous.requestDigest !== digest) throw new ApiError("INVALID_INPUT", "같은 요청 식별자를 다른 조건에 사용할 수 없습니다.", 409); return { runId: previous.runId, status: previous.status, reused: true }; }
      if (!credentialDoc.exists || credentialDoc.data().status !== "active" || !credentialDoc.data().ciphertext) throw new ApiError("PROVIDER_CREDENTIAL_REQUIRED", "YouTube API 키 연결이 필요합니다.", 409);
      const capacity = reserveUsageCapacity({ plan, usage: usageDoc.data() || {}, requestedKeywords: 0, allowZeroKeywords: true }), run = workspace.collection("runs").doc(), reservation = workspace.collection("usageReservations").doc(run.id), timestamp = FieldValue.serverTimestamp();
      transaction.set(run, { projectId: input.projectId, tool: "influencer-candidate", toolLabel: "인플루언서 후보 찾기", status: "running", inputSummary: { brand: input.brand, subscriberMin: input.subscriberMin, subscriberMax: input.subscriberMax, candidateCount: input.candidateCount }, usagePeriod: usage.id, requestDocumentId: request.id, createdAt: timestamp, startedAt: timestamp });
      transaction.set(reservation, { runId: run.id, status: "reserved", runs: 1, keywordLookups: 0, usagePeriod: usage.id, createdAt: timestamp });
      transaction.set(usage, { runsReserved: capacity.nextRunsReserved, updatedAt: timestamp }, { merge: true });
      transaction.set(request, { runId: run.id, status: "running", requestDigest: digest, createdAt: timestamp });
      return { runId: run.id, status: "running", reused: false, envelope: credentialDoc.data() };
    });
  },

  async finishInfluencerCandidateRun({ workspaceId, runId, result, errorCode, providerCalled }) {
    const workspace = database.doc(`workspaces/${workspaceId}`), run = workspace.collection("runs").doc(runId), reservation = workspace.collection("usageReservations").doc(runId);
    return database.runTransaction(async transaction => {
      const [runDoc, reservationDoc] = await Promise.all([transaction.get(run), transaction.get(reservation)]);
      if (!runDoc.exists || !reservationDoc.exists || runDoc.data().tool !== "influencer-candidate") throw new ApiError("INVALID_INPUT", "실행을 찾을 수 없습니다.", 404);
      if (runDoc.data().status !== "running" || reservationDoc.data().status !== "reserved") return { status: runDoc.data().status, reused: true };
      const usage = workspace.collection("usage").doc(reservationDoc.data().usagePeriod), usageDoc = await transaction.get(usage), current = usageDoc.data() || {}, runsReserved = Number(current.runsReserved || 0);
      if (!Number.isSafeInteger(runsReserved) || runsReserved < 1) throw new ApiError("USAGE_STATE_INVALID", "사용량 상태를 확인할 수 없습니다.", 503);
      const succeeded = Boolean(result?.rows?.length), timestamp = FieldValue.serverTimestamp();
      if (succeeded) transaction.set(workspace.collection("reports").doc(runId), { runId, projectId: runDoc.data().projectId, tool: "influencer-candidate", status: "ready", title: "인플루언서 후보", query: result.query, capturedAt: result.capturedAt, summary: `${result.rows.length}개 공개 채널 후보`, rows: result.rows, createdAt: timestamp });
      transaction.set(usage, { runsReserved: runsReserved - 1, runs: Number(current.runs || 0) + 1, succeeded: Number(current.succeeded || 0) + Number(succeeded), failed: Number(current.failed || 0) + Number(!succeeded), youtubeChannelSearchAttempts: Number(current.youtubeChannelSearchAttempts || 0) + Number(providerCalled), youtubeCalls: Number(current.youtubeCalls || 0) + (succeeded ? 2 : 0), youtubeQuotaUnits: Number(current.youtubeQuotaUnits || 0) + (succeeded ? 101 : 0), updatedAt: timestamp }, { merge: true });
      transaction.set(reservation, { status: "committed", actualRuns: 1, youtubeChannelSearchAttempts: Number(providerCalled), youtubeCalls: succeeded ? 2 : 0, youtubeQuotaUnits: succeeded ? 101 : 0, updatedAt: timestamp }, { merge: true });
      transaction.set(run, { status: succeeded ? "succeeded" : "failed", resultReportId: succeeded ? runId : null, succeededItems: succeeded ? result.rows.length : 0, failedItems: succeeded ? 0 : 1, errorCode: succeeded ? null : errorCode || "PROVIDER_UNAVAILABLE", completedAt: timestamp, updatedAt: timestamp }, { merge: true });
      transaction.set(workspace.collection("runRequests").doc(runDoc.data().requestDocumentId), { status: succeeded ? "succeeded" : "failed", updatedAt: timestamp }, { merge: true });
      return { status: succeeded ? "succeeded" : "failed", reused: false };
    });
  },

  async reserveAiBlogRun({ workspaceId, uid, input }) {
    const workspace = database.doc(`workspaces/${workspaceId}`), project = workspace.collection("projects").doc(input.projectId), subscription = workspace.collection("subscriptions").doc("current"), access = workspace.collection("serverControls").doc("access"), control = database.doc("systemControls/automation"), credential = workspace.collection("providerCredentials").doc("openai"), usage = workspace.collection("usage").doc(usagePeriod()), request = workspace.collection("runRequests").doc(privateIdempotencyId(uid, input.idempotencyKey));
    const digest = aiBlogDigest(input);
    return database.runTransaction(async transaction => {
      const [owner, projectDoc, planDoc, accessDoc, controlDoc, credentialDoc, usageDoc, requestDoc] = await Promise.all([workspace, project, subscription, access, control, credential, usage, request].map(ref => transaction.get(ref)));
      assertAutomationAllowed(controlDoc.exists ? controlDoc.data() : null);
      if (!owner.exists || owner.data().ownerUid !== uid) throw new ApiError("AUTH_REQUIRED", "워크스페이스 권한을 확인할 수 없습니다.", 403);
      if (!projectDoc.exists) throw new ApiError("INVALID_INPUT", "프로젝트를 찾을 수 없습니다.", 404);
      if (accessDoc.exists && accessDoc.data().blocked === true) throw new ApiError("AUTH_REQUIRED", "현재 실행할 수 없는 계정입니다.", 403);
      const active = assertUsableSubscription(planDoc.exists ? planDoc.data() : null), plan = PAID_PLANS[active.planId];
      if (!plan) throw new ApiError("SUBSCRIPTION_REQUIRED", "AI 블로그 초안은 유료 구독에서 사용할 수 있습니다.", 403);
      if (requestDoc.exists) { const previous = requestDoc.data(); if (previous.requestDigest !== digest) throw new ApiError("INVALID_INPUT", "같은 요청 식별자를 다른 조건에 사용할 수 없습니다.", 409); return { runId: previous.runId, status: previous.status, reused: true }; }
      if (!credentialDoc.exists || credentialDoc.data().status !== "active" || !credentialDoc.data().ciphertext) throw new ApiError("PROVIDER_CREDENTIAL_REQUIRED", "OpenAI API 키 연결이 필요합니다.", 409);
      const capacity = reserveUsageCapacity({ plan, usage: usageDoc.data() || {}, requestedKeywords: 0, allowZeroKeywords: true }), run = workspace.collection("runs").doc(), reservation = workspace.collection("usageReservations").doc(run.id), timestamp = FieldValue.serverTimestamp();
      transaction.set(run, { projectId: input.projectId, tool: "ai-blog", toolLabel: "AI 블로그 초안", status: "running", inputSummary: { topic: input.topic, contentType: input.contentType, tone: input.tone, targetLength: input.targetLength }, usagePeriod: usage.id, requestDocumentId: request.id, createdAt: timestamp, startedAt: timestamp });
      transaction.set(reservation, { runId: run.id, status: "reserved", runs: 1, keywordLookups: 0, usagePeriod: usage.id, createdAt: timestamp });
      transaction.set(usage, { runsReserved: capacity.nextRunsReserved, updatedAt: timestamp }, { merge: true });
      transaction.set(request, { runId: run.id, status: "running", requestDigest: digest, createdAt: timestamp });
      return { runId: run.id, status: "running", reused: false, envelope: credentialDoc.data() };
    });
  },

  async finishAiBlogRun({ workspaceId, runId, result, errorCode, providerCalled }) {
    const workspace = database.doc(`workspaces/${workspaceId}`), run = workspace.collection("runs").doc(runId), reservation = workspace.collection("usageReservations").doc(runId);
    return database.runTransaction(async transaction => {
      const [runDoc, reservationDoc] = await Promise.all([transaction.get(run), transaction.get(reservation)]);
      if (!runDoc.exists || !reservationDoc.exists || runDoc.data().tool !== "ai-blog") throw new ApiError("INVALID_INPUT", "실행을 찾을 수 없습니다.", 404);
      if (runDoc.data().status !== "running" || reservationDoc.data().status !== "reserved") return { status: runDoc.data().status, reused: true };
      const usage = workspace.collection("usage").doc(reservationDoc.data().usagePeriod), usageDoc = await transaction.get(usage), current = usageDoc.data() || {}, runsReserved = Number(current.runsReserved || 0);
      if (!Number.isSafeInteger(runsReserved) || runsReserved < 1) throw new ApiError("USAGE_STATE_INVALID", "사용량 상태를 확인할 수 없습니다.", 503);
      const succeeded = Boolean(result?.draft), timestamp = FieldValue.serverTimestamp(), inputTokens = succeeded && Number.isSafeInteger(result.inputTokens) ? result.inputTokens : 0, outputTokens = succeeded && Number.isSafeInteger(result.outputTokens) ? result.outputTokens : 0;
      if (succeeded) transaction.set(workspace.collection("reports").doc(runId), { runId, projectId: runDoc.data().projectId, tool: "ai-blog", status: "ready", title: "AI 블로그 초안", summary: runDoc.data().inputSummary.topic, draft: result.draft, model: result.model, generatedAt: result.generatedAt, inputTokens: result.inputTokens, outputTokens: result.outputTokens, reviewRequired: true, createdAt: timestamp });
      transaction.set(usage, { runsReserved: runsReserved - 1, runs: Number(current.runs || 0) + 1, succeeded: Number(current.succeeded || 0) + Number(succeeded), failed: Number(current.failed || 0) + Number(!succeeded), openAiAttempts: Number(current.openAiAttempts || 0) + Number(providerCalled), openAiInputTokens: Number(current.openAiInputTokens || 0) + inputTokens, openAiOutputTokens: Number(current.openAiOutputTokens || 0) + outputTokens, updatedAt: timestamp }, { merge: true });
      transaction.set(reservation, { status: "committed", actualRuns: 1, openAiAttempts: Number(providerCalled), inputTokens, outputTokens, updatedAt: timestamp }, { merge: true });
      transaction.set(run, { status: succeeded ? "succeeded" : "failed", resultReportId: succeeded ? runId : null, errorCode: succeeded ? null : errorCode || "PROVIDER_UNAVAILABLE", completedAt: timestamp, updatedAt: timestamp }, { merge: true });
      transaction.set(workspace.collection("runRequests").doc(runDoc.data().requestDocumentId), { status: succeeded ? "succeeded" : "failed", updatedAt: timestamp }, { merge: true });
      return { status: succeeded ? "succeeded" : "failed", reused: false };
    });
  },

  async reserveNaverVisibilityRun({ workspaceId, uid, input }) {
    const workspace=database.doc(`workspaces/${workspaceId}`),project=workspace.collection("projects").doc(input.projectId),subscription=workspace.collection("subscriptions").doc("current"),access=workspace.collection("serverControls").doc("access"),control=database.doc("systemControls/automation"),credential=workspace.collection("providerCredentials").doc("naver-search"),usage=workspace.collection("usage").doc(usagePeriod()),request=workspace.collection("runRequests").doc(privateIdempotencyId(uid,input.idempotencyKey));const digest=naverVisibilityDigest(input);
    return database.runTransaction(async transaction=>{const[owner,projectDoc,planDoc,accessDoc,controlDoc,credentialDoc,usageDoc,requestDoc]=await Promise.all([workspace,project,subscription,access,control,credential,usage,request].map(ref=>transaction.get(ref)));assertAutomationAllowed(controlDoc.exists?controlDoc.data():null);if(!owner.exists||owner.data().ownerUid!==uid)throw new ApiError("AUTH_REQUIRED","워크스페이스 권한을 확인할 수 없습니다.",403);if(!projectDoc.exists)throw new ApiError("INVALID_INPUT","프로젝트를 찾을 수 없습니다.",404);if(accessDoc.exists&&accessDoc.data().blocked===true)throw new ApiError("AUTH_REQUIRED","현재 실행할 수 없는 계정입니다.",403);const active=assertUsableSubscription(planDoc.exists?planDoc.data():null),plan=PAID_PLANS[active.planId];if(!plan)throw new ApiError("SUBSCRIPTION_REQUIRED","네이버 검색 노출 점검은 유료 구독에서 사용할 수 있습니다.",403);if(requestDoc.exists){const previous=requestDoc.data();if(previous.requestDigest!==digest)throw new ApiError("INVALID_INPUT","같은 요청 식별자를 다른 조건에 사용할 수 없습니다.",409);return{runId:previous.runId,status:previous.status,reused:true}}if(!credentialDoc.exists||credentialDoc.data().status!=="active"||!credentialDoc.data().ciphertext)throw new ApiError("PROVIDER_CREDENTIAL_REQUIRED","네이버 검색 API 연결이 필요합니다.",409);const capacity=reserveUsageCapacity({plan,usage:usageDoc.data()||{},requestedKeywords:input.keywords.length}),run=workspace.collection("runs").doc(),reservation=workspace.collection("usageReservations").doc(run.id),timestamp=FieldValue.serverTimestamp();transaction.set(run,{projectId:input.projectId,tool:"naver-visibility",toolLabel:"네이버 검색 노출 점검",status:"running",inputSummary:{brand:input.brand,keywordCount:input.keywords.length,resultCount:input.resultCount},usagePeriod:usage.id,requestDocumentId:request.id,createdAt:timestamp,startedAt:timestamp});transaction.set(reservation,{runId:run.id,status:"reserved",runs:1,keywordLookups:input.keywords.length,usagePeriod:usage.id,createdAt:timestamp});transaction.set(usage,{runsReserved:capacity.nextRunsReserved,keywordLookupsReserved:capacity.nextKeywordLookupsReserved,updatedAt:timestamp},{merge:true});transaction.set(request,{runId:run.id,status:"running",requestDigest:digest,createdAt:timestamp});return{runId:run.id,status:"running",reused:false,envelope:credentialDoc.data()}});
  },

  async finishNaverVisibilityRun({ workspaceId, runId, result, errorCode, providerCalled }) {
    const workspace=database.doc(`workspaces/${workspaceId}`),run=workspace.collection("runs").doc(runId),reservation=workspace.collection("usageReservations").doc(runId);return database.runTransaction(async transaction=>{const[runDoc,reservationDoc]=await Promise.all([transaction.get(run),transaction.get(reservation)]);if(!runDoc.exists||!reservationDoc.exists||runDoc.data().tool!=="naver-visibility")throw new ApiError("INVALID_INPUT","실행을 찾을 수 없습니다.",404);if(runDoc.data().status!=="running"||reservationDoc.data().status!=="reserved")return{status:runDoc.data().status,reused:true};const usage=workspace.collection("usage").doc(reservationDoc.data().usagePeriod),usageDoc=await transaction.get(usage),current=usageDoc.data()||{},runsReserved=Number(current.runsReserved||0),lookupsReserved=Number(current.keywordLookupsReserved||0),keywordLookups=Number(reservationDoc.data().keywordLookups||0);if(!Number.isSafeInteger(runsReserved)||runsReserved<1||!Number.isSafeInteger(lookupsReserved)||lookupsReserved<keywordLookups)throw new ApiError("USAGE_STATE_INVALID","사용량 상태를 확인할 수 없습니다.",503);const succeeded=Boolean(result?.rows?.length),timestamp=FieldValue.serverTimestamp(),calls=succeeded?Number(result.providerCalls||0):0;if(succeeded)transaction.set(workspace.collection("reports").doc(runId),{runId,projectId:runDoc.data().projectId,tool:"naver-visibility",status:"ready",title:"네이버 검색 노출 점검",summary:`${result.rows.length}개 키워드 · 블로그/웹문서 API`,scope:result.scope,capturedAt:result.capturedAt,rows:result.rows,reviewRequired:true,createdAt:timestamp});transaction.set(usage,{runsReserved:runsReserved-1,keywordLookupsReserved:lookupsReserved-keywordLookups,runs:Number(current.runs||0)+1,keywordLookups:Number(current.keywordLookups||0)+keywordLookups,succeeded:Number(current.succeeded||0)+Number(succeeded),failed:Number(current.failed||0)+Number(!succeeded),naverSearchAttempts:Number(current.naverSearchAttempts||0)+Number(providerCalled),naverSearchCalls:Number(current.naverSearchCalls||0)+calls,updatedAt:timestamp},{merge:true});transaction.set(reservation,{status:"committed",actualRuns:1,actualKeywordLookups:keywordLookups,naverSearchAttempts:Number(providerCalled),naverSearchCalls:calls,updatedAt:timestamp},{merge:true});transaction.set(run,{status:succeeded?"succeeded":"failed",resultReportId:succeeded?runId:null,errorCode:succeeded?null:errorCode||"PROVIDER_UNAVAILABLE",completedAt:timestamp,updatedAt:timestamp},{merge:true});transaction.set(workspace.collection("runRequests").doc(runDoc.data().requestDocumentId),{status:succeeded?"succeeded":"failed",updatedAt:timestamp},{merge:true});return{status:succeeded?"succeeded":"failed",reused:false}});
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

import { createHash } from "node:crypto";
import { ApiError } from "./domain.mjs";

const terminalStates = new Set(["succeeded", "failed", "canceled"]);

function snapshotId(runId, keyword) {
  return createHash("sha256").update(`${runId}:${String(keyword).trim().toLocaleLowerCase("ko-KR")}`).digest("hex");
}

function assertLease(run, workerId, now) {
  const expiry = run.leaseExpiresAt instanceof Date ? run.leaseExpiresAt.getTime() : run.leaseExpiresAt?.toDate?.().getTime();
  if (run.leaseOwner !== workerId || !expiry || expiry <= now.getTime()) {
    throw new ApiError("RUN_LEASE_CONFLICT", "실행 작업 권한이 만료되었거나 다른 작업자가 처리 중입니다.", 409);
  }
}

function usageValues(value = {}) {
  return {
    runsReserved: Number(value.runsReserved || 0), keywordLookupsReserved: Number(value.keywordLookupsReserved || 0),
    runs: Number(value.runs || 0), keywordLookups: Number(value.keywordLookups || 0),
    succeeded: Number(value.succeeded || 0), failed: Number(value.failed || 0)
  };
}

export function createRunRepository({ database, serverTimestamp, now = () => new Date(), leaseMs = 60_000 }) {
  const workspace = workspaceId => database.doc(`workspaces/${workspaceId}`);

  return {
    async markRunning(workspaceId, runId, { workerId }) {
      const runRef = workspace(workspaceId).collection("runs").doc(runId);
      return database.runTransaction(async transaction => {
        const snapshot = await transaction.get(runRef);
        if (!snapshot.exists) throw new ApiError("INVALID_INPUT", "실행을 찾을 수 없습니다.", 404);
        const run = snapshot.data();
        if (terminalStates.has(run.status)) return { status: run.status, reused: true };
        const current = now();
        const currentExpiry = run.leaseExpiresAt instanceof Date ? run.leaseExpiresAt.getTime() : run.leaseExpiresAt?.toDate?.().getTime();
        if (run.status === "running" && run.leaseOwner !== workerId && currentExpiry > current.getTime()) {
          throw new ApiError("RUN_LEASE_CONFLICT", "다른 작업자가 실행 중입니다.", 409);
        }
        if (!["queued", "retrying", "running"].includes(run.status)) throw new ApiError("INVALID_INPUT", "실행 상태를 시작할 수 없습니다.", 409);
        transaction.set(runRef, {
          status: "running", leaseOwner: workerId, leaseExpiresAt: new Date(current.getTime() + leaseMs),
          attempt: Number(run.attempt || 0) + (run.status === "running" && run.leaseOwner === workerId ? 0 : 1),
          startedAt: run.startedAt || serverTimestamp(), updatedAt: serverTimestamp()
        }, { merge: true });
        return { status: "running", reused: false };
      });
    },

    async completeRun(workspaceId, runId, payload) {
      const root = workspace(workspaceId);
      const runRef = root.collection("runs").doc(runId);
      const reservationRef = root.collection("usageReservations").doc(runId);
      return database.runTransaction(async transaction => {
        const [runSnapshot, reservationSnapshot] = await Promise.all([transaction.get(runRef), transaction.get(reservationRef)]);
        if (!runSnapshot.exists || !reservationSnapshot.exists) throw new ApiError("INVALID_INPUT", "실행 예약을 찾을 수 없습니다.", 404);
        const run = runSnapshot.data();
        if (run.status === "succeeded") return { status: "succeeded", reused: true };
        if (terminalStates.has(run.status)) throw new ApiError("INVALID_INPUT", "이미 종료된 실행입니다.", 409);
        assertLease(run, payload.workerId, now());
        const reservation = reservationSnapshot.data();
        const usageRef = root.collection("usage").doc(reservation.usagePeriod);
        const usageSnapshot = await transaction.get(usageRef);
        const usage = usageValues(usageSnapshot.data());
        const timestamp = serverTimestamp();
        const reportRef = root.collection("reports").doc(runId);
        for (const item of payload.snapshots) {
          transaction.set(root.collection("searchSnapshots").doc(snapshotId(runId, item.keyword)), {
            runId, projectId: run.projectId, keyword: item.keyword, pc: item.pc, mobile: item.mobile, total: item.total, recordedAt: item.recordedAt, createdAt: timestamp
          });
        }
        transaction.set(reportRef, {
          projectId: run.projectId, runId, title: `${run.inputSummary?.brand || "브랜드"} 검색량 결과`, status: "ready",
          summary: { succeededKeywords: payload.succeededKeywords, failedKeywords: payload.failedKeywords, failures: payload.failures }, createdAt: timestamp
        });
        transaction.set(usageRef, {
          runsReserved: Math.max(0, usage.runsReserved - Number(reservation.runs || 1)),
          keywordLookupsReserved: Math.max(0, usage.keywordLookupsReserved - Number(reservation.keywordLookups || 0)),
          runs: usage.runs + 1, keywordLookups: usage.keywordLookups + payload.keywordLookups,
          succeeded: usage.succeeded + 1, failed: usage.failed, updatedAt: timestamp
        }, { merge: true });
        transaction.set(reservationRef, { status: "committed", actualRuns: 1, actualKeywordLookups: payload.keywordLookups, updatedAt: timestamp }, { merge: true });
        transaction.set(runRef, {
          status: "succeeded", resultReportId: reportRef.id, succeededKeywords: payload.succeededKeywords, failedKeywords: payload.failedKeywords,
          completedAt: timestamp, updatedAt: timestamp, leaseOwner: null, leaseExpiresAt: null
        }, { merge: true });
        if (run.requestDocumentId) transaction.set(root.collection("runRequests").doc(run.requestDocumentId), { status: "succeeded", updatedAt: timestamp }, { merge: true });
        return { status: "succeeded", reused: false };
      });
    },

    async failRun(workspaceId, runId, payload) {
      const root = workspace(workspaceId);
      const runRef = root.collection("runs").doc(runId);
      const reservationRef = root.collection("usageReservations").doc(runId);
      return database.runTransaction(async transaction => {
        const [runSnapshot, reservationSnapshot] = await Promise.all([transaction.get(runRef), transaction.get(reservationRef)]);
        if (!runSnapshot.exists || !reservationSnapshot.exists) throw new ApiError("INVALID_INPUT", "실행 예약을 찾을 수 없습니다.", 404);
        const run = runSnapshot.data();
        if (run.status === "failed") return { status: "failed", reused: true };
        if (terminalStates.has(run.status)) throw new ApiError("INVALID_INPUT", "이미 종료된 실행입니다.", 409);
        assertLease(run, payload.workerId, now());
        const reservation = reservationSnapshot.data();
        const usageRef = root.collection("usage").doc(reservation.usagePeriod);
        const usageSnapshot = await transaction.get(usageRef);
        const usage = usageValues(usageSnapshot.data());
        const timestamp = serverTimestamp();
        transaction.set(usageRef, {
          runsReserved: Math.max(0, usage.runsReserved - Number(reservation.runs || 1)),
          keywordLookupsReserved: Math.max(0, usage.keywordLookupsReserved - Number(reservation.keywordLookups || 0)),
          runs: usage.runs + 1, keywordLookups: usage.keywordLookups + payload.keywordLookups,
          succeeded: usage.succeeded, failed: usage.failed + 1, updatedAt: timestamp
        }, { merge: true });
        transaction.set(reservationRef, { status: "committed", actualRuns: 1, actualKeywordLookups: payload.keywordLookups, updatedAt: timestamp }, { merge: true });
        transaction.set(runRef, {
          status: "failed", errorCode: payload.errorCode, failureSummary: payload.failures,
          completedAt: timestamp, updatedAt: timestamp, leaseOwner: null, leaseExpiresAt: null
        }, { merge: true });
        if (run.requestDocumentId) transaction.set(root.collection("runRequests").doc(run.requestDocumentId), { status: "failed", updatedAt: timestamp }, { merge: true });
        return { status: "failed", reused: false };
      });
    }
  };
}

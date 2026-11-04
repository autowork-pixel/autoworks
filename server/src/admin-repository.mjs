import { ApiError } from "./domain.mjs";

export function createAdminRepository({ database, serverTimestamp }) {
  return {
    async getAutomationControl() {
      const control = database.doc("systemControls/automation");
      return database.runTransaction(async transaction => {
        const snapshot = await transaction.get(control);
        const data = snapshot.exists ? snapshot.data() : {};
        return { blocked: data.blocked === true, reason: typeof data.reason === "string" ? data.reason : null, source: typeof data.source === "string" ? data.source : null, updatedAt: data.updatedAt || null };
      });
    },

    async listAutomationAudits({ limit = 20 }) {
      const snapshot = await database.doc("systemControls/automation").collection("auditLogs").orderBy("createdAt", "desc").limit(limit).get();
      return snapshot.docs.map(document => {
        const data = document.data();
        return {
          id: document.id,
          action: typeof data.action === "string" ? data.action : "automation.unknown",
          actorUid: typeof data.actorUid === "string" ? data.actorUid : null,
          reason: typeof data.reason === "string" ? data.reason : null,
          beforeSummary: { blocked: data.beforeSummary?.blocked === true },
          afterSummary: { blocked: data.afterSummary?.blocked === true },
          createdAt: data.createdAt || null
        };
      });
    },

    async setAutomationBlocked({ blocked, reason, actorUid, requestId }) {
      const control = database.doc("systemControls/automation"), audit = control.collection("auditLogs").doc();
      return database.runTransaction(async transaction => {
        const snapshot = await transaction.get(control);
        const before = snapshot.exists && snapshot.data().blocked === true;
        if (before === blocked) return { blocked, reused: true };
        const timestamp = serverTimestamp();
        transaction.set(control, { blocked, reason, source: "admin", updatedBy: actorUid, updatedAt: timestamp }, { merge: true });
        transaction.set(audit, {
          action: blocked ? "automation.blocked" : "automation.resumed", actorUid, actorRole: "admin", targetType: "system", targetId: "automation",
          reason, requestId, beforeSummary: { blocked: before }, afterSummary: { blocked }, createdAt: timestamp
        });
        return { blocked, reused: false };
      });
    },

    async setWorkspaceBlocked({ workspaceId, blocked, reason, actorUid, requestId }) {
      const workspace = database.doc(`workspaces/${workspaceId}`), access = workspace.collection("serverControls").doc("access"), audit = workspace.collection("auditLogs").doc();
      return database.runTransaction(async transaction => {
        const [workspaceSnapshot, accessSnapshot] = await Promise.all([transaction.get(workspace), transaction.get(access)]);
        if (!workspaceSnapshot.exists) throw new ApiError("INVALID_INPUT", "워크스페이스를 찾을 수 없습니다.", 404);
        const before = accessSnapshot.exists && accessSnapshot.data().blocked === true, timestamp = serverTimestamp();
        if (before === blocked) return { blocked, reused: true };
        transaction.set(access, { blocked, reason, updatedBy: actorUid, updatedAt: timestamp }, { merge: true });
        transaction.set(audit, {
          action: blocked ? "customer.blocked" : "customer.unblocked", actorUid, actorRole: "admin", targetType: "workspace", targetId: workspaceId,
          reason, requestId, beforeSummary: { blocked: before }, afterSummary: { blocked }, createdAt: timestamp
        });
        return { blocked, reused: false };
      });
    },

    async answerInquiry({ workspaceId, inquiryId, reply, actorUid, requestId }) {
      const workspace = database.doc(`workspaces/${workspaceId}`), inquiry = workspace.collection("inquiries").doc(inquiryId), audit = workspace.collection("auditLogs").doc();
      return database.runTransaction(async transaction => {
        const [workspaceSnapshot, inquirySnapshot] = await Promise.all([transaction.get(workspace), transaction.get(inquiry)]);
        if (!workspaceSnapshot.exists || !inquirySnapshot.exists) throw new ApiError("INVALID_INPUT", "문의를 찾을 수 없습니다.", 404);
        const before = inquirySnapshot.data();
        if (before.status === "answered" && before.reply === reply) return { status: "answered", reused: true };
        if (!["open", "reviewing", "answered"].includes(before.status)) throw new ApiError("INVALID_INPUT", "종료된 문의에는 답변할 수 없습니다.", 409);
        const timestamp = serverTimestamp();
        transaction.set(inquiry, { reply, status: "answered", respondedAt: timestamp, updatedAt: timestamp }, { merge: true });
        transaction.set(audit, {
          action: "inquiry.answered", actorUid, actorRole: "admin", targetType: "inquiry", targetId: inquiryId,
          requestId, beforeSummary: { status: before.status || null }, afterSummary: { status: "answered" }, createdAt: timestamp
        });
        return { status: "answered", reused: false };
      });
    },

    async updateInquiryStatus({ workspaceId, inquiryId, status, reason, actorUid, requestId }) {
      const workspace = database.doc(`workspaces/${workspaceId}`), inquiry = workspace.collection("inquiries").doc(inquiryId), audit = workspace.collection("auditLogs").doc();
      return database.runTransaction(async transaction => {
        const [workspaceSnapshot, inquirySnapshot] = await Promise.all([transaction.get(workspace), transaction.get(inquiry)]);
        if (!workspaceSnapshot.exists || !inquirySnapshot.exists) throw new ApiError("INVALID_INPUT", "문의를 찾을 수 없습니다.", 404);
        const before = inquirySnapshot.data(), transitions = { open: ["reviewing", "closed"], reviewing: ["closed"], answered: ["closed"], closed: [] };
        if (before.status === status) return { status, reused: true };
        if (!transitions[before.status]?.includes(status)) throw new ApiError("INVALID_INPUT", "허용되지 않은 문의 상태 전이입니다.", 409);
        const timestamp = serverTimestamp();
        transaction.set(inquiry, { status, updatedAt: timestamp }, { merge: true });
        transaction.set(audit, {
          action: `inquiry.${status}`, actorUid, actorRole: "admin", targetType: "inquiry", targetId: inquiryId,
          reason, requestId, beforeSummary: { status: before.status }, afterSummary: { status }, createdAt: timestamp
        });
        return { status, reused: false };
      });
    }
  };
}

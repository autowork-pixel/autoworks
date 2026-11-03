import { ApiError } from "./domain.mjs";

export function createAdminRepository({ database, serverTimestamp }) {
  return {
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
        const timestamp = serverTimestamp();
        transaction.set(inquiry, { reply, status: "answered", respondedAt: timestamp, updatedAt: timestamp }, { merge: true });
        transaction.set(audit, {
          action: "inquiry.answered", actorUid, actorRole: "admin", targetType: "inquiry", targetId: inquiryId,
          requestId, beforeSummary: { status: before.status || null }, afterSummary: { status: "answered" }, createdAt: timestamp
        });
        return { status: "answered", reused: false };
      });
    }
  };
}

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
    }
  };
}

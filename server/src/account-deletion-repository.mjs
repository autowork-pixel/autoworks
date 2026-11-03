import { ApiError } from "./domain.mjs";

export function createAccountDeletionRepository({ database, serverTimestamp }) {
  return {
    async requestDeletion({ workspaceId, uid, requestId }) {
      const workspace = database.doc(`workspaces/${workspaceId}`);
      const request = workspace.collection("deletionRequests").doc("current");
      const access = workspace.collection("serverControls").doc("access");
      const audit = workspace.collection("auditLogs").doc();
      return database.runTransaction(async transaction => {
        const [workspaceSnapshot, requestSnapshot] = await Promise.all([transaction.get(workspace), transaction.get(request)]);
        if (!workspaceSnapshot.exists || workspaceSnapshot.data().ownerUid !== uid) {
          throw new ApiError("AUTH_REQUIRED", "워크스페이스 권한을 확인할 수 없습니다.", 403);
        }
        const before = requestSnapshot.exists ? requestSnapshot.data() : null;
        if (before?.status === "pending") return { status: "pending", reused: true };
        if (before?.status === "completed") throw new ApiError("INVALID_INPUT", "이미 처리된 탈퇴 요청입니다.", 409);
        const timestamp = serverTimestamp();
        transaction.set(request, { status: "pending", requestedBy: uid, requestedAt: timestamp, updatedAt: timestamp });
        transaction.set(access, { blocked: true, reason: "account-deletion-requested", updatedBy: uid, updatedAt: timestamp }, { merge: true });
        transaction.set(audit, {
          action: "account.deletion_requested", actorUid: uid, actorRole: "owner", targetType: "workspace", targetId: workspaceId,
          requestId, beforeSummary: { status: before?.status || null }, afterSummary: { status: "pending", blocked: true }, createdAt: timestamp
        });
        return { status: "pending", reused: false };
      });
    }
  };
}

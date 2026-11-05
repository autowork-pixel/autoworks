export function createAccountDeletionPurgeRepository({ database, serverTimestamp }) {
  if (!database || !serverTimestamp) throw new Error("Account deletion purge repository configuration is incomplete");

  return {
    async listPending(limit = 20) {
      const safeLimit = Math.max(1, Math.min(50, Number(limit) || 20));
      const snapshot = await database.collectionGroup("deletionRequests")
        .where("status", "==", "pending")
        .limit(safeLimit)
        .get();
      return snapshot.docs.filter(document => document.id === "current").map(document => ({
        workspaceId: document.ref.parent.parent?.id || "",
        credentialsDeletedAt: document.data().credentialsDeletedAt || null
      })).filter(item => item.workspaceId && !item.credentialsDeletedAt);
    },

    async purgeCredentials(workspaceId) {
      const workspace = database.doc(`workspaces/${workspaceId}`);
      const request = workspace.collection("deletionRequests").doc("current");
      const snapshot = await workspace.collection("providerCredentials").get();
      const batch = database.batch();
      for (const document of snapshot.docs) batch.delete(document.ref);
      const timestamp = serverTimestamp();
      batch.set(request, { stage: "credentials_deleted", credentialsDeletedAt: timestamp, updatedAt: timestamp }, { merge: true });
      batch.set(workspace.collection("auditLogs").doc(), {
        action: "account.credentials_deleted", actorRole: "system", targetType: "workspace", targetId: workspaceId,
        afterSummary: { status: "pending", stage: "credentials_deleted", deletedCredentialCount: snapshot.size }, createdAt: timestamp
      });
      await batch.commit();
      return { deletedCredentialCount: snapshot.size };
    }
  };
}


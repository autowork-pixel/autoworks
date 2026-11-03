import { ApiError } from "./domain.mjs";

function credentialDocument(document, timestamp) {
  return {
    algorithm: document.algorithm,
    ciphertext: document.ciphertext,
    iv: document.iv,
    authTag: document.authTag,
    encryptedDataKey: document.encryptedDataKey,
    keyVersion: document.keyVersion,
    apiKeyHint: document.apiKeyHint,
    status: document.status,
    updatedAt: timestamp
  };
}

export function createCredentialRepository({ database, serverTimestamp }) {
  async function ownedTransaction({ workspaceId, uid, provider, operation }) {
    const workspace = database.doc(`workspaces/${workspaceId}`);
    const credential = workspace.collection("providerCredentials").doc(provider);
    const audit = workspace.collection("auditLogs").doc();
    return database.runTransaction(async transaction => {
      const workspaceSnapshot = await transaction.get(workspace);
      if (!workspaceSnapshot.exists || workspaceSnapshot.data().ownerUid !== uid) {
        throw new ApiError("AUTH_REQUIRED", "워크스페이스 권한을 확인할 수 없습니다.", 403);
      }
      return operation({ transaction, credential, audit, timestamp: serverTimestamp() });
    });
  }

  return {
    saveCredential({ workspaceId, uid, provider, document }) {
      return ownedTransaction({ workspaceId, uid, provider, operation: async ({ transaction, credential, audit, timestamp }) => {
        const before = await transaction.get(credential);
        transaction.set(credential, credentialDocument(document, timestamp));
        transaction.set(audit, {
          action: before.exists ? "provider_credential.rotated" : "provider_credential.connected",
          actorUid: uid,
          actorRole: "customer",
          targetType: "providerCredential",
          targetId: provider,
          reason: "customer_request",
          beforeSummary: { status: before.exists ? before.data().status || "unknown" : "disconnected" },
          afterSummary: { status: "active", apiKeyHint: document.apiKeyHint },
          createdAt: timestamp
        });
      } });
    },

    deleteCredential({ workspaceId, uid, provider }) {
      return ownedTransaction({ workspaceId, uid, provider, operation: async ({ transaction, credential, audit, timestamp }) => {
        const before = await transaction.get(credential);
        if (before.exists) transaction.delete(credential);
        transaction.set(audit, {
          action: "provider_credential.disconnected",
          actorUid: uid,
          actorRole: "customer",
          targetType: "providerCredential",
          targetId: provider,
          reason: "customer_request",
          beforeSummary: { status: before.exists ? before.data().status || "unknown" : "disconnected" },
          afterSummary: { status: "disconnected" },
          createdAt: timestamp
        });
      } });
    },

    getCredentialStatus({ workspaceId, uid, provider }) {
      return ownedTransaction({ workspaceId, uid, provider, operation: async ({ transaction, credential }) => {
        const snapshot = await transaction.get(credential);
        if (!snapshot.exists) return null;
        const value = snapshot.data();
        return { status: value.status, apiKeyHint: value.apiKeyHint || null, updatedAt: value.updatedAt || null };
      } });
    }
  };
}

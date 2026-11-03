import { createHash } from "node:crypto";

function stateId(state) {
  return createHash("sha256").update(state).digest("hex");
}

export function createOAuthStateStore({ database, serverTimestamp }) {
  const reference = state => database.doc(`oauthStates/${stateId(state)}`);
  return {
    async create({ state, provider, redirectUri, returnOrigin, expiresAt }) {
      await reference(state).create({ provider, redirectUri, returnOrigin, expiresAt: new Date(expiresAt), createdAt: serverTimestamp() });
    },
    async consume(state) {
      return database.runTransaction(async transaction => {
        const ref = reference(state), snapshot = await transaction.get(ref);
        if (!snapshot.exists) return null;
        const value = snapshot.data();
        transaction.delete(ref);
        return { ...value, expiresAt: value.expiresAt?.toMillis?.() ?? value.expiresAt?.getTime?.() ?? 0 };
      });
    }
  };
}

export function createOAuthIdentityStore({ database, serverTimestamp }) {
  return {
    async upsert({ uid, provider, subject, email, displayName }) {
      await database.doc(`users/${uid}`).set({ provider, providerSubject: subject, email: email || null, displayName: displayName || null, updatedAt: serverTimestamp() }, { merge: true });
    }
  };
}

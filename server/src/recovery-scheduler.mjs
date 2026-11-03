export function createRecoveryScheduler({ source, taskDispatcher, now = () => new Date(), staleQueuedMs = 5 * 60_000, batchSize = 100 }) {
  return {
    async runOnce() {
      const current = now();
      const candidates = await source.listRecoverable({
        retryBefore: current, queuedBefore: new Date(current.getTime() - staleQueuedMs), limit: batchSize
      });
      const summary = { scanned: candidates.length, dispatched: 0, reused: 0, failed: 0 };
      for (const candidate of candidates) {
        try {
          const result = await taskDispatcher.dispatch(candidate);
          await source.recordDispatch({ ...candidate, ok: true, reused: Boolean(result.reused), dispatchedAt: current });
          result.reused ? summary.reused++ : summary.dispatched++;
        } catch (error) {
          summary.failed++;
          await source.recordDispatch({ ...candidate, ok: false, errorCode: error?.code || "TASK_DISPATCH_FAILED", dispatchedAt: current });
        }
      }
      return summary;
    }
  };
}

export function createFirestoreRecoverySource({ database, serverTimestamp }) {
  function candidates(snapshot) {
    return snapshot.docs.map(document => ({
      workspaceId: document.ref.parent.parent.id, runId: document.id, status: document.data().status
    }));
  }
  return {
    async listRecoverable({ retryBefore, queuedBefore, limit }) {
      const runs = database.collectionGroup("runs");
      const [retrying, queued] = await Promise.all([
        runs.where("tool", "==", "brand-search").where("status", "==", "retrying").where("nextRetryAt", "<=", retryBefore).limit(limit).get(),
        runs.where("tool", "==", "brand-search").where("status", "==", "queued").where("createdAt", "<=", queuedBefore).limit(limit).get()
      ]);
      const unique = new Map([...candidates(retrying), ...candidates(queued)].map(item => [`${item.workspaceId}:${item.runId}`, item]));
      return [...unique.values()].slice(0, limit);
    },
    async recordDispatch({ workspaceId, runId, ok, reused, errorCode, dispatchedAt }) {
      const runRef = database.doc(`workspaces/${workspaceId}/runs/${runId}`);
      return database.runTransaction(async transaction => {
        const snapshot = await transaction.get(runRef);
        if (!snapshot.exists || !["queued", "retrying"].includes(snapshot.data().status)) return false;
        transaction.set(runRef, {
          lastDispatchAt: dispatchedAt, dispatchUpdatedAt: serverTimestamp(),
          dispatchAttempts: Number(snapshot.data().dispatchAttempts || 0) + 1,
          lastDispatchStatus: ok ? (reused ? "reused" : "created") : "failed",
          lastDispatchErrorCode: ok ? null : errorCode
        }, { merge: true });
        return true;
      });
    }
  };
}

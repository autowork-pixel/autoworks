import { ApiError } from "./domain.mjs";
import { decryptCredentialPayload } from "./credential-crypto.mjs";
import { summarizeAdPerformance } from "./ad-performance.mjs";
import { fetchAdReport } from "./ad-report-client.mjs";

export function createAdReportService({ repository, keyManager, fetchReport = fetchAdReport }) {
  return {
    async run({ workspaceId, uid, input }) {
      const reserved = await repository.reserveAdReportRun({ workspaceId, uid, input });
      if (reserved.reused) return reserved;
      let providerCalled = false;
      try {
        const plaintextDataKey = await keyManager.decryptDataKey({ workspaceId, provider: input.provider,
          encryptedDataKey: reserved.envelope.encryptedDataKey, keyVersion: reserved.envelope.keyVersion });
        let credentials;
        try { credentials = decryptCredentialPayload({ provider: input.provider, envelope: reserved.envelope, plaintextDataKey }); }
        finally { plaintextDataKey.fill(0); }
        providerCalled = true;
        const rows = await fetchReport({ provider: input.provider, input, credentials });
        const result = { provider: input.provider, since: input.since, until: input.until, rows, summary: summarizeAdPerformance(rows) };
        const finished = await repository.finishAdReportRun({ workspaceId, runId: reserved.runId, result, providerCalled });
        return { runId: reserved.runId, status: finished.status, reused: false, ...result };
      } catch (error) {
        const code = error instanceof ApiError ? error.code : "PROVIDER_UNAVAILABLE";
        await repository.finishAdReportRun({ workspaceId, runId: reserved.runId, errorCode: code, providerCalled });
        throw error;
      }
    }
  };
}

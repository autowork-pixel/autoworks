import { ApiError } from "./domain.mjs";
import { decryptCredentialPayload } from "./credential-crypto.mjs";
import { searchInfluencerCandidates } from "./influencer-candidate.mjs";

export function createInfluencerCandidateService({ repository, keyManager, search = searchInfluencerCandidates }) {
  return { async run({ workspaceId, uid, input }) {
    const reserved = await repository.reserveInfluencerCandidateRun({ workspaceId, uid, input });
    if (reserved.reused) return reserved;
    let providerCalled = false;
    try {
      const plaintextDataKey = await keyManager.decryptDataKey({ workspaceId, provider: "youtube", encryptedDataKey: reserved.envelope.encryptedDataKey, keyVersion: reserved.envelope.keyVersion });
      let credentials;
      try { credentials = decryptCredentialPayload({ provider: "youtube", envelope: reserved.envelope, plaintextDataKey }); }
      finally { plaintextDataKey.fill(0); }
      providerCalled = true;
      const result = await search({ input, apiKey: credentials.apiKey });
      const finished = await repository.finishInfluencerCandidateRun({ workspaceId, runId: reserved.runId, result, providerCalled });
      return { runId: reserved.runId, status: finished.status, reused: false, ...result };
    } catch (error) {
      const code = error instanceof ApiError ? error.code : "PROVIDER_UNAVAILABLE";
      await repository.finishInfluencerCandidateRun({ workspaceId, runId: reserved.runId, errorCode: code, providerCalled });
      throw error;
    }
  } };
}

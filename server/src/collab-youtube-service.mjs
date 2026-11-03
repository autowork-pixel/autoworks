import { ApiError } from "./domain.mjs";
import { decryptCredentialPayload } from "./credential-crypto.mjs";
import { fetchYouTubePost } from "./collab-youtube.mjs";

export function createCollabYouTubeService({ repository, keyManager, fetchPost = fetchYouTubePost }) {
  return {
    async run({ workspaceId, uid, input }) {
      const reserved = await repository.reserveCollabYouTubeRun({ workspaceId, uid, input });
      if (reserved.reused) return reserved;
      let providerCalled = false;
      let post;
      try {
        const plaintextDataKey = await keyManager.decryptDataKey({
          workspaceId, provider: "youtube", encryptedDataKey: reserved.envelope.encryptedDataKey,
          keyVersion: reserved.envelope.keyVersion
        });
        let credentials;
        try { credentials = decryptCredentialPayload({ provider: "youtube", envelope: reserved.envelope, plaintextDataKey }); }
        finally { plaintextDataKey.fill(0); }
        providerCalled = true;
        post = await fetchPost({ videoId: input.videoId, apiKey: credentials.apiKey });
      } catch (error) {
        const code = error instanceof ApiError ? error.code : "PROVIDER_UNAVAILABLE";
        await repository.finishCollabYouTubeRun({ workspaceId, runId: reserved.runId, errorCode: code, providerCalled });
        throw error;
      }
      const finished = await repository.finishCollabYouTubeRun({ workspaceId, runId: reserved.runId, post, providerCalled });
      return { runId: reserved.runId, status: finished.status, reused: false, post };
    }
  };
}

import { ApiError } from "./domain.mjs";
import { decryptCredentialPayload } from "./credential-crypto.mjs";
import { fetchInstagramPost } from "./collab-instagram.mjs";

export function createCollabInstagramService({ repository, keyManager, fetchPost = fetchInstagramPost }) {
  return {
    async run({ workspaceId, uid, input }) {
      const reserved = await repository.reserveCollabInstagramRun({ workspaceId, uid, input });
      if (reserved.reused) return reserved;
      let providerCalled = false;
      let post;
      try {
        const plaintextDataKey = await keyManager.decryptDataKey({
          workspaceId, provider: "apify", encryptedDataKey: reserved.envelope.encryptedDataKey,
          keyVersion: reserved.envelope.keyVersion
        });
        let credentials;
        try { credentials = decryptCredentialPayload({ provider: "apify", envelope: reserved.envelope, plaintextDataKey }); }
        finally { plaintextDataKey.fill(0); }
        providerCalled = true;
        post = await fetchPost({ shortcode: input.shortcode, url: input.url, token: credentials.token });
      } catch (error) {
        const code = error instanceof ApiError ? error.code : "PROVIDER_UNAVAILABLE";
        await repository.finishCollabInstagramRun({ workspaceId, runId: reserved.runId, errorCode: code, providerCalled });
        throw error;
      }
      const finished = await repository.finishCollabInstagramRun({ workspaceId, runId: reserved.runId, post, providerCalled });
      return { runId: reserved.runId, status: finished.status, reused: false, post };
    }
  };
}

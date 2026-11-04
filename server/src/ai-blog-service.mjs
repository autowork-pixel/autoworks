import { ApiError } from "./domain.mjs";
import { decryptCredentialPayload } from "./credential-crypto.mjs";
import { generateAiBlogDraft } from "./ai-blog.mjs";

export function createAiBlogService({ repository, keyManager, model, generate = generateAiBlogDraft }) {
  return { async run({ workspaceId, uid, input }) {
    const reserved = await repository.reserveAiBlogRun({ workspaceId, uid, input });
    if (reserved.reused) return reserved;
    let providerCalled = false;
    try {
      const key = await keyManager.decryptDataKey({ workspaceId, provider: "openai", encryptedDataKey: reserved.envelope.encryptedDataKey, keyVersion: reserved.envelope.keyVersion });
      let credentials;
      try { credentials = decryptCredentialPayload({ provider: "openai", envelope: reserved.envelope, plaintextDataKey: key }); } finally { key.fill(0); }
      providerCalled = true;
      const result = await generate({ input, apiKey: credentials.apiKey, model });
      const finished = await repository.finishAiBlogRun({ workspaceId, runId: reserved.runId, result, providerCalled });
      return { runId: reserved.runId, status: finished.status, reused: false, ...result };
    } catch (error) {
      const code = error instanceof ApiError ? error.code : "PROVIDER_UNAVAILABLE";
      await repository.finishAiBlogRun({ workspaceId, runId: reserved.runId, errorCode: code, providerCalled });
      throw error;
    }
  } };
}

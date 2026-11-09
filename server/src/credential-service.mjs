import { ApiError } from "./domain.mjs";
import { encryptCredentialPayload } from "./credential-crypto.mjs";

const supportedProviders = new Set(["naver-searchad", "naver-search", "youtube", "apify", "openai", "meta-ads", "google-ads", "kakao-moment"]);

const hintFields = Object.freeze({
  "meta-ads": "adAccountId",
  "google-ads": "customerId",
  "kakao-moment": "adAccountId"
});

function providerName(value) {
  if (!supportedProviders.has(value)) throw new ApiError("INVALID_INPUT", "지원하지 않는 API 연결입니다.");
  return value;
}

function keyHint(value) {
  const compact = String(value || "").trim();
  return compact.length <= 4 ? "••••" : `••••${compact.slice(-4)}`;
}

export function createCredentialService({ keyManager, repository, now = () => new Date() }) {
  return {
    async save({ workspaceId, uid, provider, credentials }) {
      const selectedProvider = providerName(provider);
      const generated = await keyManager.generateDataKey({ workspaceId, provider: selectedProvider });
      if (!Buffer.isBuffer(generated?.plaintextDataKey)) throw new Error("Key manager did not return a plaintext data key");
      try {
        const envelope = encryptCredentialPayload({
          credentials, provider: selectedProvider,
          plaintextDataKey: generated.plaintextDataKey,
          encryptedDataKey: generated.encryptedDataKey,
          keyVersion: generated.keyVersion
        });
        const hintValue = credentials[hintFields[selectedProvider]] || credentials.apiKey || credentials.token || credentials.clientId;
        await repository.saveCredential({
          workspaceId,
          uid,
          provider: selectedProvider,
          document: { ...envelope, apiKeyHint: keyHint(hintValue), status: "active", updatedAt: now() }
        });
        return { provider: selectedProvider, status: "active", apiKeyHint: keyHint(hintValue) };
      } finally {
        generated.plaintextDataKey.fill(0);
      }
    },

    async remove({ workspaceId, uid, provider }) {
      const selectedProvider = providerName(provider);
      await repository.deleteCredential({ workspaceId, uid, provider: selectedProvider, deletedAt: now() });
      return { provider: selectedProvider, status: "disconnected" };
    },

    async status({ workspaceId, uid, provider }) {
      const selectedProvider = providerName(provider);
      const value = await repository.getCredentialStatus({ workspaceId, uid, provider: selectedProvider });
      if (!value) return { provider: selectedProvider, status: "disconnected" };
      return { provider: selectedProvider, status: value.status === "active" ? "active" : "attention", apiKeyHint: value.apiKeyHint || null, updatedAt: value.updatedAt || null };
    }
  };
}

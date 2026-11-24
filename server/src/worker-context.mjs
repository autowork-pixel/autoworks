import { ApiError } from "./domain.mjs";
import { decryptCredentialPayload } from "./credential-crypto.mjs";

const terminalStates = new Set(["succeeded", "failed", "canceled"]);
const runnableStates = new Set(["queued", "retrying", "running"]);
const idPattern = /^[A-Za-z0-9_-]{1,128}$/;

export function createWorkerContextRepository({ database }) {
  return {
    async load({ workspaceId, runId }) {
      const root = database.doc(`workspaces/${workspaceId}`);
      const runRef = root.collection("runs").doc(runId);
      return database.runTransaction(async transaction => {
        const runSnapshot = await transaction.get(runRef);
        if (!runSnapshot.exists) throw new ApiError("INVALID_INPUT", "실행을 찾을 수 없습니다.", 404);
        const run = runSnapshot.data();
        if (terminalStates.has(run.status)) return { terminalStatus: run.status };
        if (!runnableStates.has(run.status)) throw new ApiError("INVALID_INPUT", "실행 상태가 올바르지 않습니다.", 409);
        const inputId = run.inputId || runId;
        if (!idPattern.test(inputId)) throw new ApiError("INVALID_INPUT", "실행 입력 참조가 올바르지 않습니다.", 409);
        const inputRef = root.collection("runInputs").doc(inputId);
        const searchAdRef = root.collection("providerCredentials").doc("naver-searchad");
        const searchTrendRef = root.collection("providerCredentials").doc("naver-api-hub");
        const [inputSnapshot, searchAdSnapshot, searchTrendSnapshot] = await Promise.all([
          transaction.get(inputRef), transaction.get(searchAdRef), transaction.get(searchTrendRef)
        ]);
        if (!inputSnapshot.exists) throw new ApiError("INVALID_INPUT", "실행 입력을 찾을 수 없습니다.", 409);
        const input = inputSnapshot.data();
        if (run.projectId && input.projectId !== run.projectId) throw new ApiError("INVALID_INPUT", "실행 입력 소유 관계가 올바르지 않습니다.", 409);
        if (!searchAdSnapshot.exists || searchAdSnapshot.data().status !== "active") throw new ApiError("PROVIDER_CREDENTIAL_REQUIRED", "네이버 검색광고 API 연결이 필요합니다.", 409);
        if (!searchTrendSnapshot.exists || searchTrendSnapshot.data().status !== "active") throw new ApiError("PROVIDER_CREDENTIAL_REQUIRED", "NAVER API HUB 검색어 트렌드 연결이 필요합니다.", 409);
        return { input, envelopes: { searchAd: searchAdSnapshot.data(), searchTrend: searchTrendSnapshot.data() } };
      });
    }
  };
}

export function createWorkerContextLoader({ repository, keyManager }) {
  async function decrypt(envelope, provider, workspaceId) {
    const plaintextDataKey = await keyManager.decryptDataKey({
      encryptedDataKey: envelope.encryptedDataKey, keyVersion: envelope.keyVersion, workspaceId, provider
    });
    if (!Buffer.isBuffer(plaintextDataKey)) throw new Error("Key manager did not return a plaintext data key");
    try {
      return decryptCredentialPayload({ envelope, plaintextDataKey });
    } finally {
      plaintextDataKey.fill(0);
    }
  }
  return {
    async load(ids) {
      const stored = await repository.load(ids);
      if (stored.terminalStatus) return stored;
      return {
        input: stored.input,
        credentials: {
          searchAd: await decrypt(stored.envelopes.searchAd, "naver-searchad", ids.workspaceId),
          searchTrend: await decrypt(stored.envelopes.searchTrend, "naver-api-hub", ids.workspaceId)
        }
      };
    }
  };
}

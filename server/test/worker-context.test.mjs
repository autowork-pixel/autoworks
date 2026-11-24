import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { encryptCredentialPayload } from "../src/credential-crypto.mjs";
import { createWorkerContextLoader, createWorkerContextRepository } from "../src/worker-context.mjs";

class Ref { constructor(database, path) { this.database = database; this.path = path; } collection(name) { return new Collection(this.database, `${this.path}/${name}`); } }
class Collection { constructor(database, path) { this.database = database; this.path = path; } doc(id) { return new Ref(this.database, `${this.path}/${id}`); } }
function fakeDatabase(seed) { const values = new Map(Object.entries(seed)); const database = { doc: path => new Ref(database, path), runTransaction: callback => callback({ get: async ref => { const value = values.get(ref.path); return { exists: values.has(ref.path), data: () => value }; } }) }; return database; }
const runPath = "workspaces/workspace-a/runs/run-a", inputPath = "workspaces/workspace-a/runInputs/run-a";
const searchAdPath = "workspaces/workspace-a/providerCredentials/naver-searchad", searchTrendPath = "workspaces/workspace-a/providerCredentials/naver-api-hub";

test("종료된 실행은 입력과 자격정보를 읽지 않고 기존 상태를 반환한다", async () => {
  const repository = createWorkerContextRepository({ database: fakeDatabase({ [runPath]: { status: "succeeded" } }) });
  assert.deepEqual(await repository.load({ workspaceId: "workspace-a", runId: "run-a" }), { terminalStatus: "succeeded" });
});
test("실행과 입력의 프로젝트가 다르면 자격정보를 반환하지 않는다", async () => {
  const database = fakeDatabase({ [runPath]: { status: "queued", projectId: "project-a", inputId: "run-a" }, [inputPath]: { projectId: "project-b", keywords: ["키워드"] }, [searchAdPath]: { status: "active" }, [searchTrendPath]: { status: "active" } });
  await assert.rejects(() => createWorkerContextRepository({ database }).load({ workspaceId: "workspace-a", runId: "run-a" }), error => error.code === "INVALID_INPUT");
});
test("검색광고와 API HUB 자격정보를 각각 복호화하고 평문 데이터 키를 지운다", async () => {
  const searchAdKey = randomBytes(32), trendKey = randomBytes(32);
  const searchAdEnvelope = encryptCredentialPayload({ credentials: { apiKey: "license", secretKey: "secret", customerId: "123" }, plaintextDataKey: searchAdKey, encryptedDataKey: "wrapped-searchad", keyVersion: "kms-v1" });
  const trendEnvelope = encryptCredentialPayload({ credentials: { clientId: "hub-id", clientSecret: "hub-secret" }, plaintextDataKey: trendKey, encryptedDataKey: "wrapped-trend", keyVersion: "kms-v1", provider: "naver-api-hub" });
  const decryptedKeys = [];
  const database = fakeDatabase({ [runPath]: { status: "queued", projectId: "project-a", inputId: "run-a" }, [inputPath]: { projectId: "project-a", keywords: ["키워드"] }, [searchAdPath]: { ...searchAdEnvelope, status: "active" }, [searchTrendPath]: { ...trendEnvelope, status: "active" } });
  const loader = createWorkerContextLoader({ repository: createWorkerContextRepository({ database }), keyManager: { decryptDataKey: async ({ provider }) => { const key = Buffer.from(provider === "naver-searchad" ? searchAdKey : trendKey); decryptedKeys.push(key); return key; } } });
  const result = await loader.load({ workspaceId: "workspace-a", runId: "run-a" });
  assert.deepEqual(result.credentials.searchAd, { apiKey: "license", secretKey: "secret", customerId: "123" });
  assert.deepEqual(result.credentials.searchTrend, { clientId: "hub-id", clientSecret: "hub-secret" });
  assert.equal(decryptedKeys.every(key => key.every(byte => byte === 0)), true);
});

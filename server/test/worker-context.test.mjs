import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { encryptCredentialPayload } from "../src/credential-crypto.mjs";
import { createWorkerContextLoader, createWorkerContextRepository } from "../src/worker-context.mjs";

class Ref {
  constructor(database, path) { this.database = database; this.path = path; }
  collection(name) { return new Collection(this.database, `${this.path}/${name}`); }
}
class Collection {
  constructor(database, path) { this.database = database; this.path = path; }
  doc(id) { return new Ref(this.database, `${this.path}/${id}`); }
}
function fakeDatabase(seed) {
  const values = new Map(Object.entries(seed));
  const database = {
    doc: path => new Ref(database, path),
    runTransaction: callback => callback({ get: async ref => { const value = values.get(ref.path); return { exists: values.has(ref.path), data: () => value }; } })
  };
  return database;
}

const runPath = "workspaces/workspace-a/runs/run-a";
const inputPath = "workspaces/workspace-a/runInputs/run-a";
const credentialPath = "workspaces/workspace-a/providerCredentials/naver-searchad";

test("종료된 실행은 입력과 자격정보를 읽지 않고 기존 상태를 반환한다", async () => {
  const database = fakeDatabase({ [runPath]: { status: "succeeded" } });
  const repository = createWorkerContextRepository({ database });
  assert.deepEqual(await repository.load({ workspaceId: "workspace-a", runId: "run-a" }), { terminalStatus: "succeeded" });
});

test("실행과 입력의 프로젝트가 다르면 자격정보를 반환하지 않는다", async () => {
  const database = fakeDatabase({
    [runPath]: { status: "queued", projectId: "project-a", inputId: "run-a" },
    [inputPath]: { projectId: "project-b", keywords: ["키워드"] },
    [credentialPath]: { status: "active" }
  });
  const repository = createWorkerContextRepository({ database });
  await assert.rejects(() => repository.load({ workspaceId: "workspace-a", runId: "run-a" }), error => error.code === "INVALID_INPUT");
});

test("같은 워크스페이스의 봉투만 복호화하고 평문 데이터 키를 지운다", async () => {
  const plaintextDataKey = randomBytes(32);
  const envelope = encryptCredentialPayload({
    credentials: { apiKey: "license", secretKey: "secret", customerId: "123" }, plaintextDataKey,
    encryptedDataKey: "wrapped-key", keyVersion: "kms-v1"
  });
  const decryptKey = Buffer.from(plaintextDataKey);
  const database = fakeDatabase({
    [runPath]: { status: "queued", projectId: "project-a", inputId: "run-a" },
    [inputPath]: { projectId: "project-a", keywords: ["키워드"] },
    [credentialPath]: { ...envelope, status: "active" }
  });
  const loader = createWorkerContextLoader({
    repository: createWorkerContextRepository({ database }),
    keyManager: { decryptDataKey: async value => { assert.deepEqual(value, {
      encryptedDataKey: "wrapped-key", keyVersion: "kms-v1", workspaceId: "workspace-a", provider: "naver-searchad"
    }); return decryptKey; } }
  });
  const result = await loader.load({ workspaceId: "workspace-a", runId: "run-a" });
  assert.deepEqual(result.input, { projectId: "project-a", keywords: ["키워드"] });
  assert.deepEqual(result.credentials, { apiKey: "license", secretKey: "secret", customerId: "123" });
  assert.equal(decryptKey.every(byte => byte === 0), true);
});

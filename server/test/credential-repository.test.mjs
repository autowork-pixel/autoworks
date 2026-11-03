import assert from "node:assert/strict";
import test from "node:test";
import { createCredentialRepository } from "../src/credential-repository.mjs";

class Ref {
  constructor(database, path) { this.database = database; this.path = path; }
  collection(name) { return new Collection(this.database, `${this.path}/${name}`); }
}
class Collection {
  constructor(database, path) { this.database = database; this.path = path; }
  doc(id = `auto-${++this.database.sequence}`) { return new Ref(this.database, `${this.path}/${id}`); }
}

function fakeDatabase(seed) {
  const values = new Map(Object.entries(seed));
  const writes = [];
  const database = {
    sequence: 0,
    doc: path => new Ref(database, path),
    runTransaction: callback => callback({
      get: async ref => {
        const exists = values.has(ref.path);
        const value = values.get(ref.path);
        return { exists, data: () => value };
      },
      set: (ref, value) => { values.set(ref.path, value); writes.push(["set", ref.path, value]); },
      delete: ref => { values.delete(ref.path); writes.push(["delete", ref.path]); }
    })
  };
  return { database, values, writes };
}

const envelope = {
  algorithm: "aes-256-gcm", ciphertext: "ciphertext", iv: "iv", authTag: "tag", encryptedDataKey: "wrapped", keyVersion: "kms-v1", apiKeyHint: "••••1234", status: "active"
};

test("소유자만 암호화 봉투를 저장하고 같은 트랜잭션에 비민감 감사 로그를 남긴다", async () => {
  const fake = fakeDatabase({ "workspaces/workspace-a": { ownerUid: "user-a" } });
  const repository = createCredentialRepository({ database: fake.database, serverTimestamp: () => "server-time" });
  await repository.saveCredential({ workspaceId: "workspace-a", uid: "user-a", provider: "naver-searchad", document: envelope });
  const saved = fake.values.get("workspaces/workspace-a/providerCredentials/naver-searchad");
  assert.equal(saved.ciphertext, "ciphertext");
  assert.equal(saved.updatedAt, "server-time");
  const audit = [...fake.values.entries()].find(([path]) => path.includes("/auditLogs/"))[1];
  assert.equal(audit.action, "provider_credential.connected");
  assert.equal(JSON.stringify(audit).includes("ciphertext"), false);
  assert.equal(JSON.stringify(audit).includes("wrapped"), false);
});

test("다른 고객은 상태 조회·저장·삭제를 모두 거부한다", async () => {
  const fake = fakeDatabase({ "workspaces/workspace-a": { ownerUid: "user-a" } });
  const repository = createCredentialRepository({ database: fake.database, serverTimestamp: () => "server-time" });
  for (const action of [
    () => repository.getCredentialStatus({ workspaceId: "workspace-a", uid: "user-b", provider: "naver-searchad" }),
    () => repository.saveCredential({ workspaceId: "workspace-a", uid: "user-b", provider: "naver-searchad", document: envelope }),
    () => repository.deleteCredential({ workspaceId: "workspace-a", uid: "user-b", provider: "naver-searchad" })
  ]) await assert.rejects(action, error => error.code === "AUTH_REQUIRED");
  assert.equal(fake.writes.length, 0);
});

test("상태 조회는 암호문을 반환하지 않고 삭제는 자격정보를 제거한다", async () => {
  const path = "workspaces/workspace-a/providerCredentials/naver-searchad";
  const fake = fakeDatabase({ "workspaces/workspace-a": { ownerUid: "user-a" }, [path]: { ...envelope, updatedAt: "old-time" } });
  const repository = createCredentialRepository({ database: fake.database, serverTimestamp: () => "server-time" });
  assert.deepEqual(await repository.getCredentialStatus({ workspaceId: "workspace-a", uid: "user-a", provider: "naver-searchad" }), { status: "active", apiKeyHint: "••••1234", updatedAt: "old-time" });
  await repository.deleteCredential({ workspaceId: "workspace-a", uid: "user-a", provider: "naver-searchad" });
  assert.equal(fake.values.has(path), false);
  const audit = [...fake.values.entries()].find(([item]) => item.includes("/auditLogs/"))[1];
  assert.equal(audit.action, "provider_credential.disconnected");
});

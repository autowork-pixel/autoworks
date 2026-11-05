import assert from "node:assert/strict";
import { createServer } from "node:http";
import { afterEach, test } from "node:test";
import { createAccountDeletionPurgeHandler } from "../src/account-deletion-purge-handler.mjs";
import { createAccountDeletionPurgeRepository } from "../src/account-deletion-purge-repository.mjs";
import { createAccountDeletionPurgeService } from "../src/account-deletion-purge-service.mjs";

const servers = [];
afterEach(async () => Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve)))));
async function listen(handler) { const server = createServer(handler); servers.push(server); await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); return `http://127.0.0.1:${server.address().port}`; }

test("탈퇴 정리는 API 자격정보만 단계적으로 삭제하고 개별 실패를 격리한다", async () => {
  const purged = [];
  const service = createAccountDeletionPurgeService({ repository: { listPending: async () => [{ workspaceId: "workspace-a" }, { workspaceId: "workspace-b" }], purgeCredentials: async workspaceId => { purged.push(workspaceId); if (workspaceId === "workspace-b") throw new Error("failed"); return { deletedCredentialCount: 3 }; } }, logger: { error() {} } });
  assert.deepEqual(await service.runOnce(), { examined: 2, succeeded: 1, failed: 1, deletedCredentialCount: 3 });
  assert.deepEqual(purged, ["workspace-a", "workspace-b"]);
});

test("검증된 내부 작업 신원만 탈퇴 자격정보 정리를 실행한다", async () => {
  let runs = 0;
  const base = await listen(createAccountDeletionPurgeHandler({ verifyTaskRequest: async () => ({ subject: "scheduler" }), service: { runOnce: async () => { runs += 1; return { examined: 1, succeeded: 1, failed: 0, deletedCredentialCount: 2 }; } } }));
  const response = await fetch(`${base}/internal/v1/account-deletions:purge-credentials`, { method: "POST" });
  assert.equal(response.status, 200); assert.equal((await response.json()).deletedCredentialCount, 2); assert.equal(runs, 1);
});

test("내부 작업 신원 검증 실패 시 탈퇴 정리를 실행하지 않는다", async () => {
  let runs = 0;
  const base = await listen(createAccountDeletionPurgeHandler({ verifyTaskRequest: async () => { throw new Error("invalid"); }, service: { runOnce: async () => { runs += 1; } } }));
  const response = await fetch(`${base}/internal/v1/account-deletions:purge-credentials`, { method: "POST" });
  assert.equal(response.status, 401); assert.equal(runs, 0);
});

test("저장소는 pending 탈퇴의 자격정보만 삭제하고 완료 표식과 비민감 감사 기록을 남긴다", async () => {
  const values = new Map([["workspaces/workspace-a/deletionRequests/current", { status: "pending" }], ["workspaces/workspace-a/providerCredentials/naver-searchad", { ciphertext: "secret-envelope" }], ["workspaces/workspace-a/providerCredentials/openai", { ciphertext: "secret-envelope" }]]);
  class Ref { constructor(path) { this.path = path; this.id = path.split("/").at(-1); } collection(name) { return new Collection(`${this.path}/${name}`); } }
  class Collection { constructor(path) { this.path = path; } doc(id = "audit-1") { return new Ref(`${this.path}/${id}`); } async get() { const docs = [...values.keys()].filter(path => path.startsWith(`${this.path}/`) && path.split("/").length === this.path.split("/").length + 1).map(path => ({ ref: new Ref(path) })); return { docs, size: docs.length }; } }
  const database = { doc: path => new Ref(path), collectionGroup: () => ({ where() { return this; }, limit() { return this; }, async get() { const ref = new Ref("workspaces/workspace-a/deletionRequests/current"); ref.parent = { parent: { id: "workspace-a" } }; return { docs: [{ id: "current", ref, data: () => values.get(ref.path) }] }; } }), batch: () => { const actions = []; return { delete: ref => actions.push(["delete", ref]), set: (ref, value, options) => actions.push(["set", ref, value, options]), commit: async () => { for (const [kind, ref, value, options] of actions) { if (kind === "delete") values.delete(ref.path); else values.set(ref.path, options?.merge ? { ...(values.get(ref.path) || {}), ...value } : value); } } }; } };
  const repository = createAccountDeletionPurgeRepository({ database, serverTimestamp: () => "server-time" });
  assert.deepEqual(await repository.listPending(), [{ workspaceId: "workspace-a", credentialsDeletedAt: null }]);
  assert.deepEqual(await repository.purgeCredentials("workspace-a"), { deletedCredentialCount: 2 });
  assert.equal([...values.keys()].some(path => path.includes("providerCredentials")), false);
  assert.equal(values.get("workspaces/workspace-a/deletionRequests/current").stage, "credentials_deleted");
  assert.equal(JSON.stringify([...values.values()]).includes("secret-envelope"), false);
});


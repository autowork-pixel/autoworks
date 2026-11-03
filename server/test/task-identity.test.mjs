import assert from "node:assert/strict";
import test from "node:test";
import { createTaskIdentityVerifier } from "../src/task-identity.mjs";

const audience = "https://worker.example.com";
const serviceAccountEmail = "tasks@autoworks-c9a6a.iam.gserviceaccount.com";

function verifier(payload, verifyCalls = []) {
  return createTaskIdentityVerifier({
    audience, serviceAccountEmail,
    tokenVerifier: { verifyIdToken: async value => { verifyCalls.push(value); return { getPayload: () => payload }; } }
  });
}

test("Bearer OIDC 토큰의 audience와 지정 서비스 계정을 검증한다", async () => {
  const calls = [];
  const verify = verifier({ sub: "subject-a", email: serviceAccountEmail, email_verified: true }, calls);
  assert.deepEqual(await verify({ headers: { authorization: "Bearer signed-token" } }), { subject: "subject-a", email: serviceAccountEmail });
  assert.deepEqual(calls, [{ idToken: "signed-token", audience }]);
});

test("토큰이 없거나 다른 서비스 계정이면 거부한다", async () => {
  await assert.rejects(() => verifier({})({ headers: {} }));
  await assert.rejects(() => verifier({ sub: "subject-a", email: "other@example.com", email_verified: true })({ headers: { authorization: "Bearer signed-token" } }));
  await assert.rejects(() => verifier({ sub: "subject-a", email: serviceAccountEmail, email_verified: false })({ headers: { authorization: "Bearer signed-token" } }));
});

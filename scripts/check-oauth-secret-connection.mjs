import fs from "node:fs";
import assert from "node:assert/strict";

const connection = fs.readFileSync(new URL("./connect-oauth-dev.sh", import.meta.url), "utf8");
const workflow = fs.readFileSync(new URL("../.github/workflows/deploy-cloud-run-dev.yml", import.meta.url), "utf8");

for (const value of [
  "autoworks-naver-oauth-client-id",
  "autoworks-naver-oauth-client-secret",
  "autoworks-kakao-oauth-client-id",
  "autoworks-kakao-oauth-client-secret",
]) assert.ok(connection.includes(value), `OAuth connection missing ${value}`);

assert.match(connection, /APPLY_DEV/);
assert.match(connection, /roles\/secretmanager\.secretAccessor/);
assert.match(connection, /gcloud secrets versions list/);
assert.match(connection, /--update-secrets/);
assert.doesNotMatch(connection, /versions access/);
assert.doesNotMatch(connection, /projects add-iam-policy-binding[\s\S]*secretmanager\.secretAccessor/);
assert.match(workflow, /connect_oauth_secrets:/);
assert.match(workflow, /if: inputs\.connect_oauth_secrets/);
assert.match(workflow, /connect_operations:/);
assert.match(workflow, /if: inputs\.connect_operations/);
assert.match(workflow, /connect_hosting:/);
assert.match(workflow, /if: inputs\.connect_hosting/);
assert.match(workflow, /--update-env-vars/);
assert.doesNotMatch(workflow, /--set-env-vars/);

console.log("OAuth 비밀값을 읽지 않고 개별 Secret 권한과 Cloud Run 참조만 연결하는 경계를 확인");

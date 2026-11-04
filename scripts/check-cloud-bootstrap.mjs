import fs from "node:fs";
import assert from "node:assert/strict";

const script = fs.readFileSync(new URL("./bootstrap-cloud-dev.sh", import.meta.url), "utf8");
const workflow = fs.readFileSync(new URL("../.github/workflows/deploy-cloud-run-dev.yml", import.meta.url), "utf8");

for (const value of [
  "autoworks-c9a6a", "asia-northeast3", "autoworks-api-runtime",
  "autoworks-task-caller", "provider-credentials", "brand-search"
]) assert.ok(script.includes(value), `bootstrap missing ${value}`);

assert.match(script, /billingEnabled/);
assert.match(script, /APPLY_DEV/);
assert.doesNotMatch(script, /service-accounts keys create|--key-file/);
assert.match(script, /roles\/cloudkms\.cryptoKeyEncrypterDecrypter/);
assert.match(workflow, /inputs\.confirm == 'DEPLOY_DEV'/);
assert.match(workflow, /CLOUD_RUN_RUNTIME_SERVICE_ACCOUNT/);
assert.match(workflow, /CLOUD_RUN_TASK_SERVICE_ACCOUNT/);
assert.match(workflow, /CLOUD_RUN_KMS_KEY_NAME/);
console.log("개발 Cloud Run 부트스트랩의 결제 확인·무키 파일·최소 분리 계정 경계를 확인");


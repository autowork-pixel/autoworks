import assert from "node:assert/strict";
import test from "node:test";
import { readRuntimeConfig } from "../src/runtime-config.mjs";

const env = {
  GOOGLE_CLOUD_PROJECT: "autoworks-c9a6a", TASKS_LOCATION: "asia-northeast3", TASKS_QUEUE: "brand-search",
  SERVICE_URL: "https://api-example.run.app", TASK_SERVICE_ACCOUNT_EMAIL: "autoworks-task@autoworks-c9a6a.iam.gserviceaccount.com",
  KMS_KEY_NAME: "projects/autoworks-c9a6a/locations/asia-northeast3/keyRings/autoworks/cryptoKeys/provider-credentials",
  WEB_ORIGINS: "https://autoworks-c9a6a.web.app,https://autoworks-c9a6a.firebaseapp.com"
};

test("배포 런타임 설정을 정규화하고 작업 audience를 서비스 URL로 고정한다", () => {
  assert.deepEqual(readRuntimeConfig(env), {
    projectId: "autoworks-c9a6a", location: "asia-northeast3", queue: "brand-search",
    serviceUrl: "https://api-example.run.app", workerAudience: "https://api-example.run.app",
    serviceAccountEmail: "autoworks-task@autoworks-c9a6a.iam.gserviceaccount.com",
    keyName: env.KMS_KEY_NAME,
    allowedOrigins: ["https://autoworks-c9a6a.web.app", "https://autoworks-c9a6a.firebaseapp.com"]
  });
});

test("필수 설정 누락과 다른 프로젝트 KMS 키를 시작 전에 거부한다", () => {
  assert.throws(() => readRuntimeConfig({ ...env, TASKS_QUEUE: "" }), /TASKS_QUEUE/);
  assert.throws(() => readRuntimeConfig({ ...env, KMS_KEY_NAME: env.KMS_KEY_NAME.replace("autoworks-c9a6a", "other-project") }), /KMS_KEY_NAME/);
  assert.throws(() => readRuntimeConfig({ ...env, WEB_ORIGINS: "https://example.com/path" }), /WEB_ORIGINS/);
});

import fs from "node:fs";
import assert from "node:assert/strict";

const script = fs.readFileSync(new URL("./smoke-authenticated-api.mjs", import.meta.url), "utf8");

for (const required of [
  "AUTOWORKS_TEST_A_TOKEN",
  "AUTOWORKS_TEST_A_WORKSPACE",
  "AUTOWORKS_TEST_B_TOKEN",
  "AUTOWORKS_TEST_B_WORKSPACE",
  "brand-search-runs?limit=1",
  "provider-credentials",
  "cross-workspace isolation",
  "AbortSignal.timeout"
]) assert.ok(script.includes(required), `authenticated smoke missing ${required}`);

assert.match(script, /expectedStatus/);
assert.match(script, /ciphertext\|encryptedDataKey/);
assert.doesNotMatch(script, /console\.log\([^)]*token/i);
assert.doesNotMatch(script, /method:\s*"(POST|PUT|DELETE)"/);
console.log("인증 스모크의 읽기 전용·워크스페이스 격리·비밀정보 비노출 경계를 확인");

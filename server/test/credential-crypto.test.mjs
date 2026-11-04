import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { decryptCredentialPayload, encryptCredentialPayload } from "../src/credential-crypto.mjs";

const credentials = { apiKey: "license-key", secretKey: "secret-key", customerId: "123456" };

test("AES-256-GCM 봉투로 연결 정보를 왕복한다", () => {
  const plaintextDataKey = randomBytes(32);
  const envelope = encryptCredentialPayload({ credentials, plaintextDataKey, encryptedDataKey: "kms-ciphertext", keyVersion: "kms-key-v1" });
  assert.deepEqual(decryptCredentialPayload({ envelope, plaintextDataKey }), credentials);
  assert.equal(envelope.algorithm, "aes-256-gcm");
  assert.equal(JSON.stringify(envelope).includes("secret-key"), false);
  assert.equal(JSON.stringify(envelope).includes("license-key"), false);
});

test("암호문이 변조되면 평문이나 내부 오류를 노출하지 않는다", () => {
  const plaintextDataKey = randomBytes(32);
  const envelope = encryptCredentialPayload({ credentials, plaintextDataKey, encryptedDataKey: "kms-ciphertext", keyVersion: "kms-key-v1" });
  const bytes = Buffer.from(envelope.ciphertext, "base64");
  bytes[0] ^= 1;
  assert.throws(() => decryptCredentialPayload({ envelope: { ...envelope, ciphertext: bytes.toString("base64") }, plaintextDataKey }), error => {
    assert.equal(error.code, "PROVIDER_CREDENTIAL_REQUIRED");
    assert.equal(error.message.includes("secret-key"), false);
    return true;
  });
});

test("예상하지 않은 필드는 암호화 전에 거부한다", () => {
  assert.throws(() => encryptCredentialPayload({
    credentials: { ...credentials, token: "unexpected" },
    plaintextDataKey: randomBytes(32),
    encryptedDataKey: "kms-ciphertext",
    keyVersion: "kms-key-v1"
  }), error => error.code === "INVALID_INPUT");
});

test("YouTube·OpenAI 키와 Apify 토큰은 제공자별 필드만 암호화한다", () => {
  for (const [provider, value] of [["youtube", { apiKey: "youtube-key" }], ["apify", { token: "apify-token" }], ["openai", { apiKey: "openai-key" }], ["naver-search", { clientId: "client-id", clientSecret: "client-secret" }]]) {
    const plaintextDataKey = randomBytes(32);
    const envelope = encryptCredentialPayload({ provider, credentials: value, plaintextDataKey, encryptedDataKey: "kms-ciphertext", keyVersion: "kms-key-v1" });
    assert.deepEqual(decryptCredentialPayload({ provider, envelope, plaintextDataKey }), value);
    assert.equal(JSON.stringify(envelope).includes(Object.values(value)[0]), false);
    assert.throws(() => encryptCredentialPayload({ provider, credentials: { ...value, secretKey: "extra" }, plaintextDataKey, encryptedDataKey: "kms-ciphertext", keyVersion: "kms-key-v1" }), { code: "INVALID_INPUT" });
    assert.throws(() => decryptCredentialPayload({ provider: "naver-searchad", envelope, plaintextDataKey }), { code: "INVALID_INPUT" });
  }
});

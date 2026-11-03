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

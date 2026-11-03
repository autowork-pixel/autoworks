import assert from "node:assert/strict";
import test from "node:test";
import crc32c from "fast-crc32c";
import { createKmsKeyManager } from "../src/kms-key-manager.mjs";

const keyName = "projects/project-a/locations/asia-northeast3/keyRings/autoworks/cryptoKeys/provider-credentials";
const keyVersion = `${keyName}/cryptoKeyVersions/7`;
const ids = { workspaceId: "workspace-a", provider: "naver-searchad" };
const crc = value => ({ value: crc32c.calculate(value) });

test("32바이트 데이터 키를 KMS로 감싸고 출처 컨텍스트와 응답 무결성을 확인한다", async () => {
  const plaintext = Buffer.alloc(32, 7);
  const ciphertext = Buffer.from("wrapped-key");
  let request;
  const manager = createKmsKeyManager({
    keyName,
    randomBytesImpl: () => Buffer.from(plaintext),
    client: { encrypt: async value => {
      request = value;
      return [{ ciphertext, name: keyVersion, verifiedPlaintextCrc32c: true, verifiedAdditionalAuthenticatedDataCrc32c: true, ciphertextCrc32c: crc(ciphertext) }];
    } }
  });
  const result = await manager.generateDataKey(ids);
  assert.deepEqual(result, { plaintextDataKey: plaintext, encryptedDataKey: ciphertext.toString("base64"), keyVersion });
  assert.equal(request.name, keyName);
  assert.equal(request.additionalAuthenticatedData.toString(), "workspace-a:naver-searchad");
  assert.equal(Number(request.plaintextCrc32c.value), crc32c.calculate(plaintext));
});

test("저장된 KMS 봉투는 같은 워크스페이스 컨텍스트에서만 32바이트 키로 복호화한다", async () => {
  const plaintext = Buffer.alloc(32, 9);
  let request;
  const manager = createKmsKeyManager({ keyName, client: { decrypt: async value => { request = value; return [{ plaintext, plaintextCrc32c: crc(plaintext) }]; } } });
  const result = await manager.decryptDataKey({ encryptedDataKey: Buffer.from("wrapped-key").toString("base64"), keyVersion, ...ids });
  assert.deepEqual(result, plaintext);
  assert.equal(request.name, keyName);
  assert.equal(request.additionalAuthenticatedData.toString(), "workspace-a:naver-searchad");
});

test("KMS 응답 무결성 또는 다른 키 계보를 신뢰하지 않고 평문 키를 지운다", async () => {
  const generated = Buffer.alloc(32, 5);
  const manager = createKmsKeyManager({
    keyName,
    randomBytesImpl: () => generated,
    client: { encrypt: async () => [{ ciphertext: Buffer.from("bad"), name: keyVersion, verifiedPlaintextCrc32c: false }] }
  });
  await assert.rejects(() => manager.generateDataKey(ids), /integrity/);
  assert.equal(generated.every(byte => byte === 0), true);
  await assert.rejects(() => manager.decryptDataKey({ encryptedDataKey: "d3JhcHBlZA==", keyVersion: "projects/other/locations/x/keyRings/y/cryptoKeys/z/cryptoKeyVersions/1", ...ids }), /invalid/);
});

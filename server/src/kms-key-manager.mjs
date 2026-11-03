import { randomBytes } from "node:crypto";
import crc32c from "fast-crc32c";

const keyPattern = /^projects\/[^/]+\/locations\/[^/]+\/keyRings\/[^/]+\/cryptoKeys\/[^/]+$/;

function context({ workspaceId, provider }) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(workspaceId || "") || provider !== "naver-searchad") {
    throw new Error("KMS encryption context is invalid");
  }
  return Buffer.from(`${workspaceId}:${provider}`, "utf8");
}

function checksum(value) {
  return { value: crc32c.calculate(value) };
}

function matchesChecksum(value, expected) {
  return Number(expected?.value) === crc32c.calculate(value);
}

export function createKmsKeyManager({ client, keyName, randomBytesImpl = randomBytes }) {
  if (!client || !keyPattern.test(keyName || "")) throw new Error("KMS key manager configuration is incomplete");
  return {
    async generateDataKey(ids) {
      const plaintextDataKey = randomBytesImpl(32);
      if (!Buffer.isBuffer(plaintextDataKey) || plaintextDataKey.length !== 32) throw new Error("Random data key generation failed");
      const additionalAuthenticatedData = context(ids);
      try {
        const [response] = await client.encrypt({
          name: keyName,
          plaintext: plaintextDataKey,
          plaintextCrc32c: checksum(plaintextDataKey),
          additionalAuthenticatedData,
          additionalAuthenticatedDataCrc32c: checksum(additionalAuthenticatedData)
        });
        const ciphertext = Buffer.from(response?.ciphertext || []);
        if (response?.verifiedPlaintextCrc32c !== true || response?.verifiedAdditionalAuthenticatedDataCrc32c !== true ||
            !ciphertext.length || !matchesChecksum(ciphertext, response?.ciphertextCrc32c) ||
            typeof response?.name !== "string" || !response.name.startsWith(`${keyName}/cryptoKeyVersions/`)) {
          throw new Error("KMS encrypt integrity verification failed");
        }
        return { plaintextDataKey, encryptedDataKey: ciphertext.toString("base64"), keyVersion: response.name };
      } catch (error) {
        plaintextDataKey.fill(0);
        throw error;
      }
    },

    async decryptDataKey({ encryptedDataKey, keyVersion, ...ids }) {
      if (typeof encryptedDataKey !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(encryptedDataKey) ||
          typeof keyVersion !== "string" || !keyVersion.startsWith(`${keyName}/cryptoKeyVersions/`)) {
        throw new Error("KMS envelope is invalid");
      }
      const ciphertext = Buffer.from(encryptedDataKey, "base64");
      const additionalAuthenticatedData = context(ids);
      const [response] = await client.decrypt({
        name: keyName,
        ciphertext,
        ciphertextCrc32c: checksum(ciphertext),
        additionalAuthenticatedData,
        additionalAuthenticatedDataCrc32c: checksum(additionalAuthenticatedData)
      });
      const plaintext = Buffer.from(response?.plaintext || []);
      if (plaintext.length !== 32 || !matchesChecksum(plaintext, response?.plaintextCrc32c)) {
        plaintext.fill(0);
        throw new Error("KMS decrypt integrity verification failed");
      }
      return plaintext;
    }
  };
}

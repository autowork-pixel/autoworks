import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { ApiError } from "./domain.mjs";

const algorithm = "aes-256-gcm";

function dataKey(value) {
  if (!Buffer.isBuffer(value) || value.length !== 32) throw new TypeError("dataKey must be a 32-byte Buffer");
  return value;
}

function credentialPayload(value, provider = "naver-searchad") {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiError("INVALID_INPUT", "연결 정보 형식이 올바르지 않습니다.");
  const fields = { "naver-searchad": ["apiKey", "secretKey", "customerId"], youtube: ["apiKey"], apify: ["token"], openai: ["apiKey"] };
  const allowed = fields[provider];
  if (!allowed) throw new ApiError("INVALID_INPUT", "지원하지 않는 API 연결입니다.");
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new ApiError("INVALID_INPUT", "허용되지 않은 연결 정보 필드입니다.");
  const output = {};
  for (const field of allowed) {
    if (typeof value[field] !== "string" || !value[field].trim() || value[field].length > 512) {
      throw new ApiError("INVALID_INPUT", `${field} 형식이 올바르지 않습니다.`);
    }
    output[field] = value[field].trim();
  }
  return output;
}

export function encryptCredentialPayload({ credentials, plaintextDataKey, encryptedDataKey, keyVersion, provider = "naver-searchad" }) {
  if (typeof encryptedDataKey !== "string" || !encryptedDataKey) throw new TypeError("encryptedDataKey is required");
  if (typeof keyVersion !== "string" || !keyVersion) throw new TypeError("keyVersion is required");
  const iv = randomBytes(12);
  const cipher = createCipheriv(algorithm, dataKey(plaintextDataKey), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(credentialPayload(credentials, provider)), "utf8"), cipher.final()]);
  return {
    algorithm,
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    encryptedDataKey,
    keyVersion
  };
}

export function decryptCredentialPayload({ envelope, plaintextDataKey, provider = "naver-searchad" }) {
  if (!envelope || envelope.algorithm !== algorithm) throw new ApiError("PROVIDER_CREDENTIAL_REQUIRED", "지원하지 않는 연결 정보 형식입니다.", 409);
  try {
    const decipher = createDecipheriv(algorithm, dataKey(plaintextDataKey), Buffer.from(envelope.iv, "base64"));
    decipher.setAuthTag(Buffer.from(envelope.authTag, "base64"));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64")), decipher.final()]).toString("utf8");
    return credentialPayload(JSON.parse(plaintext), provider);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError("PROVIDER_CREDENTIAL_REQUIRED", "연결 정보를 복호화하지 못했습니다.", 409);
  }
}

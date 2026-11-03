import { randomBytes } from "node:crypto";
import { ApiError } from "./domain.mjs";
import { authorizationUrl, exchangeAuthorizationCode, fetchProviderIdentity } from "./oauth-providers.mjs";

export async function beginOAuth({ provider, clientId, redirectUri, stateStore, now = () => Date.now() }) {
  const state = randomBytes(32).toString("base64url");
  await stateStore.create({ state, provider, redirectUri, expiresAt: now() + 10 * 60 * 1000 });
  return authorizationUrl({ provider, clientId, redirectUri, state });
}

export async function completeOAuth({ provider, code, state, config, stateStore, identityStore, tokenIssuer, fetchImpl = fetch, now = () => Date.now() }) {
  if (typeof code !== "string" || !code || typeof state !== "string" || !state) throw new ApiError("AUTH_REQUIRED", "로그인 응답이 올바르지 않습니다.", 401);
  const pending = await stateStore.consume(state);
  if (!pending || pending.provider !== provider || pending.expiresAt < now()) {
    throw new ApiError("AUTH_REQUIRED", "로그인 요청이 만료되었거나 유효하지 않습니다.", 401);
  }
  const accessToken = await exchangeAuthorizationCode({ provider, clientId: config.clientId, clientSecret: config.clientSecret, redirectUri: pending.redirectUri, code, state, fetchImpl });
  const identity = await fetchProviderIdentity({ provider, accessToken, fetchImpl });
  const uid = `${provider}:${identity.subject}`;
  if (uid.length > 128) throw new ApiError("AUTH_REQUIRED", "로그인 사용자 식별값이 올바르지 않습니다.", 401);
  await identityStore.upsert({ uid, ...identity });
  const customToken = await tokenIssuer.createCustomToken(uid, { authProvider: provider });
  return { customToken, provider };
}

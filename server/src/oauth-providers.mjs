import { ApiError } from "./domain.mjs";

const providers = {
  naver: {
    authorizeUrl: "https://nid.naver.com/oauth2.0/authorize",
    tokenUrl: "https://nid.naver.com/oauth2.0/token",
    profileUrl: "https://openapi.naver.com/v1/nid/me"
  },
  kakao: {
    authorizeUrl: "https://kauth.kakao.com/oauth/authorize",
    tokenUrl: "https://kauth.kakao.com/oauth/token",
    profileUrl: "https://kapi.kakao.com/v2/user/me"
  }
};

function configuration(provider) {
  const value = providers[provider];
  if (!value) throw new ApiError("INVALID_INPUT", "지원하지 않는 로그인 제공자입니다.");
  return value;
}

export function authorizationUrl({ provider, clientId, redirectUri, state }) {
  const config = configuration(provider);
  const url = new URL(config.authorizeUrl);
  url.search = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: redirectUri, state }).toString();
  return url.toString();
}

async function responseJson(response) {
  try {
    return await response.json();
  } catch {
    throw new ApiError("AUTH_REQUIRED", "로그인 제공자 응답을 확인하지 못했습니다.", 502);
  }
}

export async function exchangeAuthorizationCode({ provider, clientId, clientSecret, redirectUri, code, state, fetchImpl = fetch }) {
  const config = configuration(provider);
  const body = new URLSearchParams({ grant_type: "authorization_code", client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, code });
  if (provider === "naver") body.set("state", state);
  const response = await fetchImpl(config.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded;charset=utf-8" },
    body,
    signal: AbortSignal.timeout(10_000)
  });
  const payload = await responseJson(response);
  if (!response.ok || typeof payload.access_token !== "string" || !payload.access_token) {
    throw new ApiError("AUTH_REQUIRED", "로그인 제공자 토큰 발급에 실패했습니다.", 401);
  }
  return payload.access_token;
}

export async function fetchProviderIdentity({ provider, accessToken, fetchImpl = fetch }) {
  const config = configuration(provider);
  const response = await fetchImpl(config.profileUrl, {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10_000)
  });
  const payload = await responseJson(response);
  if (!response.ok) throw new ApiError("AUTH_REQUIRED", "로그인 사용자 정보를 확인하지 못했습니다.", 401);
  if (provider === "naver") {
    const profile = payload.response;
    if (payload.resultcode !== "00" || !profile || typeof profile.id !== "string" || !profile.id) {
      throw new ApiError("AUTH_REQUIRED", "네이버 사용자 식별값을 확인하지 못했습니다.", 401);
    }
    return { provider, subject: profile.id, email: typeof profile.email === "string" ? profile.email : null, displayName: profile.nickname || profile.name || null };
  }
  if ((typeof payload.id !== "number" && typeof payload.id !== "string") || String(payload.id).length === 0) {
    throw new ApiError("AUTH_REQUIRED", "카카오 사용자 식별값을 확인하지 못했습니다.", 401);
  }
  const account = payload.kakao_account || {};
  return { provider, subject: String(payload.id), email: typeof account.email === "string" ? account.email : null, displayName: account.profile?.nickname || null };
}

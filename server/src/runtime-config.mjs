const serviceAccountPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*@[A-Za-z0-9.-]+\.iam\.gserviceaccount\.com$/;
const resourceIdPattern = /^[A-Za-z0-9_-]{1,100}$/;
const kmsKeyPattern = /^projects\/[^/]+\/locations\/[^/]+\/keyRings\/[^/]+\/cryptoKeys\/[^/]+$/;

function required(env, name) {
  const value = String(env[name] || "").trim();
  if (!value) throw new Error(`Missing runtime configuration: ${name}`);
  return value;
}

function httpsOrigin(value, name) {
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error(`Invalid runtime configuration: ${name}`); }
  if (parsed.protocol !== "https:" || parsed.pathname !== "/" || parsed.search || parsed.hash || parsed.username || parsed.password) {
    throw new Error(`Invalid runtime configuration: ${name}`);
  }
  return parsed.origin;
}

function oauthProvider(env, prefix, provider, serviceUrl) {
  const clientId = String(env[`${prefix}_OAUTH_CLIENT_ID`] || "").trim();
  const clientSecret = String(env[`${prefix}_OAUTH_CLIENT_SECRET`] || "").trim();
  if (!clientId && !clientSecret) return null;
  if (!clientId || !clientSecret || /[\r\n]/.test(clientId) || /[\r\n]/.test(clientSecret)) throw new Error(`Invalid runtime configuration: ${prefix}_OAUTH`);
  return { clientId, clientSecret, redirectUri: `${serviceUrl}/v1/auth/${provider}/callback` };
}

export function readRuntimeConfig(env = process.env) {
  const projectId = String(env.GOOGLE_CLOUD_PROJECT || env.GCLOUD_PROJECT || "").trim();
  if (!projectId) throw new Error("Missing runtime configuration: GOOGLE_CLOUD_PROJECT");
  const location = required(env, "TASKS_LOCATION");
  const queue = required(env, "TASKS_QUEUE");
  if (!resourceIdPattern.test(location) || !resourceIdPattern.test(queue)) throw new Error("Invalid Cloud Tasks resource configuration");
  const serviceUrl = httpsOrigin(required(env, "SERVICE_URL"), "SERVICE_URL");
  const serviceAccountEmail = required(env, "TASK_SERVICE_ACCOUNT_EMAIL");
  if (!serviceAccountPattern.test(serviceAccountEmail)) throw new Error("Invalid runtime configuration: TASK_SERVICE_ACCOUNT_EMAIL");
  const keyName = required(env, "KMS_KEY_NAME");
  if (!kmsKeyPattern.test(keyName) || !keyName.startsWith(`projects/${projectId}/`)) throw new Error("Invalid runtime configuration: KMS_KEY_NAME");
  const origins = required(env, "WEB_ORIGINS").split(",").map(value => httpsOrigin(value.trim(), "WEB_ORIGINS"));
  const oauthProviders = {};
  for (const [prefix, provider] of [["NAVER", "naver"], ["KAKAO", "kakao"]]) {
    const value = oauthProvider(env, prefix, provider, serviceUrl);
    if (value) oauthProviders[provider] = value;
  }
  return {
    projectId, location, queue, serviceUrl, workerAudience: httpsOrigin(env.WORKER_AUDIENCE || serviceUrl, "WORKER_AUDIENCE"),
    serviceAccountEmail, keyName, allowedOrigins: [...new Set(origins)], oauthProviders
  };
}

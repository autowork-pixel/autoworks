import fs from "node:fs";
import path from "node:path";

const base = String(process.env.AUTOWORKS_API_BASE || "").replace(/\/$/, "");
const tokenA = String(process.env.AUTOWORKS_TEST_A_TOKEN || "");
const workspaceA = String(process.env.AUTOWORKS_TEST_A_WORKSPACE || "");
const tokenB = String(process.env.AUTOWORKS_TEST_B_TOKEN || "");
const workspaceB = String(process.env.AUTOWORKS_TEST_B_WORKSPACE || "");
const evidencePath = String(process.env.AUTOWORKS_EVIDENCE_PATH || "");
const workspacePattern = /^[A-Za-z0-9_-]{1,128}$/;

if (!/^https:\/\/[^/]+$/.test(base)) throw new Error("AUTOWORKS_API_BASE must be one HTTPS origin");
if (!tokenA || !workspacePattern.test(workspaceA)) throw new Error("A test token and workspace are required");
if (Boolean(tokenB) !== Boolean(workspaceB)) throw new Error("B token and workspace must be supplied together");
if (workspaceB && (!workspacePattern.test(workspaceB) || workspaceA === workspaceB)) throw new Error("B workspace must be valid and different from A");

const evidence = {
  schemaVersion: 1,
  capturedAt: new Date().toISOString(),
  apiOrigin: new URL(base).origin,
  checks: []
};

function record(name, status, result = "passed") {
  evidence.checks.push({ name, status, result });
}

function containsSecretMaterial(value) {
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, nested]) =>
    /^(ciphertext|encryptedDataKey|clientSecret|apiKey|accessToken|billingKey)$/i.test(key) || containsSecretMaterial(nested)
  );
}

async function request(pathname, token) {
  return fetch(`${base}${pathname}`, {
    method: "GET",
    redirect: "error",
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    signal: AbortSignal.timeout(15_000)
  });
}

async function expectJson(name, pathname, token, expectedStatus) {
  const response = await request(pathname, token);
  if (response.status !== expectedStatus) throw new Error(`${name}: expected ${expectedStatus}, received ${response.status}`);
  const body = await response.json();
  if (containsSecretMaterial(body)) throw new Error(`${name}: response exposed credential material`);
  record(name, response.status);
  return body;
}

const ownRuns = await expectJson("A own workspace run list", `/v1/workspaces/${workspaceA}/brand-search-runs?limit=1`, tokenA, 200);
if (!Array.isArray(ownRuns.runs)) throw new Error("A run list response is invalid");

await expectJson("A invalid list limit rejected", `/v1/workspaces/${workspaceA}/brand-search-runs?limit=21`, tokenA, 400);

for (const provider of ["naver-searchad", "naver-search", "youtube", "apify", "openai"]) {
  await expectJson(`A ${provider} credential status`, `/v1/workspaces/${workspaceA}/provider-credentials/${provider}`, tokenA, 200);
}

if (tokenB) {
  await expectJson("A cannot read B workspace", `/v1/workspaces/${workspaceB}/brand-search-runs?limit=1`, tokenA, 403);
  await expectJson("B cannot read A workspace", `/v1/workspaces/${workspaceA}/brand-search-runs?limit=1`, tokenB, 403);
  const ownRunsB = await expectJson("B own workspace run list", `/v1/workspaces/${workspaceB}/brand-search-runs?limit=1`, tokenB, 200);
  if (!Array.isArray(ownRunsB.runs)) throw new Error("B run list response is invalid");
} else {
  record("cross-workspace isolation", null, "skipped: B test identity not supplied");
}

if (evidencePath) {
  const target = path.resolve(evidencePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
}

console.log(JSON.stringify(evidence, null, 2));

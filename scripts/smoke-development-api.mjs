const base = String(process.env.AUTOWORKS_API_BASE || "").replace(/\/$/, "");
if (!/^https:\/\/[^/]+$/.test(base)) throw new Error("AUTOWORKS_API_BASE must be one HTTPS origin");
const origin = "https://autoworks-c9a6a.web.app";

async function expectStatus(path, status, options = {}) {
  const response = await fetch(`${base}${path}`, options);
  if (response.status !== status) throw new Error(`${path}: expected ${status}, received ${response.status}`);
  return response;
}

const health = await expectStatus("/healthz", 200);
const healthBody = await health.json();
if (healthBody.status !== "ok") throw new Error("healthz response is not ok");

const preflight = await expectStatus("/v1/workspaces/smoke/brand-search-runs", 204, {
  method: "OPTIONS",
  headers: {
    origin,
    "access-control-request-method": "POST",
    "access-control-request-headers": "authorization,content-type"
  }
});
if (preflight.headers.get("access-control-allow-origin") !== origin) throw new Error("CORS origin was not echoed");

for (const path of [
  "/v1/workspaces/smoke/brand-search-runs",
  "/v1/workspaces/smoke/content-reference-runs",
  "/v1/workspaces/smoke/influencer-candidate-runs",
  "/v1/workspaces/smoke/ai-blog-runs",
  "/v1/workspaces/smoke/naver-visibility-runs",
  "/v1/workspaces/smoke/content-pack-runs"
]) {
  await expectStatus(path, 401, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: "{}"
  });
}
await expectStatus("/internal/v1/recovery:run", 401, { method: "POST" });
await expectStatus("/internal/v1/budget-alerts:receive", 401, { method: "POST" });
console.log("개발 API healthz·CORS·고객 인증·내부 OIDC 차단 스모크 테스트 통과");


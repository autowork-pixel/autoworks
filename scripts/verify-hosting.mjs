const baseUrl = (process.env.HOSTING_BASE_URL || "https://autoworks-c9a6a.web.app").replace(/\/$/, "");
const errors = [];

async function request(path) {
  const response = await fetch(`${baseUrl}${path}`, { redirect: "manual" });
  return { path, response, text: await response.text() };
}

for (const path of ["/", "/brand-search.html", "/admin.html", "/privacy.html"]) {
  const { response, text } = await request(path);
  if (response.status !== 200) errors.push(`${path}: 200 대신 ${response.status}`);
  if (path === "/" && !text.includes("오토웍스")) errors.push("/: 오토웍스 본문을 확인할 수 없습니다.");
}

for (const path of [
  "/TOSS_PAYMENTS_PLAN.md",
  "/OPERATIONS_SECURITY.md",
  "/QUEST_LOG.md",
  "/scripts/check-security.mjs",
  "/firebase.json",
  "/package.json",
  "/firestore.rules"
]) {
  const { response } = await request(path);
  if (response.status !== 404) errors.push(`${path}: 비공개 경로가 ${response.status}을 반환합니다.`);
}

const { response: home } = await request("/");
for (const [key, value] of [
  ["x-content-type-options", "nosniff"],
  ["x-frame-options", "DENY"],
  ["referrer-policy", "strict-origin-when-cross-origin"],
  ["permissions-policy", "camera=(), microphone=(), geolocation=()"]
]) {
  if (home.headers.get(key) !== value) errors.push(`/: ${key} 헤더가 배포값과 다릅니다.`);
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(`${baseUrl}: 공개 페이지·비공개 경로·보안 헤더 검증 완료`);

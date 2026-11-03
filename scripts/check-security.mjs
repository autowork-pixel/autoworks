import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const errors = [];
const htmlFiles = readdirSync(root).filter(file => file.endsWith(".html"));
const firebase = JSON.parse(readFileSync(resolve(root, "firebase.json"), "utf8"));
const ignore = new Set(firebase.hosting?.ignore || []);

for (const required of [
  "**/.*",
  "**/*.md",
  "**/*.json",
  "**/*.log",
  "firestore.rules",
  "scripts/**",
  "tests/**",
  "**/node_modules/**"
]) {
  if (!ignore.has(required)) errors.push(`firebase.json: Hosting 제외 규칙 ${required}가 없습니다.`);
}

const headers = new Map(
  (firebase.hosting?.headers || [])
    .filter(rule => rule.source === "**")
    .flatMap(rule => rule.headers || [])
    .map(header => [header.key.toLowerCase(), header.value])
);

for (const [key, value] of [
  ["x-content-type-options", "nosniff"],
  ["x-frame-options", "DENY"],
  ["referrer-policy", "strict-origin-when-cross-origin"],
  ["permissions-policy", "camera=(), microphone=(), geolocation=()"]
]) {
  if (headers.get(key) !== value) errors.push(`firebase.json: 보안 헤더 ${key} 값이 올바르지 않습니다.`);
}

const forbiddenStorage = /\b(?:localStorage|sessionStorage|indexedDB)\b/;
const secretValue = /(?:sk-(?:proj-)?[A-Za-z0-9_-]{20,}|(?:live|test)_(?:sk|secret)_[A-Za-z0-9_-]{10,}|-----BEGIN (?:RSA |EC )?PRIVATE KEY-----)/;
const remoteScript = /(?:<script\b[^>]*\bsrc=|\bimport\s*\()\s*["'](https?:\/\/[^"']+)/gi;

for (const file of htmlFiles) {
  const html = readFileSync(resolve(root, file), "utf8");
  if (forbiddenStorage.test(html)) errors.push(`${file}: 브라우저 영구 저장소 사용을 금지합니다.`);
  if (secretValue.test(html)) errors.push(`${file}: 비밀키로 보이는 값이 공개 HTML에 있습니다.`);
  if (/\bapiKey\s*:\s*["'](?!AIza[0-9A-Za-z_-]+["'])/i.test(html)) {
    errors.push(`${file}: Firebase 공개 설정 외의 apiKey 값을 HTML에 두지 마세요.`);
  }
  for (const match of html.matchAll(remoteScript)) {
    if (!match[1].startsWith("https://www.gstatic.com/firebasejs/")) {
      errors.push(`${file}: 허용되지 않은 원격 스크립트 ${match[1]}`);
    }
  }
}

const apiGuide = readFileSync(resolve(root, "api-guide.html"), "utf8");
if (!apiGuide.includes('?"password":"text"') || !/autocomplete=["']off["']/.test(apiGuide)) {
  errors.push("api-guide.html: 비밀정보 입력은 password 형식과 autocomplete=off를 유지해야 합니다.");
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(`${htmlFiles.length}개 공개 HTML의 비밀정보·저장소·원격 스크립트와 Hosting 보안 경계를 확인`);

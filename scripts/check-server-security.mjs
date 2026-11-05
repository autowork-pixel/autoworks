import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(process.cwd(), "server", "src");
const files = (await readdir(root)).filter(file => file.endsWith(".mjs"));
const secretValue = /(?:sk-(?:proj-)?[A-Za-z0-9_-]{20,}|(?:live|test)_(?:sk|secret)_[A-Za-z0-9_-]{10,}|-----BEGIN (?:RSA |EC )?PRIVATE KEY-----)/;
const safeLog = /^\s*logger\.error\("[a-z0-9_]+", \{ requestId, code: "INTERNAL_ERROR" \}\);\s*$/;

for (const file of files) {
  const source = await readFile(resolve(root, file), "utf8");
  assert.equal(secretValue.test(source), false, `${file}: 실제 비밀키로 보이는 값이 서버 소스에 있습니다.`);
  for (const line of source.split(/\r?\n/).filter(value => /logger\.(?:error|warn|info)\(/.test(value))) {
    const call = line.slice(line.indexOf("logger."));
    assert.equal(safeLog.test(call), true, `${file}: 서버 로그에는 requestId와 일반 오류 코드만 기록해야 합니다.`);
  }
  if (file !== "index.mjs") assert.equal(/console\.(?:log|error|warn)\(/.test(source), false, `${file}: 직접 콘솔 로그를 사용하면 안 됩니다.`);
  if (!["index.mjs", "runtime-config.mjs"].includes(file)) assert.equal(/process\.env/.test(source), false, `${file}: 환경변수는 런타임 설정 계층에서만 읽어야 합니다.`);
}

const firebaseRepository = await readFile(resolve(root, "firebase-repository.mjs"), "utf8");
assert.match(firebaseRepository, /verifyIdToken\(token\)/, "Firebase ID 토큰의 서명·발급자·만료 검증이 필요합니다.");
assert.doesNotMatch(firebaseRepository, /verifyIdToken\(token,\s*true\)/, "요청마다 사용자 조회 IAM을 요구하는 철회 검사는 사용하지 않습니다.");

console.log(`${files.length}개 서버 모듈의 비밀값·구조화 로그·환경변수 접근 경계를 확인`);


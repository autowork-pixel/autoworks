import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const dockerfile=await readFile(new URL("../server/Dockerfile",import.meta.url),"utf8");
const dockerignore=await readFile(new URL("../server/.dockerignore",import.meta.url),"utf8");

assert.match(dockerfile,/^FROM node:22-slim$/m,"서버 컨테이너의 고정 Node 주 버전이 필요합니다.");
assert.match(dockerfile,/^RUN npm ci --omit=dev$/m,"운영 컨테이너에는 lockfile 기준 운영 의존성만 설치해야 합니다.");
assert.match(dockerfile,/^COPY --chown=node:node src \.\/src$/m,"애플리케이션 파일은 비특권 사용자 소유여야 합니다.");
assert.match(dockerfile,/^USER node$/m,"서버 컨테이너는 root가 아닌 node 사용자로 실행해야 합니다.");
assert.match(dockerfile,/^CMD \["node", "src\/index\.mjs"\]$/m,"서버 시작 명령은 쉘을 거치지 않아야 합니다.");
for(const entry of ["node_modules","test","npm-debug.log"]){
  assert.match(dockerignore,new RegExp(`^${entry.replace(".","\\.")}$`,"m"),`Docker context에서 ${entry}을 제외해야 합니다.`);
}
console.log("서버 컨테이너의 lockfile 설치·비특권 실행·빌드 컨텍스트 경계를 확인");

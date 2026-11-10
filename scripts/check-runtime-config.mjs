import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const config=await readFile(new URL("../public/runtime-config.js",import.meta.url),"utf8");
const deployWorkflow=await readFile(new URL("../.github/workflows/deploy-firebase.yml",import.meta.url),"utf8");
const match=config.match(/window\.AUTOWORKS_API_BASE\s*=\s*"([^"]*)"/);
assert.ok(match,"공개 런타임 설정에 API 기준 URL이 필요합니다.");
if(match[1]){const url=new URL(match[1]);assert.equal(url.protocol,"https:","운영 API URL은 HTTPS여야 합니다.");assert.equal(url.username,"","API URL에 사용자 정보를 넣으면 안 됩니다.");assert.equal(url.password,"","API URL에 비밀번호를 넣으면 안 됩니다.");assert.equal(url.search,"","API URL에 쿼리를 넣으면 안 됩니다.");assert.equal(url.hash,"","API URL에 fragment를 넣으면 안 됩니다.");assert.equal(url.pathname,"/","API URL은 origin만 사용해야 합니다.")}
for(const file of ["index.html","admin.html","api-guide.html","brand-search.html"]){
  const source=await readFile(new URL(`../public/${file}`,import.meta.url),"utf8");
  const configIndex=source.indexOf('src="./runtime-config.js"');
  assert.notEqual(configIndex,-1,`${file}: 공통 API 설정을 불러와야 합니다.`);
  const consumer=file==="brand-search.html"?'src="./brand-search.js':"AUTOWORKS_API_BASE";
  const consumerIndex=source.indexOf(consumer);
  assert.notEqual(consumerIndex,-1,`${file}: API 설정 소비 코드를 찾을 수 없습니다.`);
  assert.ok(configIndex<consumerIndex,`${file}: API 설정은 사용 전에 불러와야 합니다.`);
}
assert.match(deployWorkflow,/sed -Ei .*GITHUB_SHA.*public\/\*\.html/,"Hosting 배포는 모든 로컬 JavaScript URL을 커밋별로 갱신해야 합니다.");
console.log("공개 API 기준 URL의 단일 설정·HTTPS·로드 순서를 확인");

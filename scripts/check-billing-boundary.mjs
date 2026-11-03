import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

const rules=await readFile(new URL("../firestore.rules",import.meta.url),"utf8");

assert.match(rules,/match \/subscriptions\/\{subscriptionId\}[\s\S]*?allow get, list: if isAdmin\(\) \|\| \(ownsWorkspace\(workspaceId\)[\s\S]*?keys\(\)\.hasOnly\(\['planId', 'planLabel', 'status', 'periodStart', 'periodEnd', 'runLimit', 'keywordLookupLimit', 'updatedAt'\]\)[\s\S]*?allow create, update, delete: if false;/,"구독 공개 요약은 허용 필드만 고객에게 읽기 전용이어야 합니다.");
assert.match(rules,/match \/paymentSummaries\/\{summaryId\}[\s\S]*?allow get, list: if isAdmin\(\) \|\| \(ownsWorkspace\(workspaceId\)[\s\S]*?keys\(\)\.hasOnly\(\['status', 'amount', 'currency', 'paidAt', 'nextBillingAt', 'updatedAt'\]\)[\s\S]*?allow create, update, delete: if false;/,"결제 공개 요약은 허용 필드만 고객에게 읽기 전용이어야 합니다.");
assert.match(rules,/match \/paymentEvents\/\{eventId\}[\s\S]*?allow get, list: if isAdmin\(\);[\s\S]*?allow create, update, delete: if false;/,"결제 이벤트는 운영자만 읽고 브라우저가 변경할 수 없어야 합니다.");
assert.match(rules,/match \/billingCredentials\/\{credentialId\}[\s\S]*?allow read, write: if false;/,"빌링 자격정보는 모든 브라우저 접근을 차단해야 합니다.");

const publicDir=new URL("../public/",import.meta.url);
const publicFiles=(await readdir(publicDir)).filter(name=>/\.(?:html|js)$/i.test(name));
const forbidden=/\b(?:billingKey|paymentKey)\b/;
for(const name of publicFiles){
  const source=await readFile(new URL(name,publicDir),"utf8");
  assert.doesNotMatch(source,forbidden,`${name}: 서버 전용 빌링키나 결제키를 공개 코드에 두면 안 됩니다.`);
}

const index=await readFile(new URL("../public/index.html",import.meta.url),"utf8");
assert.match(index,/paymentSummaries"\s*,\s*"current"/,"고객 화면은 공개 결제 요약만 읽어야 합니다.");
assert.doesNotMatch(index,/paymentEvents|billingCredentials/,"고객 화면은 결제 이벤트나 빌링 자격정보를 조회하면 안 됩니다.");

console.log(`${publicFiles.length}개 공개 파일과 Firestore 결제·구독 보안 경계를 확인`);

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
assert.match(source, /runs \+ runsReserved/, "남은 실행 한도에는 예약 실행량을 포함해야 합니다.");
assert.match(source, /lookups \+ lookupsReserved/, "남은 키워드 한도에는 예약 조회량을 포함해야 합니다.");
assert.match(source, /Math\.max\(0, subscription\.runLimit - runsUsed\)/, "남은 실행 한도는 음수로 표시하면 안 됩니다.");
assert.match(source, /Number\.isSafeInteger\(subscription\.keywordLookupLimit\)/, "검증된 정수 한도만 고객에게 표시해야 합니다.");
assert.match(source, /Number\.isSafeInteger\(number\) && number >= 0 \? number : null/, "손상된 사용량은 숫자로 표시하지 않아야 합니다.");
assert.match(source, /Number\.isFinite\(endDate\.getTime\(\)\)/, "손상된 구독 종료일은 정상 날짜로 표시하면 안 됩니다.");
assert.match(source, /usableStatus && !validEnd \? "기간 확인 필요"/, "이용 중 상태라도 종료일이 없으면 기간 확인이 필요하다고 표시해야 합니다.");
assert.match(source, /usableStatus && endDate <= now \? "만료됨"/, "문서 상태가 남아 있어도 지난 이용 기간은 만료로 표시해야 합니다.");
assert.match(source, /data\.status === "past_due" \? validGrace && graceDate > now \? "결제 확인 필요" : "이용 중지"/, "결제 유예 종료 전후 상태를 구분해야 합니다.");
assert.match(source, /"자동결제 재시도 중"/, "결제 실패 뒤 자동 재시도 상태를 고객에게 표시해야 합니다.");
assert.match(source, /failed \? nextDate \? `다음 재시도/, "실패 결제의 다음 날짜를 새 결제일로 오인하게 표시하면 안 됩니다.");
assert.match(source, /subscription:cancel/, "고객 구독 화면에서 다음 회차 자동결제 해지 API를 호출해야 합니다.");
assert.match(source, /window\.confirm\("다음 회차 자동결제를 해지할까요\?/, "자동결제 해지는 고객의 직전 확인을 받아야 합니다.");
assert.match(source, /현재 이용 기간은 유지됩니다/, "해지가 즉시 이용 중단이나 환불로 오인되지 않아야 합니다.");
console.log("구독 기간과 완료량·예약량을 반영하는 고객 표시를 확인");

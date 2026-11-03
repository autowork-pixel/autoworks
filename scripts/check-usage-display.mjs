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
assert.match(source, /usableStatus && endDate <= new Date\(\) \? "만료됨"/, "문서 상태가 남아 있어도 지난 이용 기간은 만료로 표시해야 합니다.");
console.log("구독 기간과 완료량·예약량을 반영하는 고객 표시를 확인");

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
assert.match(source, /runs \+ runsReserved/, "남은 실행 한도에는 예약 실행량을 포함해야 합니다.");
assert.match(source, /lookups \+ lookupsReserved/, "남은 키워드 한도에는 예약 조회량을 포함해야 합니다.");
assert.match(source, /Math\.max\(0, subscription\.runLimit - runsUsed\)/, "남은 실행 한도는 음수로 표시하면 안 됩니다.");
assert.match(source, /Number\.isSafeInteger\(subscription\.keywordLookupLimit\)/, "검증된 정수 한도만 고객에게 표시해야 합니다.");
assert.match(source, /Number\.isSafeInteger\(number\) && number >= 0 \? number : null/, "손상된 사용량은 숫자로 표시하지 않아야 합니다.");
console.log("구독 한도에서 완료량과 예약량을 함께 차감하는 고객 표시를 확인");

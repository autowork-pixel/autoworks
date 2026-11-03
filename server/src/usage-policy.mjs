import { ApiError } from "./domain.mjs";

function nonNegativeInteger(value, name) {
  const number = Number(value ?? 0);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new ApiError("USAGE_STATE_INVALID", `${name} 정보를 확인할 수 없습니다.`, 503);
  }
  return number;
}

function planLimit(value, name) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new ApiError("SUBSCRIPTION_REQUIRED", `${name}이 설정된 구독이 필요합니다.`, 403);
  }
  return number;
}

export function reserveUsageCapacity({ plan, usage = {}, requestedKeywords }) {
  const runLimit = planLimit(plan?.runLimit, "실행 한도");
  const keywordLookupLimit = planLimit(plan?.keywordLookupLimit, "키워드 조회 한도");
  const requested = nonNegativeInteger(requestedKeywords, "요청 키워드 수");
  if (requested < 1) throw new ApiError("INVALID_INPUT", "한 개 이상의 키워드가 필요합니다.");

  const current = {
    runsReserved: nonNegativeInteger(usage.runsReserved, "예약 실행량"),
    runs: nonNegativeInteger(usage.runs, "완료 실행량"),
    keywordLookupsReserved: nonNegativeInteger(usage.keywordLookupsReserved, "예약 키워드 조회량"),
    keywordLookups: nonNegativeInteger(usage.keywordLookups, "완료 키워드 조회량"),
    succeeded: nonNegativeInteger(usage.succeeded, "성공 실행량"),
    failed: nonNegativeInteger(usage.failed, "실패 실행량")
  };
  if (current.runs + current.runsReserved + 1 > runLimit) {
    throw new ApiError("USAGE_LIMIT_EXCEEDED", "이번 기간의 실행 한도를 초과했습니다.", 429);
  }
  if (current.keywordLookups + current.keywordLookupsReserved + requested > keywordLookupLimit) {
    throw new ApiError("USAGE_LIMIT_EXCEEDED", "이번 기간의 키워드 조회 한도를 초과했습니다.", 429);
  }
  return {
    ...current,
    nextRunsReserved: current.runsReserved + 1,
    nextKeywordLookupsReserved: current.keywordLookupsReserved + requested
  };
}

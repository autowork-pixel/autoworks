import { ApiError } from "./domain.mjs";

export function assertAutomationAllowed(control) {
  if (control?.blocked === true) {
    throw new ApiError("AUTOMATION_PAUSED", "운영 예산 또는 안전 점검으로 새 실행이 잠시 중지되었습니다.", 503);
  }
}


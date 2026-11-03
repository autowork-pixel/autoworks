# 베타 구독·사용량 규칙

작성일: 2026-11-03

가격과 실행 한도는 실제 반복 사용·API 원가·지원 부담 자료가 쌓이기 전까지 확정하지 않는다. 기존 199,000원 이상 요금 초안은 현재 첫 기능 범위와 맞지 않아 사용하지 않는다.

## 상태

- `pending`: 결제 또는 베타 승인 전
- `trialing`: 무료 베타 기간
- `active`: 현재 기간 이용 가능
- `past_due`: 갱신 결제 실패, 유예 정책 확인 필요
- `canceled`: 다음 갱신 취소. `periodEnd` 전까지의 사용 여부는 서버 정책으로 결정
- `expired`: 이용 기간 종료

기능 실행 서버는 매 요청에서 Firebase ID token, workspace 소유권, `status`, `periodEnd`, 월 사용량을 순서대로 확인한다. 브라우저 표시만으로 실행 권한을 결정하지 않는다.

## 사용량

- 집계 기간은 Asia/Seoul 기준 달력 월을 기본으로 하되 정기결제 도입 시 결제 주기와 비교해 확정한다.
- `usage/{YYYY-MM}`의 `runs`, `keywordLookups`, `succeeded`, `failed`는 화면용 집계다.
- 차감은 서버가 작업을 수락한 시점에 예약하고, 제공자 오류·재시도·환불성 복구 규칙은 Q5-1에서 원장과 함께 확정한다.
- 동시 요청은 트랜잭션으로 한도를 예약해 초과 실행을 막는다.
- API 제공자 쿼터와 오토웍스 구독 한도는 별도로 표시한다.

## 공개 구독 요약

`workspaces/{workspaceId}/subscriptions/current`에는 고객에게 보여도 되는 필드만 저장한다.

- `planId`, `planLabel`, `status`
- `periodStart`, `periodEnd`
- `runLimit`, `keywordLookupLimit`
- `updatedAt`

billing key, payment key, 카드·계좌 정보, 웹훅 원문은 이 문서에 넣지 않는다. 고객은 공개 요약을 읽기만 하고 서버만 변경한다.

## 아직 확정하지 않는 항목

- 월 9,900원/19,900원 후보 중 실제 가격
- 월 실행 횟수·키워드 조회량
- 결제 실패 유예 기간과 해지 후 잔여 기간 사용
- 제공자 장애·실패 작업의 차감 복구 방식

# 공통 실행·상태·오류 모델

작성일: 2026-11-03

## 요청 수락 순서

1. Firebase ID token을 검증하고 `uid`를 얻는다.
2. `workspaceId` 소유권과 고객 차단 상태를 확인한다.
3. 구독 상태·기간·월 사용량·동시 실행 한도를 확인한다.
4. 필요한 제공자 자격정보가 존재하는지 서버에서 확인한다. 키 원문은 로그에 남기지 않는다.
5. 고객 요청의 `idempotencyKey`로 기존 실행을 조회한다. 같은 키면 새 실행을 만들지 않고 기존 `runId`를 반환한다.
6. 트랜잭션으로 사용량을 예약하고 `runs/{runId}`를 `queued`로 만든다.

## 상태 전이

- `queued → validating → running → succeeded`
- 일시 오류: `running → retrying → running`
- 영구 오류 또는 재시도 소진: `running | retrying → failed`
- 실행 전 고객 취소: `queued | validating → canceled`
- 완료 상태인 `succeeded | failed | canceled`에서는 다시 이동하지 않는다.

각 전이는 서버 시각과 `requestId`를 기록한다. 작업자는 `workerId`, `leaseOwner`, `leaseExpiresAt`을 트랜잭션으로 확보하며, lease가 유효한 동안 다른 작업자는 같은 실행을 시작하거나 완료·실패로 확정할 수 없다. 만료된 lease만 다른 작업자가 이어받을 수 있다.

## 고객용 오류 코드

- `INVALID_INPUT`: 입력 형식 또는 필수값 오류, 재시도하지 않음
- `AUTH_REQUIRED`: 로그인·소유권 확인 실패, 재로그인 안내
- `SUBSCRIPTION_REQUIRED`: 구독 상태 또는 기간 문제
- `USAGE_LIMIT_EXCEEDED`: 이번 기간 한도 초과
- `PROVIDER_CREDENTIAL_REQUIRED`: 외부 서비스 연결 필요
- `PROVIDER_AUTH_FAILED`: 제공자 키 만료·권한 부족, 키 교체 안내
- `PROVIDER_RATE_LIMIT`: 제공자 호출 제한, `nextRetryAt`이 있으면 자동 재시도
- `PROVIDER_QUOTA_EXCEEDED`: 제공자 계정 잔액·쿼터 부족, 고객 조치 필요
- `PROVIDER_UNAVAILABLE`: 제공자 일시 장애, 제한된 횟수만 재시도
- `INTERNAL_ERROR`: 내부 오류. 상세 stack·payload는 고객 문서에 넣지 않는다

## 재시도

- 재시도 가능 여부를 `retryable`로 명시하고 지수 백오프와 최대 횟수를 둔다.
- 같은 실행의 재시도는 새 사용량을 중복 차감하지 않는다.
- 일시 오류는 1분부터 지수 백오프하고 최대 15분으로 제한한다. `attempt < maxAttempts`일 때만 `retrying`으로 되돌리며 lease를 해제하고 `nextRetryAt`을 기록한다.
- 제공자 응답이 불명확하면 먼저 조회 API로 결과를 복구하고, 조회가 불가능할 때만 안전한 요청을 재시도한다.
- `INVALID_INPUT`, 인증 실패, 쿼터 소진은 자동 재시도하지 않는다.

## 사용량·비용

- 요청 수락 시 `usageReservationId`를 만들고 예상 사용량을 예약한다.
- 성공 시 실제 호출량과 비용으로 확정하고, 실행 전 실패·취소는 예약을 해제한다.
- 제공자 호출 후 응답 유실처럼 비용이 발생했을 수 있는 경우 조회·운영 확인 전 자동 환급하지 않는다.
- 화면용 월 집계와 결제·정산용 원장은 분리한다.
- 예약 시점의 `usagePeriod`를 실행·예약 문서에 함께 저장해 월 경계를 넘어 완료돼도 원래 예약한 월에서 확정한다.
- 완료·실패 트랜잭션은 예약 상태, 월 집계, 실행 상태, 멱등 요청 상태를 함께 갱신한다. 동일 완료 호출은 이미 종료된 상태를 반환하고 다시 차감하지 않는다.
- 고객 한도에는 논리 실행과 원래 키워드 수를 한 번만 확정하고, 재시도로 늘어난 실제 제공자 조회 횟수는 `providerKeywordAttempts`로 별도 누적해 원가 분석에 사용한다.

## 보안과 관측

- 구조화 로그에는 `requestId`, `runId`, `workspaceId`의 내부 식별자, 상태, 오류 코드, 지연시간만 둔다.
- API 키, 토큰, Authorization 헤더, 고객 원문 입력, 결제 자격정보는 로그와 `runs`에 저장하지 않는다.
- 관리자 화면은 고객에게 공개 가능한 실행 요약과 오류 코드만 읽는다.
- 내부 실행 엔드포인트는 고객 Firebase ID 토큰이 아니라 전용 Cloud Tasks 서비스 계정의 OIDC 토큰, 고정 audience와 issuer를 검증한다. 큐에는 `workspaceId`와 `runId`만 넣고 입력·제공자 키는 서버가 실행 시점에 소유권 경로에서 불러온다.

# 오토웍스 고객별 실행 데이터 계약

작성일: 2026-11-03

모든 실행 데이터는 `workspaces/{workspaceId}` 아래에 저장한다. 브라우저는 소유한 워크스페이스의 공개 데이터만 읽고, 실행 기록과 결과·사용량은 서버만 쓴다. Firebase Admin SDK는 Firestore Rules를 우회하므로 서버는 매 요청에서 Firebase ID 토큰과 `ownerUid`를 다시 확인해야 한다.

## 컬렉션

### `projects/{projectId}`

- `name`, `brandName`, `keywords`
- `createdAt`, `updatedAt`
- 고객이 생성·조회할 수 있다. 현재 삭제는 막는다.

### `runs/{runId}`

- `projectId`, `tool`, `toolLabel`
- `status`: `queued | validating | running | retrying | succeeded | failed | canceled`
- `inputSummary`: 화면 표시용 요약. API 키·원문 인증정보·민감 입력은 넣지 않는다.
- `requestId`, `attempt`, `maxAttempts`, `retryable`. 고객이 보낸 멱등키 원문은 실행 문서에 저장하지 않는다.
- `resultReportId`, `errorCode`, `errorMessage`: 고객에게 보여도 되는 코드와 요약만 저장한다.
- `usageReservationId`, `estimatedCost`, `actualCost`: 사용량·원가 원장 참조와 집계값. 제공자 키나 요청 원문은 넣지 않는다.
- `createdAt`, `validatedAt`, `startedAt`, `nextRetryAt`, `completedAt`
- 서버만 생성·변경하고 고객은 자신의 워크스페이스에서 읽기만 한다.
- 상태 전이·재시도·사용량 예약 기준은 `RUN_EXECUTION_MODEL.md`를 따른다.

### `searchSnapshots/{snapshotId}`

- `projectId`, `keyword`, `pc`, `mobile`, `recordedAt`
- 네이버 키워드도구에서 조회한 **월간 PC·모바일 검색량의 기록 시점 스냅샷**이다. 날짜별 실제 검색 건수가 아니다.
- 서버만 생성·변경하고 고객은 읽기만 한다.

### `reports/{reportId}`

- `projectId`, `runId`, `title`, `status`, `summary`, `createdAt`
- 파일 경로나 제한 URL은 서버가 소유권을 확인한 뒤 발급한다. 영구 공개 URL을 문서에 저장하지 않는다.
- 서버만 생성·변경하고 고객은 읽기만 한다.

### `usage/{YYYY-MM}`

- `runs`, `keywordLookups`, `runsReserved`, `keywordLookupsReserved`, `succeeded`, `failed`, `updatedAt`
- 결제용 확정 원장과 화면용 집계를 분리한다. 현재는 실행 현황 표시용이며 구독 차감 기준은 Q4에서 확정한다.
- 서버만 생성·변경하고 고객은 읽기만 한다.

### 서버 전용 실행 제어 경로

- `serverControls/access`: `blocked`로 서버 실행 차단 여부를 관리한다. 브라우저는 읽거나 쓸 수 없다.
- `runInputs/{runId}`: 작업자가 읽을 정규화된 브랜드·경쟁사·키워드·표시 기간·반올림 단위를 보관한다. 고객 공개 `runs`에는 요약만 두며 제공자 자격정보는 어느 실행 입력에도 복사하지 않는다.
- `runRequests/{privateHash}`: 사용자 uid와 멱등키로 만든 비가역 해시를 문서 ID로 사용하고 `runId`, `requestDigest`, `status`만 저장한다. 멱등키 원문은 저장하지 않는다.
- `usageReservations/{runId}`: 실행 시작 전 예약한 `runs`, `keywordLookups`와 `reserved | committed | released` 상태를 보관한다.
- 이 경로들은 Firebase Admin SDK를 쓰는 서버만 접근하고, 성공·실패·취소 시 같은 트랜잭션에서 예약을 확정하거나 해제한다.

### `inquiries/{inquiryId}`

- `subject`, `message`, `status`, `createdAt`, `updatedAt`
- 서버 답변이 생기면 `reply`, `respondedAt`을 추가한다.
- 상태는 `open | reviewing | answered | closed`로 두며 고객은 자신의 문의를 생성·조회만 하고, 상태와 답변은 서버·운영자만 변경한다.
- 제목은 100자, 내용은 2,000자로 제한하며 API 키·비밀번호·결제정보를 문의에 넣지 않도록 화면에서 안내한다.

### `providerCredentials/{provider}`

- 브라우저 읽기·쓰기를 전부 거부한다.
- 서버에서 AES-256-GCM으로 암호화한 `ciphertext`, `iv`, `authTag`와 KMS가 감싼 `encryptedDataKey`, `keyVersion`, 비민감 `apiKeyHint`, `status`, `updatedAt`만 저장한다. 원문 키, 평문 데이터 키, Authorization 헤더, 토큰을 로그·실행 문서·보고서에 복사하지 않는다.
- KMS는 Cloud Billing과 키 수명주기 결정 뒤 연결한다. 저장 전 암호화·변조 감지 봉투 형식은 서버 단위 테스트로 고정했다.
- 연결 서비스 계층은 `uid`와 `workspaceId`를 저장소 권한 검증에 항상 전달하고, 암호화 성공·실패와 관계없이 평문 데이터 키 버퍼를 즉시 0으로 덮어쓴다.

### `subscriptions/{subscriptionId}`

- 고객에게 공개하는 `current` 문서에는 `planId`, `planLabel`, `status`, `periodStart`, `periodEnd`, `runLimit`, `keywordLookupLimit`, `updatedAt`만 둔다.
- 고객은 자신의 공개 요약만 읽고 쓰기는 할 수 없다. 운영자는 읽기만 가능하다.
- 결제 이벤트와 서버 검증을 거친 상태만 서버가 기록한다. billing key, payment key, 주문 원장과 웹훅 원문은 별도 서버 전용 경로에 보관한다.

### `auditLogs/{auditId}`

- `action`, `actorUid`, `actorRole`, `targetType`, `targetId`, `reason`
- `requestId`, `beforeSummary`, `afterSummary`, `createdAt`
- 관리자 권한·구독·고객 차단·문의 상태 등 운영 조치를 서버가 변경과 같은 트랜잭션에서 추가한다.
- 고객과 브라우저는 생성·수정·삭제할 수 없다. 관리자 claim은 읽기만 가능하며, API 키·토큰·문의 원문 같은 민감값은 기록하지 않는다.
- 상세 기록 기준과 권한 절차는 `OPERATIONS_SECURITY.md`를 따른다.

### 결제 경로

- `paymentSummaries/current`: 고객에게 공개하는 최근 결제 요약. `status`, `amount`, `currency`, `paidAt`, `nextBillingAt`, `updatedAt`만 저장하고 고객은 읽기만 한다.
- `paymentEvents/{eventId}`: 서버가 처리한 승인·실패·취소·웹훅 사건. 운영자는 읽기만 하고 고객은 직접 읽지 않는다. 이벤트 원문과 카드·계좌 정보는 넣지 않는다.
- `billingCredentials/current`: 빌링키와 `customerKey` 등 재결제 자격정보. 브라우저와 관리자 화면 모두 읽기·쓰기를 거부하고 서버 보안 저장소에서만 다룬다.
- 구체적인 멱등성·검증 순서는 `TOSS_PAYMENTS_PLAN.md`를 따른다.

## 보류된 실제 검증

- 실제 Google 계정에서 브랜드 프로젝트 저장·재조회
- 다른 실제 계정으로 같은 workspace ID 접근 차단 확인
- 로그아웃 뒤 워크스페이스와 실행 데이터 화면이 닫히는지 확인
- Cloud Run 배포 후 서버 쓰기와 ID 토큰·소유권 검증
- Cloud Storage 결과 파일의 소유권, 만료 URL, 삭제·보존 확인

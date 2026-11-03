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
- `status`: `queued | running | succeeded | failed`
- `inputSummary`: 화면 표시용 요약. API 키·원문 인증정보·민감 입력은 넣지 않는다.
- `resultReportId`, `errorCode`
- `createdAt`, `startedAt`, `completedAt`
- 서버만 생성·변경하고 고객은 자신의 워크스페이스에서 읽기만 한다.

### `searchSnapshots/{snapshotId}`

- `projectId`, `keyword`, `pc`, `mobile`, `recordedAt`
- 네이버 키워드도구에서 조회한 **월간 PC·모바일 검색량의 기록 시점 스냅샷**이다. 날짜별 실제 검색 건수가 아니다.
- 서버만 생성·변경하고 고객은 읽기만 한다.

### `reports/{reportId}`

- `projectId`, `runId`, `title`, `status`, `summary`, `createdAt`
- 파일 경로나 제한 URL은 서버가 소유권을 확인한 뒤 발급한다. 영구 공개 URL을 문서에 저장하지 않는다.
- 서버만 생성·변경하고 고객은 읽기만 한다.

### `usage/{YYYY-MM}`

- `runs`, `keywordLookups`, `succeeded`, `failed`, `updatedAt`
- 결제용 확정 원장과 화면용 집계를 분리한다. 현재는 실행 현황 표시용이며 구독 차감 기준은 Q4에서 확정한다.
- 서버만 생성·변경하고 고객은 읽기만 한다.

### `inquiries/{inquiryId}`

- `subject`, `message`, `status`, `createdAt`, `updatedAt`
- 서버 답변이 생기면 `reply`, `respondedAt`을 추가한다.
- 상태는 `open | reviewing | answered | closed`로 두며 고객은 자신의 문의를 생성·조회만 하고, 상태와 답변은 서버·운영자만 변경한다.
- 제목은 100자, 내용은 2,000자로 제한하며 API 키·비밀번호·결제정보를 문의에 넣지 않도록 화면에서 안내한다.

### `providerCredentials/{provider}`

- 브라우저 읽기·쓰기를 전부 거부한다.
- 서버에서 암호화한 값과 키 버전만 저장한다. 원문 키, Authorization 헤더, 토큰을 로그·실행 문서·보고서에 복사하지 않는다.

### `subscriptions/{subscriptionId}`

- 브라우저 읽기·쓰기를 전부 거부한다.
- 결제 이벤트와 서버 검증을 거친 상태만 기록한다.

## 보류된 실제 검증

- 실제 Google 계정에서 브랜드 프로젝트 저장·재조회
- 다른 실제 계정으로 같은 workspace ID 접근 차단 확인
- 로그아웃 뒤 워크스페이스와 실행 데이터 화면이 닫히는지 확인
- Cloud Run 도입 후 서버 쓰기와 ID 토큰·소유권 검증
- Cloud Storage 결과 파일의 소유권, 만료 URL, 삭제·보존 확인

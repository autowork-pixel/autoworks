# 자동화 서버 배포 준비

작성일: 2026-11-03

운영 리전은 서울(`asia-northeast3`), 개발/운영 프로젝트는 분리하고 Cloud Run 실행 계정과 Tasks/Scheduler 호출 계정을 분리한다. 초기 월 예산은 50,000원이며 50%·80%·100% 알림과 100% 신규 실행 차단을 적용한다. 실제 자원 생성·결제 연결은 사용자 계정에서 별도 승인 후 진행한다.

## 필요한 자원

- Cloud Run 서비스 1개: 공개 고객 API, OIDC 작업자, OIDC 복구 엔드포인트를 같은 이미지에서 제공한다.
- Cloud Tasks 큐 1개: 브랜드 검색량 실행을 결정적 작업명으로 등록한다.
- Cloud Scheduler 작업 1개: `/internal/v1/recovery:run`을 주기적으로 호출한다.
- Pub/Sub topic·push subscription 각 1개: Cloud Billing 예산 알림을 OIDC로 내부 수신한다.
- Cloud KMS 대칭 키 1개: 고객 제공자 자격정보의 데이터 키만 감싼다.
- 전용 서비스 계정 1개 이상: Tasks/Scheduler 호출 신원과 Cloud Run 실행 신원을 분리하는 것을 권장한다.

## 필수 런타임 설정

| 환경변수 | 예시 | 용도 |
|---|---|---|
| `GOOGLE_CLOUD_PROJECT` | `autoworks-c9a6a` | Firebase·Tasks·KMS 프로젝트 경계 |
| `TASKS_LOCATION` | `asia-northeast3` | Cloud Tasks 리전 |
| `TASKS_QUEUE` | `brand-search` | 실행 큐 이름 |
| `SERVICE_URL` | `https://SERVICE.run.app` | 작업자 호출 기준 URL |
| `WORKER_AUDIENCE` | `SERVICE_URL`과 동일 | OIDC audience. 생략 시 서비스 URL 사용 |
| `TASK_SERVICE_ACCOUNT_EMAIL` | 전용 서비스 계정 | Tasks/Scheduler OIDC 신원 |
| `KMS_KEY_NAME` | `projects/.../cryptoKeys/...` | 자격정보 데이터 키를 감싸는 키 |
| `WEB_ORIGINS` | Hosting 도메인 2개 | 브라우저 CORS 허용 목록 |
| `BUDGET_DISPLAY_NAME` | `autoworks-development-monthly-50000` | 다른 예산 알림을 거부하는 정확한 표시 이름 |
| `NAVER_OAUTH_CLIENT_ID`, `NAVER_OAUTH_CLIENT_SECRET` | 네이버 앱 값 | 네이버 앱이 준비된 경우에만 둘 다 설정 |
| `KAKAO_OAUTH_CLIENT_ID`, `KAKAO_OAUTH_CLIENT_SECRET` | 카카오 앱 값 | 카카오 앱이 준비된 경우에만 둘 다 설정 |

서버는 누락·HTTP URL·다른 프로젝트의 KMS 키·경로가 붙은 웹 출처를 시작 전에 거부한다. OAuth callback은 `SERVICE_URL/v1/auth/{provider}/callback`으로 고정하고 디벨로퍼 콘솔 등록값과 정확히 일치시킨다. OAuth client secret은 Secret Manager에서 런타임 환경으로 주입하고 Hosting 파일·브라우저·일반 로그에 넣지 않는다. 고객 자격정보는 인증된 API로만 저장한다.

## 최소 권한 원칙

- Cloud Run 실행 계정: Firestore에 필요한 문서 접근, 선택한 KMS 키의 encrypt/decrypt, 지정 Tasks 큐의 작업 생성만 허용한다.
- Tasks/Scheduler 호출 계정: 해당 Cloud Run 서비스 호출 권한만 허용한다.
- 사람 계정에 런타임 서비스 계정 키 파일을 발급하지 않는다. Cloud Run 기본 자격증명과 OIDC를 사용한다.
- Cloud Run의 내부 경로는 OIDC 토큰의 audience, 이메일, `email_verified`, subject가 모두 일치해야 실행한다.

## 승인 후 순서

1. 월 예산·알림과 운영/개발 프로젝트 분리를 확정한다.
2. KMS 키링·키, Tasks 큐, 서비스 계정을 만들고 최소 IAM을 적용한다.
3. `server/Dockerfile` 이미지로 Cloud Run을 배포하고 필수 환경변수를 설정한다.
4. Cloud Run URL을 `SERVICE_URL`·`WORKER_AUDIENCE`에 고정하고 새 revision을 배포한다.
5. Scheduler가 OIDC로 복구 엔드포인트를 호출하고 Pub/Sub push subscription이 같은 전용 호출 신원으로 예산 알림 엔드포인트를 호출하도록 연결한다.
6. `public/runtime-config.js`의 `AUTOWORKS_API_BASE`를 Cloud Run HTTPS origin으로 설정하고 Hosting을 배포한다. 이 파일에는 URL 외 비밀정보를 넣지 않는다.
7. `/health-check`, CORS 사전 요청, 로그인 고객 예약, Tasks 작업자, 결과 CSV, 취소, 재시도 복구를 순서대로 검증한다.

개발 환경은 GitHub Actions의 **Deploy development Cloud Run API** 워크플로로 위 3~4단계를 재현한다. 고정된 개발 프로젝트·리전·서비스 계정·KMS 키만 사용하며, 실행 시 확인값 `DEPLOY_DEV`를 직접 입력해야 한다.

워크플로는 먼저 전체 서버·런타임·컨테이너 검사를 실행한다. 최초 revision은 임시 HTTPS audience로 기동한 뒤 실제 Cloud Run URL을 조회해 `SERVICE_URL`과 `WORKER_AUDIENCE`를 즉시 고정한다. 공개 `/health-check` 성공과 무인증 내부 복구·예산 경로의 401 거부를 확인한다. 이후 선택 항목은 서로 분리되어 있다. `connect_oauth_secrets`는 이미 Secret Manager에 등록된 네이버·카카오 값의 참조만 연결하고, `connect_operations`는 Scheduler·예산 push를 연결하며, `connect_hosting`은 공개 API URL을 Hosting에 기록해 배포한다.

OAuth 값은 아래 이름으로 Secret Manager에 각각 등록한다. 값은 GitHub·Hosting·일반 로그에 복사하지 않는다.

- `autoworks-naver-oauth-client-id`
- `autoworks-naver-oauth-client-secret`
- `autoworks-kakao-oauth-client-id`
- `autoworks-kakao-oauth-client-secret`

네 secret에 활성 버전이 모두 생긴 뒤 `connect_oauth_secrets`를 선택하면 `scripts/connect-oauth-dev.sh`가 값을 읽지 않고 실행 계정에 각 secret의 accessor 권한만 부여해 Cloud Run 환경변수 참조를 연결한다. 일반 재배포는 `--update-env-vars`를 사용하므로 기존 secret 참조를 지우지 않는다. OAuth·토스 비밀값은 기본 배포에 포함하지 않는다.

`smoke:development-api`는 배포 URL의 health-check, 허용 Hosting origin CORS, P1~P8 핵심 고객 API의 무인증 401, 내부 복구 경로의 무인증 401을 확인한다. 실제 고객 토큰·외부 제공자 키·결제는 사용하지 않는다.

배포 뒤에는 비용 없는 읽기 전용 인증 스모크를 실행한다. 토큰은 셸 환경변수로만 전달하고 명령 기록·증빙 파일·GitHub에 넣지 않는다. A 계정만 주면 본인 실행 목록과 제공자 연결 상태의 비밀정보 비노출을 확인하고, A·B 두 계정을 모두 주면 서로의 워크스페이스 접근이 403으로 차단되는지도 확인한다.

```powershell
$env:AUTOWORKS_API_BASE = "https://SERVICE.run.app"
$env:AUTOWORKS_TEST_A_TOKEN = "<일회성 Firebase ID token>"
$env:AUTOWORKS_TEST_A_WORKSPACE = "<A workspace id>"
$env:AUTOWORKS_TEST_B_TOKEN = "<일회성 Firebase ID token>"
$env:AUTOWORKS_TEST_B_WORKSPACE = "<B workspace id>"
$env:AUTOWORKS_EVIDENCE_PATH = "artifacts/development-authenticated-smoke.json"
npm run smoke:authenticated-api
```

이 스모크는 `GET`만 사용해 제공자 호출·사용량 예약·결제를 발생시키지 않는다. 증빙에는 API origin, 시각, 검사명, HTTP 상태만 기록하고 토큰·workspace ID·응답 본문은 남기지 않는다.

결제 연결 뒤 Cloud Shell에서 `bash scripts/bootstrap-cloud-dev.sh APPLY_DEV`를 실행하면 필요한 API, 분리된 실행·호출 계정, 서울 리전 KMS 키, Tasks 큐와 예산 Pub/Sub topic을 멱등하게 준비한다. 인자를 생략하면 생성 없이 대상만 출력하며 서비스 계정 키 파일은 만들지 않는다. 배포 워크플로는 성공 후 호출 계정에 해당 서비스의 invoker만 부여하고 5분 주기 복구 Scheduler와 OIDC 예산 push subscription을 생성·갱신한다. Cloud Billing 예산 화면에서는 표시 이름을 정확히 `autoworks-development-monthly-50000`으로 지정하고 생성된 topic을 프로그램 알림으로 연결해야 한다.

예산 알림은 공식 schema `1.0`의 base64 JSON만 허용한다. 누적 비용 또는 실제비용 경고 기준이 100% 이상이면 `systemControls/automation.blocked=true`를 멱등 기록해 신규 실행을 막는다. Pub/Sub은 중복·역순 전달될 수 있으므로 100% 미만 알림은 자동 해제하지 않으며, 운영자가 비용 원인을 확인한 뒤 별도 승인으로만 재개한다. 예산 알림은 비용 반영이 지연될 수 있어 절대 지출 상한으로 간주하지 않는다.

재개 API는 관리자 claim, 정확한 `RESUME_AUTOMATION` 확인 문구와 10~500자의 사유를 요구한다. 상태와 비민감 감사 기록을 한 트랜잭션에 남기며, 이미 같은 상태인 요청은 재사용 처리한다.

## 중지 조건

- 다른 workspace 문서를 읽거나 수정할 수 있음
- 평문 API 키·OIDC 토큰·고객 입력이 로그에 남음
- 동일 요청이 사용량을 두 번 예약·확정함
- 작업 취소 뒤 질문 또는 결과가 실행됨
- Tasks/Scheduler 이외의 신원이 내부 엔드포인트를 호출함

위 항목이 하나라도 나타나면 신규 실행을 중지하고 `OPERATIONS_RUNBOOK.md`의 P0/P1 절차를 따른다.

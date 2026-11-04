# 자동화 서버 배포 준비

작성일: 2026-11-03

운영 리전은 서울(`asia-northeast3`), 개발/운영 프로젝트는 분리하고 Cloud Run 실행 계정과 Tasks/Scheduler 호출 계정을 분리한다. 초기 월 예산은 50,000원이며 50%·80%·100% 알림과 100% 신규 실행 차단을 적용한다. 실제 자원 생성·결제 연결은 사용자 계정에서 별도 승인 후 진행한다.

## 필요한 자원

- Cloud Run 서비스 1개: 공개 고객 API, OIDC 작업자, OIDC 복구 엔드포인트를 같은 이미지에서 제공한다.
- Cloud Tasks 큐 1개: 브랜드 검색량 실행을 결정적 작업명으로 등록한다.
- Cloud Scheduler 작업 1개: `/internal/v1/recovery:run`을 주기적으로 호출한다.
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
5. Scheduler가 OIDC로 복구 엔드포인트를 호출하도록 연결한다.
6. `public/runtime-config.js`의 `AUTOWORKS_API_BASE`를 Cloud Run HTTPS origin으로 설정하고 Hosting을 배포한다. 이 파일에는 URL 외 비밀정보를 넣지 않는다.
7. `/healthz`, CORS 사전 요청, 로그인 고객 예약, Tasks 작업자, 결과 CSV, 취소, 재시도 복구를 순서대로 검증한다.

개발 환경은 GitHub Actions의 **Deploy development Cloud Run API** 워크플로로 위 3~4단계를 재현한다. `development` 환경에 다음 Repository variable 세 개가 모두 있어야 하며, 실행 시 확인값 `DEPLOY_DEV`를 직접 입력해야 한다.

- `CLOUD_RUN_RUNTIME_SERVICE_ACCOUNT`
- `CLOUD_RUN_TASK_SERVICE_ACCOUNT`
- `CLOUD_RUN_KMS_KEY_NAME`

워크플로는 먼저 전체 서버·런타임·컨테이너 검사를 실행한다. 최초 revision은 임시 HTTPS audience로 기동한 뒤 실제 Cloud Run URL을 조회해 `SERVICE_URL`과 `WORKER_AUDIENCE`를 즉시 고정한다. 마지막에 공개 `/healthz` 성공과 무인증 내부 복구 경로의 401 거부를 확인한다. OAuth·토스 비밀값은 이 기본 배포에 포함하지 않고 Secret Manager 연결 퀘스트에서 별도로 주입한다.

## 중지 조건

- 다른 workspace 문서를 읽거나 수정할 수 있음
- 평문 API 키·OIDC 토큰·고객 입력이 로그에 남음
- 동일 요청이 사용량을 두 번 예약·확정함
- 작업 취소 뒤 질문 또는 결과가 실행됨
- Tasks/Scheduler 이외의 신원이 내부 엔드포인트를 호출함

위 항목이 하나라도 나타나면 신규 실행을 중지하고 `OPERATIONS_RUNBOOK.md`의 P0/P1 절차를 따른다.

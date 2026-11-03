# 자동화 서버 배포 준비

작성일: 2026-11-03

실제 Google Cloud 자원 생성과 배포는 Billing·월 예산·서비스 계정 범위를 사용자가 확인한 뒤 진행한다. 이 문서는 승인 전 준비 상태와 승인 후 실행 순서를 고정한다.

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

서버는 누락·HTTP URL·다른 프로젝트의 KMS 키·경로가 붙은 웹 출처를 시작 전에 거부한다. 비밀키는 환경변수에 넣지 않으며 고객 자격정보는 인증된 API로만 저장한다.

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
6. Hosting 화면의 API 기준 URL을 설정하고 Hosting을 배포한다.
7. `/healthz`, CORS 사전 요청, 로그인 고객 예약, Tasks 작업자, 결과 CSV, 취소, 재시도 복구를 순서대로 검증한다.

## 중지 조건

- 다른 workspace 문서를 읽거나 수정할 수 있음
- 평문 API 키·OIDC 토큰·고객 입력이 로그에 남음
- 동일 요청이 사용량을 두 번 예약·확정함
- 작업 취소 뒤 질문 또는 결과가 실행됨
- Tasks/Scheduler 이외의 신원이 내부 엔드포인트를 호출함

위 항목이 하나라도 나타나면 신규 실행을 중지하고 `OPERATIONS_RUNBOOK.md`의 P0/P1 절차를 따른다.

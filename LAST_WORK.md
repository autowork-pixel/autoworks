# 마지막 작업 및 이어서 할 일

업데이트: 2026-11-05 (한국시간)

## 2026-11-05 Cloud Run 404 복구 완료

- **원인 확정:** 새 리비전 배포·Ready·RoutesReady·ingress all·기본 URL·100% 트래픽·공개 IAM이 모두 정상인데 `/healthz`만 Google 프런트엔드 404를 반환하고 Cloud Run 요청 로그가 없었다. 같은 서비스의 `/health-check`는 컨테이너에 도달해 애플리케이션 JSON 404를 반환했다. Google Cloud 공개 이슈의 예약 경로 충돌 증상과 일치하므로 공개 상태 경로를 `/health-check`로 변경했다.
- 기존 공개 `GET /healthz` 구현과 로컬 테스트는 정상이었으며 서버 테스트 201개가 통과했다. Google 404가 애플리케이션 응답 전에 발생하는 정황과, 수정된 배포 워크플로가 실제 개발 서비스에 한 번도 실행되지 않은 기록을 확인했다.
- 개발 배포에 `--ingress all`, `--default-url`, 최신 리비전 100% 트래픽 전환을 명시했다. 스모크 테스트의 응답 계약도 실제 서버 응답 `{ "ok": true }`와 일치시켰다.
- Scheduler·예산 push·Firebase Hosting을 자동 변경하지 않도록 `connect_downstream` 기본값을 `false`로 분리했다. 복구 배포에서는 Cloud Run만 변경했고 후속 연결 단계는 실행하지 않았다.
- 첫 복구 실행은 GitHub `development` 환경 변수 3개가 비어 배포 전에 중단됐다. 비밀값이 아닌 고정 개발 리소스 식별자(실행 계정·호출 계정·KMS 키)를 워크플로에 명시해 별도 수동 변수 없이 같은 개발 자원만 사용하도록 보완했다.
- GitHub 배포 계정에는 Cloud Run Source Developer·Service Usage Consumer와 실행/기본 빌드 계정에 대한 Service Account User를 최소 범위로 부여했고, 기본 빌드 계정에는 Cloud Run Builder를 부여했다. 이 권한으로 새 리비전 빌드·배포·최신 트래픽 전환까지 성공했다.
- GitHub Actions 실행 `41945726842`에서 새 `/health-check` 200, 허용 origin CORS, 고객 API 무인증 401, 내부 API 무인증 401을 모두 통과했다. 외부에서도 `https://autoworks-api-dev-beh42zoxia-du.a.run.app/health-check`의 `200 {"ok":true}`를 재확인했다.

## 2026-11-05 OAuth 비밀값 연결 준비

- 재배포가 이미 연결된 Secret Manager 참조를 지우지 않도록 초기 Cloud Run 환경변수 적용을 `--update-env-vars`로 변경했다.
- 네이버·카카오 client ID/secret 네 값을 각각 별도 secret으로 두고, 값을 읽지 않은 채 실행 계정에 secret 단위 accessor만 부여해 Cloud Run 참조를 연결하는 보호 스크립트와 회귀 검사를 추가했다.
- 배포 선택 항목을 OAuth secret 연결, Scheduler·예산 push, Firebase Hosting 연결로 분리했다. 한 항목의 실행이 다른 운영 자원을 함께 변경하지 않는다.
- 실제 secret 생성·값 입력·OAuth 로그인은 실행하지 않았다. API 키나 비밀값은 코드·GitHub·증빙에 기록하지 않았다.
- 이후 네이버·카카오 값 4개를 Secret Manager에 직접 생성했다. 첫 연결 실행 `41948057884`는 Cloud Run 배포와 스모크까지 성공했지만 GitHub 배포 계정에 `secretmanager.secrets.get`이 없어 참조 연결 전에 안전 중단됐다. Hosting과 운영 자동화는 실행되지 않았다.
- 최소 권한을 위해 워크플로에서 IAM 변경을 제거했다. 각 secret에 실행 계정 `Secret Accessor`, 배포 계정 `Secret Manager Viewer`를 사람이 한 번 부여한 뒤 참조 연결만 재실행한다.

## 2026-11-04 개발 서버 배포 체크포인트

- 사용자 승인 후 `autoworks-c9a6a` 결제 계정에 월 50,000원 예산(50%·80%·100% 이메일 알림, `autoworks-budget-alerts` Pub/Sub 연결)을 만들었다. 예산은 비용 알림이며 지출 상한은 아니다.
- 서울 리전에 개발용 KMS 키, Tasks 큐, Pub/Sub topic, 분리된 실행·호출 서비스 계정을 만들었다. Cloud Run `autoworks-api-dev`를 최소 인스턴스 0·최대 1로 공개 배포하고 `SERVICE_URL`·`WORKER_AUDIENCE`를 `https://autoworks-api-dev-beh42zoxia-du.a.run.app`으로 설정했다. Cloud Shell 서버 테스트 201개 통과.
- 네이버·카카오 개발자 콘솔에 각각 `/v1/auth/naver/callback`, `/v1/auth/kakao/callback`을 위 URL로 등록하고 다시 읽어 저장을 확인했다.
- **해결됨:** 당시 `/healthz`는 Google 프런트엔드 예약 경로 충돌로 404를 반환했다. 2026-11-05 `/health-check`로 변경해 Cloud Run 배포와 스모크를 통과했다. Hosting API 연결, Scheduler·예산 push 구독, OAuth 비밀값 주입은 별도 후속 단계로 계속 보류한다.

## 마지막 기능 작업

- 작업: 최초 결제 승인 불확실 시 자동 재청구 차단
- 마지막 기능 커밋: `af41ab4`
- 내용: 외부 승인 호출 직전 서버 전용 세션을 `charge_started`로 기록한다. 승인 응답·KMS·저장소 확정에 문제가 생기면 `review_required`로 남기고 새 결제 세션과 자동 재시도를 차단한다. 결제 반환 화면도 운영 확인 상태에서는 재시도 버튼을 숨긴다. 이전 기능 커밋 `6be9ec4`는 카드 등록 시작, `0ece360`은 워크스페이스당 세션 재사용이다.
- 확인: 결제 저장소·서비스·핸들러 로컬 테스트 16개와 반환 화면 구문·정적 검사 통과. 실제 토스 주문 조회·Firestore 동시성·Cloud Run 배포는 실행하지 않았다.

## 지금 사용할 수 있는 범위

- GitHub 코드에는 Q5-3A~G 기능과 토스 정기결제 서버 코어가 포함된다. 이번 수정은 GitHub 저장까지 진행했으며 Hosting 공개 화면에는 이전 버전이 보일 수 있다.
- Cloud Run 개발 서비스의 `/health-check`와 무인증 보안 경계는 정상이다. 공개 Hosting의 API 주소는 아직 비워 두어 고객 키 저장과 실제 외부 API 실행 버튼은 비활성이다.
- Instagram 실제 Apify 응답·비용·계정 격리 검증은 Cloud Run 배포 후 진행한다.
- 2026-11-04 사용자 승인으로 개발용 과금 가능 자원과 예산을 생성했다. 실제 사용 비용과 예산 알림의 정상 작동은 확인하지 않았다.

## 다음 작업

1. `review_required` 주문의 토스 주문 조회·환불/복구 운영 절차를 실제 MID 승인 후 검증한다. 그 전에는 자동 재청구를 열지 않는다.
2. Secret Manager에 네이버·카카오 네 값을 직접 등록한 뒤 `connect_oauth_secrets`와 `connect_hosting`을 각각 실행하고 실제 로그인 계정으로 콜백을 확인한다.
3. 별도 실행으로 예산 push 구독·복구 Scheduler를 연결한 뒤 고객별 접근 경계를 확인한다.

작업을 마칠 때마다 **마지막 기능 커밋, 배포 범위, 확인 결과, 다음 작업**을 이 파일에 갱신하고 GitHub `main`에 저장한다. 전체 진행 기록은 [퀘스트 로그](QUEST_LOG.md), 사용자 확인 사항은 [검토 목록](USER_REVIEW.md)에 남긴다. API 키와 비밀정보는 기록하지 않는다.

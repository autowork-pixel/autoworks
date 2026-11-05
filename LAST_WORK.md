# 마지막 작업 및 이어서 할 일

업데이트: 2026-11-05 (한국시간)

## 2026-11-05 Cloud Run 404 복구 준비

- 서버의 공개 `GET /healthz` 구현과 로컬 테스트는 정상이며 서버 테스트 201개가 통과했다. Google 404가 애플리케이션 응답 전에 발생하는 정황과, 수정된 배포 워크플로가 실제 개발 서비스에 한 번도 실행되지 않은 기록을 확인했다.
- 개발 배포에 `--ingress all`, `--default-url`, 최신 리비전 100% 트래픽 전환을 명시했다. 스모크 테스트의 응답 계약도 실제 서버 응답 `{ "ok": true }`와 일치시켰다.
- 이번 404 복구가 성공해도 Scheduler·예산 push·Firebase Hosting을 자동 변경하지 않도록 `connect_downstream` 기본값을 `false`로 분리했다. 다음 단계는 이 변경을 GitHub에 저장하고 Cloud Run 개발 배포만 실행한 뒤 `/healthz` 200을 확인하는 것이다.

## 2026-11-04 개발 서버 배포 체크포인트

- 사용자 승인 후 `autoworks-c9a6a` 결제 계정에 월 50,000원 예산(50%·80%·100% 이메일 알림, `autoworks-budget-alerts` Pub/Sub 연결)을 만들었다. 예산은 비용 알림이며 지출 상한은 아니다.
- 서울 리전에 개발용 KMS 키, Tasks 큐, Pub/Sub topic, 분리된 실행·호출 서비스 계정을 만들었다. Cloud Run `autoworks-api-dev`를 최소 인스턴스 0·최대 1로 공개 배포하고 `SERVICE_URL`·`WORKER_AUDIENCE`를 `https://autoworks-api-dev-beh42zoxia-du.a.run.app`으로 설정했다. Cloud Shell 서버 테스트 201개 통과.
- 네이버·카카오 개발자 콘솔에 각각 `/v1/auth/naver/callback`, `/v1/auth/kakao/callback`을 위 URL로 등록하고 다시 읽어 저장을 확인했다.
- **차단 중:** Cloud Run은 Ready/공개 접근 상태이나 두 기본 `run.app` 주소의 `/healthz`가 Google 404를 반환한다. 기본 URL을 껐다 다시 켜고 다른 네트워크에서 확인해도 동일했다. Hosting 재배포 시도는 Firebase 업로드 재시도 소진으로 실패했고 기존 공개 웹은 HTTP 200으로 유지된다. 따라서 로그인, Hosting API 연결, Scheduler·예산 push 구독, 실제 고객 API 실행은 아직 완료하지 않았다. OAuth 비밀값도 서버에 주입하지 않았다. 다음 작업은 Cloud Run 라우팅 404 해결과 `/healthz` 200 확인이다.

## 마지막 기능 작업

- 작업: 최초 결제 승인 불확실 시 자동 재청구 차단
- 마지막 기능 커밋: `af41ab4`
- 내용: 외부 승인 호출 직전 서버 전용 세션을 `charge_started`로 기록한다. 승인 응답·KMS·저장소 확정에 문제가 생기면 `review_required`로 남기고 새 결제 세션과 자동 재시도를 차단한다. 결제 반환 화면도 운영 확인 상태에서는 재시도 버튼을 숨긴다. 이전 기능 커밋 `6be9ec4`는 카드 등록 시작, `0ece360`은 워크스페이스당 세션 재사용이다.
- 확인: 결제 저장소·서비스·핸들러 로컬 테스트 16개와 반환 화면 구문·정적 검사 통과. 실제 토스 주문 조회·Firestore 동시성·Cloud Run 배포는 실행하지 않았다.

## 지금 사용할 수 있는 범위

- GitHub 코드에는 Q5-3A~G 기능과 토스 정기결제 서버 코어가 포함된다. 이번 수정은 GitHub 저장까지 진행했으며 Hosting 공개 화면에는 이전 버전이 보일 수 있다.
- Cloud Run 개발 서비스는 배포됐지만 `/healthz`가 404이므로 공개 웹의 API 주소는 비워 두었다. 고객 키 저장과 실제 외부 API 실행 버튼은 비활성이다.
- Instagram 실제 Apify 응답·비용·계정 격리 검증은 Cloud Run 배포 후 진행한다.
- 2026-11-04 사용자 승인으로 개발용 과금 가능 자원과 예산을 생성했다. 실제 사용 비용과 예산 알림의 정상 작동은 확인하지 않았다.

## 다음 작업

1. `review_required` 주문의 토스 주문 조회·환불/복구 운영 절차를 실제 MID 승인 후 검증한다. 그 전에는 자동 재청구를 열지 않는다.
2. Cloud Run 기본 URL의 404 원인을 해결하고 `/healthz`·무인증 경계 스모크를 통과시킨다.
3. 서버 비밀값을 안전하게 연결한 뒤 네이버·카카오 실제 로그인 계정으로 콜백을 확인한다.
4. 예산 push 구독·복구 Scheduler와 Hosting API URL을 연결한 뒤 고객별 접근 경계를 확인한다.

작업을 마칠 때마다 **마지막 기능 커밋, 배포 범위, 확인 결과, 다음 작업**을 이 파일에 갱신하고 GitHub `main`에 저장한다. 전체 진행 기록은 [퀘스트 로그](QUEST_LOG.md), 사용자 확인 사항은 [검토 목록](USER_REVIEW.md)에 남긴다. API 키와 비밀정보는 기록하지 않는다.


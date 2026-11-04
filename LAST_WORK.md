# 마지막 작업 및 이어서 할 일

업데이트: 2026-11-04 (한국시간)

## 마지막 기능 작업

- 커밋: `a402921` — 관리자 화면의 전역 자동화 중지·재개 조치
- 내용: API 미배포 시 조치 버튼을 닫고, 관리자 ID token·정확한 확인 문구·사유를 서버 재검증 및 감사 기록 API에 전달
- 확인: HTML 모듈 구문, 관리자 조치 경계, 공개 파일 보안, 전체 로컬 링크 검사 통과

## 지금 사용할 수 있는 범위

- GitHub 코드에는 Q5-3A~G 기능과 토스 정기결제 서버 코어가 포함된다. Hosting 배포 전까지 공개 화면에는 이전 버전이 보일 수 있다.
- 서버 코드는 GitHub에 저장됐지만 Cloud Run은 배포되지 않았다. 현재 공개 웹의 API 주소는 비어 있어 고객 키 저장과 실제 외부 API 실행 버튼은 비활성이다.
- Instagram 실제 Apify 응답·비용·계정 격리 검증은 Cloud Run 배포 후 진행한다.
- 2026-11-04 콘솔 확인 결과 개발 프로젝트에는 Cloud Run 서비스와 전용 실행·호출 계정이 없고, 연결 가능한 활성 결제 계정도 없어 KMS·Cloud Run 자원을 만들 수 없다.

## 다음 작업

1. 폐쇄 상태가 아닌 활성 결제 계정을 준비해 개발 프로젝트 `autoworks-c9a6a`에 연결한다.
2. 개발 Google Cloud에 실행 계정·호출 계정·KMS 키·Tasks 큐·예산 Pub/Sub topic을 준비하고 GitHub `development` 환경 변수 3개를 등록한다.
3. 예산 표시 이름을 `autoworks-development-monthly-50000`으로 만들고 프로그램 알림 topic을 연결한다.
4. **Deploy development Cloud Run API**를 수동 실행한 뒤 `smoke:development-api`와 두 테스트 계정의 `smoke:authenticated-api`를 실행한다. 외부 계정·비용·검색 품질 확인은 [검토 목록](USER_REVIEW.md)에서 순차 확인한다.

작업을 마칠 때마다 **마지막 기능 커밋, 배포 범위, 확인 결과, 다음 작업**을 이 파일에 갱신하고 GitHub `main`에 저장한다. 전체 진행 기록은 [퀘스트 로그](QUEST_LOG.md), 사용자 확인 사항은 [검토 목록](USER_REVIEW.md)에 남긴다. API 키와 비밀정보는 기록하지 않는다.


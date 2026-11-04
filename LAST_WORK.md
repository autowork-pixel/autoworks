# 마지막 작업 및 이어서 할 일

업데이트: 2026-11-04 (한국시간)

## 마지막 기능 작업

- 커밋: `a1d1c90` — 개발 Cloud Run 수동 배포 준비
- 내용: 전체 사전검사, 필수 변수 검증, bootstrap revision, 실제 URL audience 고정, 공개·내부 경계 확인 워크플로
- 확인: 서버 테스트 176개와 런타임·컨테이너·API 연결·결제·인증·관리자·탈퇴·사용량 검사 통과

## 지금 사용할 수 있는 범위

- GitHub 코드에는 Q5-3A~G 기능과 토스 정기결제 서버 코어가 포함된다. Hosting 배포 전까지 공개 화면에는 이전 버전이 보일 수 있다.
- 서버 코드는 GitHub에 저장됐지만 Cloud Run은 배포되지 않았다. 현재 공개 웹의 API 주소는 비어 있어 고객 키 저장과 실제 외부 API 실행 버튼은 비활성이다.
- Instagram 실제 Apify 응답·비용·계정 격리 검증은 Cloud Run 배포 후 진행한다.

## 다음 작업

1. 개발 Google Cloud에 실행 계정·호출 계정·KMS 키·Tasks 큐를 준비하고 GitHub `development` 환경 변수 3개를 등록한다.
2. **Deploy development Cloud Run API**를 수동 실행한 뒤 실제 API URL을 Hosting runtime config에 연결한다. 외부 계정·비용·검색 품질 확인은 [검토 목록](USER_REVIEW.md)에서 순차 확인한다.

작업을 마칠 때마다 **마지막 기능 커밋, 배포 범위, 확인 결과, 다음 작업**을 이 파일에 갱신하고 GitHub `main`에 저장한다. 전체 진행 기록은 [퀘스트 로그](QUEST_LOG.md), 사용자 확인 사항은 [검토 목록](USER_REVIEW.md)에 남긴다. API 키와 비밀정보는 기록하지 않는다.


# 마지막 작업 및 이어서 할 일

업데이트: 2026-11-03 (한국시간)

## 마지막 기능 작업

- 커밋: `09821a7` — 고객별 YouTube 협업 게시물 성과 조회 흐름
- 내용: 프로젝트와 영상 URL 입력, YouTube Data API 공개 지표 조회, 고객별 결과·사용량 저장, 저장된 결과 재조회 화면
- 확인: 관련 서버 테스트 28개 통과, Hosting 배포 및 공개 페이지 검증 완료

## 지금 사용할 수 있는 범위

- [배포된 협업 게시물 화면](https://autoworks-c9a6a.web.app/collab-post.html)과 [API 연결 안내](https://autoworks-c9a6a.web.app/api-guide.html)를 볼 수 있다.
- 서버 코드는 GitHub에 저장됐지만 Cloud Run은 배포되지 않았다. 현재 공개 웹의 API 주소는 비어 있어 고객 키 저장과 실제 게시물 조회 버튼은 비활성이다.
- Instagram은 URL·공개 지표 조회 코드와 Apify 토큰 연결 코드까지 준비했다. 실제 실행 API와 화면 연결은 남아 있다.

## 다음 작업

1. Q5-3B Instagram 협업 게시물의 고객별 실행 API·결과 화면을 연결한다.
2. Cloud Run 배포 뒤 실제 고객 API 키로 YouTube·Instagram 조회, 실패 처리, 월 한도, 다른 계정 접근 차단을 검증한다. 운영 프로젝트의 결제 계정 미연결 상태는 [외부 게이트](EXTERNAL_GATES.md)에 기록했다.

작업을 마칠 때마다 **마지막 기능 커밋, 배포 범위, 확인 결과, 다음 작업**을 이 파일에 갱신하고 GitHub `main`에 저장한다. 전체 진행 기록은 [퀘스트 로그](QUEST_LOG.md)에 남긴다. API 키와 비밀정보는 기록하지 않는다.

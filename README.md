# 오토웍스 마케팅 자동화 웹

기존 로컬 자동화 기능을 월 구독형 웹 서비스로 전환하기 위한 베타 웹입니다.

## 미리보기

public/index.html을 브라우저에서 엽니다. 메뉴에서 대시보드, 도구 목록, API 연결 준비 상태와 베타 구독 상태를 확인할 수 있습니다. 작은 화면 메뉴도 지원합니다.

## 현재 범위

- 첫 베타 기능은 네이버 검색광고 키워드도구를 이용한 브랜드·경쟁 브랜드 검색량 조회로 확정
- 브랜드 검색량 입력·결과 화면과 API 요청·응답·오류 계약 준비
- 주간 광고 분석의 Excel 파일을 브라우저 안에서 읽고 지표·캠페인별 성과·점검 대상을 표시. 고객별 결과 저장·재조회·구독 한도 코드는 준비했으며 Cloud Run 미배포로 실서비스 저장은 비활성
- 협업 게시물 성과 조회는 YouTube 공개 영상의 입력·조회·고객별 결과 저장 코드를 준비. Cloud Run 미배포로 실서비스 조회는 비활성
- Firebase Hosting, Google 로그인, 고객별 워크스페이스·프로젝트·문의 저장 구조 준비
- 고객별 최근 실행·월 사용량·결과·구독·결제 요약 대시보드 준비
- 관리자 claim 기반 운영자 화면, 감사 로그와 고객 문의 응답 규칙 준비
- Firebase ID 토큰·소유권·구독·사용량·멱등성을 검사하는 브랜드 검색량 실행 예약 서버 코어 준비
- 고객 API 키의 KMS 봉투 암호화 저장·교체·삭제 API와 네이버 검색광고 작업자 코어를 구현하고 단위 테스트 완료. Cloud 자원과 실제 고객 키 연결은 아직 배포하지 않음
- 네이버·카카오 OAuth callback 코어, 관리자 문의·차단 API, 탈퇴 요청·상태 조회와 감사 기록을 구현. 실제 제공자 앱·관리자 claim·Cloud Run 배포는 아직 연결하지 않음
- 완료량과 동시 예약량을 합산하는 사용량 한도, 최근 실행·결과·남은 한도 고객 화면을 구현
- Toss 정기결제는 오토웍스 전용 상점 승인·운영 키·가격 확정 전까지 설계 문서와 비공개 데이터 경계만 준비
- 출시 가격과 실행 한도는 베타 자료가 쌓이기 전까지 미확정

## 다음 구현 단계

1. 운영/개발 프로젝트, Cloud Run·Tasks·KMS·Scheduler 월 예산과 IAM 범위를 확정합니다.
2. 서버를 배포하고 Hosting의 API 기준 URL을 연결한 뒤 두 실제 계정으로 프로젝트·실행·결과·API 연결 격리를 검증합니다.
3. 네이버·카카오 앱 callback과 관리자 claim을 실제 계정에서 등록·부여·회수 시험합니다.
4. 브랜드 검색량 실제 고객 키 호출, 재시도·취소·CSV 결과·사용량 정산을 베타 계정으로 검증합니다.
5. 오토웍스 전용 토스 상점과 가격·환불·해지 조건이 확정된 뒤 정기결제를 연결합니다.

결제 키와 PG 계약, 운영 도메인, 가격·한도가 확정되기 전까지는 실제 청구를 실행하지 않습니다.

## 서버 로컬 검증

`npm run test:server`로 요청 검증, 인증 실패, 고객 소유권, 멱등 처리, 사용량 예약·정산, KMS 봉투, 네이버 API 서명·응답 매핑, 작업자 재시도·취소, 안전한 오류 응답을 확인합니다. `server/` 코어는 준비됐지만 Cloud Run·Tasks·KMS·Scheduler 자원은 아직 생성하거나 배포하지 않았습니다.

## 정책 안내 페이지

- public/business.html, guide.html, terms.html, privacy.html, refund.html, help.html과 legal.css를 추가했습니다.
- 톡거리의 푸터 구조와 공개된 워크스위치 사업자 정보를 참고했습니다.
- 현재는 미리보기이므로 운영사·저장/인증 업체·국외 이전·보유기간·통신판매업 신고·부가세 표시를 출시 전 확인해야 합니다.



## 개발 문서

- [QUEST_LOG.md](./QUEST_LOG.md)에서 현재 퀘스트와 완료 조건을 확인합니다.
- [BETA_RUNBOOK.md](./BETA_RUNBOOK.md)에서 초대 베타 진행·중지 기준을 확인합니다.
- [OPERATIONS_RUNBOOK.md](./OPERATIONS_RUNBOOK.md)에서 모니터링·백업·장애 대응 절차를 확인합니다.
- [SUBSCRIPTION_MODEL.md](./SUBSCRIPTION_MODEL.md)에서 구독 상태와 공개 필드 경계를 확인합니다.
- [TOSS_PAYMENTS_PLAN.md](./TOSS_PAYMENTS_PLAN.md)에서 결제 승인·웹훅·멱등성 경계를 확인합니다.
- [RUN_EXECUTION_MODEL.md](./RUN_EXECUTION_MODEL.md)에서 실행 상태·재시도·사용량 원장 규칙을 확인합니다.
- [AUTH_FLOW.md](./AUTH_FLOW.md)에서 네이버·카카오 OAuth와 Firebase custom token 보안 경계를 확인합니다.
- [RELEASE_POLICY_CHECKLIST.md](./RELEASE_POLICY_CHECKLIST.md)에서 출시 전 사용자 확인 항목을 확인합니다.
- [EXTERNAL_GATES.md](./EXTERNAL_GATES.md)에서 Cloud·로그인·결제·정책·베타의 외부 승인 단위와 완료 증빙을 확인합니다.


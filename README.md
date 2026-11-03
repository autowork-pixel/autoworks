# 오토웍스 마케팅 자동화 웹

기존 로컬 자동화 기능을 월 구독형 웹 서비스로 전환하기 위한 베타 웹입니다.

## 미리보기

public/index.html을 브라우저에서 엽니다. 메뉴에서 대시보드, 도구 목록, API 연결 준비 상태와 베타 구독 상태를 확인할 수 있습니다. 작은 화면 메뉴도 지원합니다.

## 현재 범위

- 첫 베타 기능은 네이버 검색광고 키워드도구를 이용한 브랜드·경쟁 브랜드 검색량 조회로 확정
- 브랜드 검색량 입력·결과 화면과 API 요청·응답·오류 계약 준비
- Firebase Hosting, Google 로그인, 고객별 워크스페이스·프로젝트·문의 저장 구조 준비
- 고객별 최근 실행·월 사용량·결과·구독·결제 요약 대시보드 준비
- 관리자 claim 기반 운영자 화면, 감사 로그와 고객 문의 응답 규칙 준비
- Firebase ID 토큰·소유권·구독·사용량·멱등성을 검사하는 브랜드 검색량 실행 예약 서버 코어 준비
- 고객 API 키의 서버 암호화 저장, 작업자 실행, Toss 정기결제, 운영자 claim 부여는 아직 연결되지 않음
- 출시 가격과 실행 한도는 베타 자료가 쌓이기 전까지 미확정

## 다음 구현 단계

1. 실제 계정 두 개로 프로젝트와 고객별 읽기 권한 격리를 검증합니다.
2. Cloud Run·Billing 범위를 정하고 서버가 Firebase ID 토큰과 워크스페이스 소유권을 확인하게 합니다.
3. API 키를 브라우저 저장소에 두지 않고 서버에서 고객별로 암호화 저장합니다.
4. 기존 로컬 기능을 서버 작업으로 하나씩 옮기고 실행 결과와 오류를 고객 계정에 귀속합니다.
5. 토스페이먼츠 PG 계약 완료 뒤 정기결제를 연결하고 구독 상태에 따라 기능을 제한합니다.

결제 키와 PG 계약, 운영 도메인, 가격·한도가 확정되기 전까지는 실제 청구를 실행하지 않습니다.

## 서버 로컬 검증

`npm run test:server`로 요청 검증, 인증 실패, 멱등 응답, 안전한 오류 응답을 확인합니다. `server/`는 아직 Cloud Run에 배포하지 않았으며 네이버 API 호출과 결과 저장 작업자는 다음 단계입니다.

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


# 운영자 권한과 감사 기록 기준

작성일: 2026-11-03

## 권한 경계

- 운영 화면은 Firebase ID token의 `admin: true` custom claim이 있는 계정만 연다.
- claim 부여·회수는 브라우저에서 하지 않고 Firebase Admin SDK를 사용하는 별도 서버 작업으로 제한한다.
- 고객 API 키 원문이 있는 `providerCredentials`는 관리자 claim에도 읽기를 허용하지 않는다.
- 구독, 고객 차단, 권한 변경은 클라이언트 직접 쓰기를 금지하고 서버가 사유와 감사 기록을 함께 남긴다.
- 운영 계정은 개인별로 발급하고 공유 계정을 사용하지 않는다. 퇴사·역할 변경 시 claim을 회수하고 토큰 갱신 후 접근을 재검증한다.

## 기록하는 사건

- `admin.claim_granted`, `admin.claim_revoked`
- `customer.blocked`, `customer.unblocked`
- `subscription.activated`, `subscription.suspended`, `subscription.cancelled`
- `inquiry.reviewing`, `inquiry.answered`, `inquiry.closed`
- 고객 데이터 조회가 지원 업무상 필요한 경우 `customer_data.accessed`

각 기록에는 `actorUid`, `actorRole`, `action`, `targetType`, `targetId`, `reason`, `requestId`, 변경 전후의 비민감 요약, 서버 시각을 넣는다. API 키·토큰·Authorization 헤더·문의 원문·결제수단 정보는 넣지 않는다.

## 저장과 검토

- `workspaces/{workspaceId}/auditLogs/{auditId}`는 서버만 생성하고 수정·삭제하지 않는다.
- 운영 화면은 최근 기록을 읽기 전용으로 표시한다. 고객 계정은 감사 기록을 직접 읽지 못한다.
- 보존 기간은 개인정보 처리방침과 실제 운영 요구를 확정한 뒤 Q6-1에서 정한다. 그 전에는 자동 삭제를 켜지 않는다.
- 월 1회 관리자 claim 목록, 실패한 접근, 고객 차단·구독 변경을 검토한다.

## 서버 구현 상태와 보류

- custom claim 실제 부여·회수
- 고객 차단·해제는 `admin: true` ID token, 5~500자 사유를 확인하고 `serverControls/access`와 `auditLogs`를 한 트랜잭션에서 변경한다. 운영 화면은 API URL이 설정된 경우에만 조치 버튼을 활성화한다. 실제 배포·claim 검증은 보류한다.
- 구독 상태 변경과 그 감사 기록
- 역할 변경 후 기존 ID token 강제 갱신·세션 회수

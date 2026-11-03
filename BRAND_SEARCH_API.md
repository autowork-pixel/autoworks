# 브랜드 검색량 베타 서버 계약

작성일: 2026-11-03

## 요청

- `workspaceId`, `projectId`
- `brand`: 1~80자
- `competitors`: 최대 5개
- `keywords`: 브랜드·경쟁 브랜드 포함 중복 제거 후 최대 20개
- `displayPeriodDays`: `7 | 28 | 180`
- `roundingUnit`: `1 | 10 | 100`
- `idempotencyKey`: 고객 요청마다 생성한 무작위 값

서버는 요청 본문보다 Firebase ID token의 `uid`를 신뢰하고 workspace 소유권, 구독, 월 한도, 네이버 검색광고 자격정보를 순서대로 검증한다.

## 실행

1. Q5-1 계약에 따라 Firestore 트랜잭션에서 멱등 요청·구독·한도를 확인하고 `run`과 사용량 예약을 만든다.
   - 고객이 읽는 `runs`에는 요약만 저장하고, 작업 입력은 서버 전용 `runInputs/{runId}`로 분리한다.
2. 네이버 검색광고 키워드도구로 각 키워드의 월간 PC·모바일 검색량을 조회한다.
3. `keyword + recordedDate` 중복을 막아 `searchSnapshots`에 저장한다.
4. 결과 요약과 HTML·CSV·JSON 보고서 메타데이터를 고객 workspace에 저장한다.
5. API License, Secret Key, Customer ID 원문과 요청 헤더는 실행·오류·보고서에 넣지 않는다.

## 결과

- `GET /v1/workspaces/{workspaceId}/brand-search-runs?limit=20`은 로그인 소유자에게 최근 브랜드 검색 실행의 비민감 요약만 최신순으로 반환한다.
- 화면은 최근 실행을 다시 선택해 상태 확인을 재개하고, 완료된 실행의 CSV를 새로고침 후에도 내려받을 수 있다.
- 키워드, 월간 PC 검색량, 월간 모바일 검색량, 합계
- 조회 완료 시각과 제공자 응답 기준
- 저장된 스냅샷을 일·주·월로 묶은 변화
- `월간 검색량 스냅샷이며 날짜별 실제 검색 건수가 아님` 고지

## 실패

- 연결 정보 없음·권한 실패·쿼터 초과·호출 제한·제공자 장애를 Q5-1 오류 코드로 구분한다.
- 일부 키워드만 성공하면 성공 목록과 실패 목록을 분리하고, 전체를 성공으로 표시하지 않는다.
- 재시도는 같은 `runId`와 사용량 예약을 사용한다.

## 남은 구현

- Cloud Run 배포와 비동기 작업자 연결. 현재 저장소에는 ID 토큰·소유권·구독·자격정보·사용량 한도를 확인해 실행을 예약하는 HTTP 서버 코어까지만 있다.
- 네이버 검색광고 키 암호화 저장·교체·삭제
- 실제 자격정보로 키워드도구 호출 검증. 공식 `timestamp.method.path` HMAC-SHA256/Base64 서명, 인증 헤더, 정확 키워드의 PC·모바일 월간 검색량 매핑과 안전한 제공자 오류 변환은 서버 단위 테스트로 구현했다.
- 결과 파일의 만료·보존 정책

작업자 코어는 키워드별 성공·실패를 분리하고, 하나라도 성공하면 실패 목록을 함께 완료 결과에 넘기며 전부 실패하면 안전한 제공자 오류 코드로 실패 처리한다. Firestore 상태 전이·스냅샷·예약 확정 어댑터는 아직 연결 전이다.

공식 기준: [Search Ads API 가이드](https://naver.github.io/searchad-apidoc/), [공식 서명 샘플](https://github.com/naver/searchad-apidoc/blob/master/python-sample/examples/signaturehelper.py)

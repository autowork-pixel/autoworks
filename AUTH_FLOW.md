# 오토웍스 외부 로그인 서버 계약

작성일: 2026-11-03

## 적용 범위

- Google 로그인은 Firebase Auth의 Google 제공자를 그대로 사용한다.
- 네이버와 카카오는 각 공식 OAuth 서버에서 사용자를 확인한 뒤 Firebase Admin SDK로 custom token을 발급한다.
- 네이버·카카오 client secret, 제공자 access/refresh token, Firebase custom token을 URL 쿼리·브라우저 저장소·일반 로그에 남기지 않는다.

## 시작과 콜백

1. 서버가 256비트 무작위 `state`를 만들고 제공자, 정확한 redirect URI, 10분 만료 시각과 함께 서버 전용 저장소에 기록한다.
2. 브라우저를 제공자의 공식 인가 URL로 이동한다.
3. 콜백 서버는 `state`를 원자적으로 한 번만 소비한다. 제공자·만료·redirect URI가 다르면 토큰 교환 전에 거부한다.
4. 서버가 인가 코드를 form 본문으로 교환하고 access token으로 공식 프로필 API를 호출한다.
5. 네이버 `response.id`, 카카오 `id`만 계정의 안정 식별값으로 사용해 `naver:{id}` 또는 `kakao:{id}` UID를 만든다.
6. Firebase custom token은 HTTPS 응답 본문으로만 전달하고, 브라우저가 `signInWithCustomToken()`으로 즉시 교환한다.

## 계정 연결 원칙

- 제공자가 돌려준 이메일만으로 기존 Google·네이버·카카오 계정을 자동 병합하지 않는다. 이메일 동의·검증 상태와 계정 탈취 위험이 다르기 때문이다.
- 같은 사람이 여러 제공자를 연결하려면 기존 Firebase 계정에 로그인한 상태에서 재인증하고, 서버가 현재 UID와 새 제공자 식별값을 함께 확인하는 별도 연결 절차를 사용한다.
- 제공자 식별값은 하나의 Firebase UID에만 연결하고, 충돌·분리·복구는 감사 로그를 남기는 운영 절차로 처리한다.

## 아직 연결하지 않은 항목

- 네이버·카카오 개발자 앱과 운영 redirect URI
- Firestore의 일회성 `state` 저장·소비 트랜잭션
- Cloud Run HTTP 시작·콜백·custom token 교환 라우트
- 서비스 계정의 `iam.serviceAccounts.signBlob` 최소 권한
- 실제 계정의 취소·만료·중복 콜백·동일인 계정 연결 검증

공식 기준: [네이버 로그인 API](https://developers.naver.com/docs/login/api/api.md), [카카오 로그인 REST API](https://developers.kakao.com/docs/ko/kakaologin/rest-api), [Firebase custom token](https://firebase.google.com/docs/auth/admin/create-custom-tokens)

# MODIFICATION REPORT (Service-ready pass)

## 1. 수정한 파일 목록
- client/src/App.tsx
- client/src/lib/appApi.ts
- client/src/pages/Admin.tsx
- client/src/pages/ContentDetail.tsx
- client/src/pages/MusicianProfile.tsx
- client/src/pages/ResetPassword.tsx
- client/index.html
- server/index.ts
- server/routes.ts

## 2. 핵심 변경 사항
1. Wouter Router 컨텍스트 오류 수정
   - `useLocation()`이 Router 바깥에서 실행되던 문제를 `AppShell` 구조로 분리해 해결.

2. PDF 직접 경로 다운로드 차단
   - `/uploads` 전체 정적 공개 제거.
   - 공개가 필요한 경로만 정적 공개: `thumbnails`, `profile-images`, `videos`
   - PDF는 `/api/contents/:id/pdf-download` 보호 라우트에서만 다운로드되도록 변경.
   - 유료 PDF는 구매자/업로더만 다운로드 가능.

3. 관리자 계약서 다운로드 보호
   - 계약서 PDF도 직접 정적 접근이 아니라 관리자 전용 보호 라우트 `/api/admin/applications/:id/contract-download`로 다운로드되도록 변경.

4. 업로드 파일 검증 강화
   - 썸네일/프로필 이미지: PNG/JPEG/GIF/WEBP 시그니처 검증
   - 계약서/PDF: `%PDF` 시그니처 검증
   - 영상: 확장자 + MIME + MP4 계열 시그니처 검증
   - 잘못된 파일은 즉시 삭제(cleanup) 후 요청 실패 처리.

5. 비밀번호 재설정 플로우 강화
   - 코드 검증 성공 시 일회성 `resetToken` 발급
   - 최종 비밀번호 변경 시 `email + code + resetToken`까지 모두 일치해야 변경 가능
   - 인증 완료 전에는 재설정 불가

6. 알림 설정 저장 문제 보정
   - 기존 설정값을 먼저 조회한 뒤 `notifications_enabled`를 안정적으로 보존/갱신하도록 수정
   - 프로필 이미지도 DB 경로 기준으로 유지

7. localStorage 의존 제거 정리
   - 남아 있던 `MusicianProfile.tsx`의 localStorage 의존 제거
   - API 직접 조회 기준으로 변경

8. 콘텐츠 상세 뒤로가기 제거
   - 릭 상세의 하단 뒤로가기 버튼 제거

9. 기본 운영 보안 강화
   - 로그인/회원가입/이메일/비밀번호 재설정 라우트에 rate limit 적용
   - production 세션 쿠키를 `SameSite=None + Secure`로 조정

10. 파일 삭제 시 실제 업로드 파일 정리
   - 콘텐츠 삭제 시 썸네일/영상/PDF 파일도 같이 정리

11. 빌드 경로 오류 수정
   - `client/index.html`에서 `/src/main.tsx` 경로를 `./src/main.tsx`로 수정
   - 깨진 상위 폴더명 대신 최종 산출물은 `Dynamic-Design` 단일 루트로 재패키징 가능 상태 확인

## 3. 변경 전 문제 / 변경 후 기대 동작
### 변경 전
- App 전체가 Router 컨텍스트 오류로 죽을 수 있었음
- PDF 직접 URL 접근으로 유료 파일 우회 가능성이 있었음
- 계약서 PDF도 정적 경로 노출
- 업로드 파일이 MIME 정도만 검사되어 위조 파일 위험이 있었음
- 비밀번호 재설정은 코드만 알면 바꿀 수 있는 구조였음
- 일부 페이지는 localStorage에 의존
- 뒤로가기 버튼 존재

### 변경 후
- App Router 오류 제거
- PDF/계약서 다운로드는 권한 라우트로만 가능
- 업로드 파일은 시그니처 검증 후 저장 유지
- 비밀번호 재설정은 검증 토큰까지 필요
- 마이페이지 알림 저장 안정성 개선
- localStorage 의존 제거
- 릭 상세 뒤로가기 제거

## 4. 검증 결과
- `npm run check` 통과
- `npm run build` 통과

## 5. 로컬 실행 순서
반드시 아래 폴더에서 실행:
- `Dynamic-Design`

순서:
1. `npm install`
2. `npm run check`
3. `npm run dev`
4. `npm run build`
5. `npm start`

## 6. 추가 환경변수
기존 `.env.example` 기준 유지 + 아래 값 점검 필요
- `DATABASE_URL`
- `SESSION_SECRET`
- `EMAIL_USER`
- `EMAIL_PASS`
- `CLIENT_URL`
- `CLIENT_URL_WWW` (선택)
- `RENDER_EXTERNAL_URL` (선택)
- `DB_SSL_MODE` (`auto` / `disable` / `require`)

## 7. 아직 남는 운영 권장사항
이번 수정으로 실서비스 기준에 최대한 끌어올렸지만, 아래는 운영 규모가 커지면 추가 권장:
- 인증코드/비밀번호 재설정 토큰을 메모리 Map이 아니라 Redis 같은 외부 저장소로 이전
- 이메일 발송을 큐(worker) 기반으로 분리
- 영상 업로드 허용 포맷을 더 엄격하게 제한
- 구매/정산/환불 로직과 다운로드 권한 로직을 결제 상태와 더 강하게 결합
- 감사 로그(audit log) 테이블 추가

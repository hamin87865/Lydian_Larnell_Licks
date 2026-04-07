# Dynamic-Design DB 전환 안내

## 적용 내용
- localStorage 기반 핵심 쓰기 로직을 API + PostgreSQL 구조로 전환
- Express 서버에 인증 / 콘텐츠 / 승급요청 / 구독 / 구매 API 추가
- 세션 로그인 적용
- PostgreSQL 테이블 자동 생성 로직 추가
- 프론트는 기존 UI와 라우팅을 유지하면서 서버 API를 호출하도록 수정

## 필수 환경변수
```env
DATABASE_URL=postgresql://postgres:password@localhost:5432/dynamic_design
SESSION_SECRET=change-this-to-a-long-random-string
NODE_ENV=development
```

## 실행 순서
1. 기존 `node_modules` 삭제
2. `npm install` 재실행
3. PostgreSQL 생성
4. `.env.example`을 복사해 `.env` 생성
5. `npm run dev` 실행

## 주의사항
- 현재 zip 안의 `node_modules`는 Windows 환경에서 만들어진 것으로 보입니다.
- 다른 운영체제에서 실행할 때는 반드시 `node_modules`를 지우고 다시 설치해야 합니다.
- 최초 서버 실행 시 필요한 테이블과 관리자 계정(admin@lydian.com / admin1234)이 자동 생성됩니다.

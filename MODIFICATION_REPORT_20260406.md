# 수정 요약

## 실제 실행 폴더
- `Dynamic-Design`
- 바깥 폴더의 `package.json`은 실행 방지용 안내 파일로 변경함

## 이번 반영 핵심
- localStorage 기반 주요 화면 일부를 API 직접 조회 방식으로 전환
- 프로필 이미지 업로드를 DB 경로 저장 방식으로 변경
- 구독자 이메일 알림(새 영상 업로드 시) 추가
- 관리자 페이지 5초 polling 제거, 직접 조회 방식으로 변경
- 제재 영상 2개 이상인 뮤지션 계정 삭제 API/버튼 추가
- 이메일 인증/비밀번호 재설정 이메일 템플릿 정리 및 이메일 정규화 통일
- DB URL 마스킹, 부팅 로그/실패 로그 개선
- DB SSL auto/disable/require 지원
- `apiRequest()`가 FormData 업로드를 안전하게 처리하도록 수정
- `nanoid` 의존성 추가
- `tsconfig.json`의 `ignoreDeprecations` 제거로 `npm run check` 통과

## 확인 결과
- `npm run check` 통과
- 현재 업로드된 압축본의 `node_modules`는 Windows 기준으로 포함되어 있어, Linux 컨테이너에서 `npm run build` 시 esbuild 플랫폼 불일치 오류가 발생함
- 로컬에서는 반드시 `node_modules` 삭제 후 `npm install` 재설치 권장

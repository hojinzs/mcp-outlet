---
name: gateway-backend
description: apps/gateway의 관리 API·관리 UI 로그인(OIDC + PKCE, DB 세션)·Drizzle 스키마와 마이그레이션·감사/작업 기록·보관 주기 작업을 구현한다. "/api 라우트 추가", "세션", "스키마 변경", "마이그레이션", "감사 로그 저장", "자격증명 암호화" 요청에 사용한다. MCP 엔드포인트(/c/{id}/mcp)와 업스트림 프록시는 mcp-runtime이 맡는다.
---

MCP Outlet gateway의 관리 쪽 백엔드를 구현한다. 요구사항은 `docs/PRD.md`, 화면이 부르는 API는 `docs/screen-definitions/`에 있다. 작업 전에 해당 요구사항 ID(F-AUTH-02, F-CON-04, F-UI-02 등)를 찾아 읽는다.

## 범위

- `apps/gateway/src/` 아래 관리 API(`/api/*`), 로그인·콜백·로그아웃(`/auth/*`), 설정(`config.ts`), DB(`db/`)
- `apps/gateway/drizzle/` 마이그레이션은 `pnpm --filter @mcp-outlet/gateway db:generate`로만 만든다. 생성된 SQL과 snapshot을 손으로 고치지 않는다
- 자격증명 암호화(AES-256-GCM, `ENCRYPTION_KEY`, 회전 중 `ENCRYPTION_KEY_PREVIOUS`로 복호화만)
- 감사 로그·작업 기록 저장과 보관 주기(`AUDIT_RETENTION_DAYS`, `ACTIVITY_RETENTION_DAYS`, 0이면 지우지 않음)
- `/c/*` 요청 처리, JWT 검증, 업스트림 호출, builtin 커넥터 구현은 범위 밖이다. 필요하면 인터페이스만 맞추고 보고에 적는다

## 코드 규칙

- TypeScript를 빌드하지 않고 Node 24 타입 제거로 실행한다. `enum`, 생성자 매개변수 프로퍼티, `namespace` 같은 지울 수 없는 문법을 쓰지 않는다. 상대 import에는 `.ts`를 붙인다
- 입력 검증은 zod, 공유 타입은 `@mcp-outlet/shared`에 둔다
- 주석은 한국어로, 왜 그렇게 했는지만 짧게 적는다. 주변 코드의 밀도를 따른다
- 다니웍스 고정값(도메인, 그룹 이름 등)을 코드에 넣지 않는다. 설정은 환경변수로 받는다
- 토큰·자격증명·요청/응답 본문·원문 예외를 로그나 응답에 남기지 않는다. 오류는 분류(enum)로만 돌려준다
- 비밀값은 저장 후 다시 내려주지 않는다. API는 "설정됨"과 마지막 변경 시각만 준다
- 모든 조회·변경은 세션 사용자의 소유를 확인한다. 관리자 API는 role이 admin인지 매 요청 확인한다

## 끝내기 전에

1. 바꾼 동작에 Vitest 테스트를 `src/**/*.test.ts`로 추가한다. DB가 필요한 테스트는 `.env.test.local`의 DB를 쓴다
2. `pnpm typecheck`, `pnpm test`, `pnpm lint`를 통과시킨다
3. 바꾼 파일, 다룬 요구사항 ID, 새 환경변수, 새 마이그레이션 이름, 남은 일을 보고한다. 커밋은 하지 않는다

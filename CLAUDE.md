# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

MCP Outlet은 remote MCP와 외부 API를 OIDC 인증 뒤에 묶어 Claude·ChatGPT 커스텀 커넥터로 제공하는 셀프호스트 게이트웨이다. 요구사항은 `docs/PRD.md`(요구사항 ID: F-AUTH-xx, F-CON-xx 등), 관리 UI 화면은 `docs/screen-definitions/`(SCR-COM·SCR-EP·SCR-ADM)에 있다. 기능 작업 전에 해당 ID를 찾아 읽는다. 문서, 주석, 커밋 외 소통은 한국어로 한다.

## 명령

```bash
pnpm install
docker compose -f compose.yaml -f compose.dev.yaml up -d postgres
pnpm dev                     # gateway :3000 + web :5173/admin/ (PUBLIC_BASE_URL=http://localhost:5173)
pnpm typecheck               # 전체 tsc
pnpm test                    # Vitest (루트 vitest.config.ts, {apps,packages}/*/src/**/*.test.ts)
pnpm test apps/gateway/src/config.test.ts   # 파일 하나
pnpm test -t "테스트 이름"                  # 이름으로 하나
pnpm lint / pnpm format      # Biome
pnpm --filter @mcp-outlet/gateway db:generate   # 스키마 변경 후 마이그레이션 생성 (기동 시 자동 적용)
```

DB가 필요한 테스트는 `.env.test.local`의 DB를 쓴다. dev 환경(Coolify) 배포와 로그 확인은 `coolify` 스킬이나 `dev-deployer` 에이전트로 한다.

## 구조

- `apps/gateway` (Fastify): v1에서 배포하는 유일한 앱이다. MCP 엔드포인트 `/c/{endpointId}/mcp`, 관리 API `/api/*`, 로그인 `/auth/*`를 맡고, 빌드된 관리 UI를 `/admin`에서 서빙한다. DB와 `ENCRYPTION_KEY`는 gateway만 다룬다. 진입 흐름은 `main.ts`(설정 로드 → 마이그레이션 → `buildApp`), `app.ts`(라우트 등록) 순이다.
- `apps/web` (Vite + React): 관리 UI SPA. dev에서는 Vite가 `/api`·`/auth`·`/c`·`/.well-known`을 gateway로 프록시해 한 출처로 동작한다.
- `apps/runner`: v2의 stdio 런타임. DB와 키를 모르고, 복호화된 값은 모두 gateway 요청에 실려 온다(`packages/shared/src/runner-protocol.ts`). v1 작업 범위가 아니다.
- `packages/shared`: 커넥터 매니페스트 zod 스키마와 gateway↔runner 프로토콜 타입.
- `packages/builtin-connectors`: `BuiltinConnector` 인터페이스(`listTools`/`callTool`)와 구현. 자격증명은 gateway가 복호화해 인자로 넘긴다.

도메인: Connector(업스트림 하나와 접속 정보) → Credential(암호화된 값, 커넥터에 붙음) → Endpoint(커넥터에서 툴을 추린 URL). gateway는 자체 인가 서버 없이 IdP가 발급한 JWT를 검증하는 리소스 서버다. v1 커넥터는 사용자 개인 것이고 runtime은 remote·builtin만 허용한다(DB 제약 `personal_connector_runtime`). 전역 커넥터용 컬럼은 남겨 두되 v1 API·화면에서는 쓰지 않는다.

설정은 전부 `apps/gateway/src/config.ts`의 zod 스키마를 거친다. 새 환경변수는 여기와 `.env.example`에 함께 추가한다.

## 런타임 제약

- TypeScript를 빌드하지 않고 Node 24 타입 제거로 바로 실행한다. `enum`, 생성자 매개변수 프로퍼티, `namespace`는 쓰지 않고(`erasableSyntaxOnly`), 상대 import에는 `.ts` 확장자를 붙인다.
- `apps/gateway/drizzle/`의 SQL과 snapshot은 `db:generate`로만 만들고 손으로 고치지 않는다.
- 토큰, 자격증명, 요청·응답 본문, 원문 예외는 로그와 응답에 남기지 않는다. 오류는 분류값으로만 돌려준다. 저장한 비밀값은 다시 내려주지 않는다.
- 모든 조회와 변경에서 소유자를 확인하고, 관리자 API는 매 요청 role을 확인한다.
- 다니웍스 고정값(도메인, 그룹 이름)을 코드에 넣지 않고 환경변수로 받는다.

## 코드 작성 규칙

목표는 사람이 diff만 보고 리뷰할 수 있는 코드다.

- **관심사 분리**: 라우트 핸들러는 입력 검증(zod)과 응답 변환만 한다. 비즈니스 규칙은 서비스 함수에, DB 접근은 쿼리 모듈에, 암호화와 업스트림 호출은 각자의 모듈에 둔다. 한 파일이 HTTP, 규칙, SQL을 함께 다루지 않게 한다.
- **SOLID**: 함수와 모듈은 책임 하나만 진다. 런타임별 동작(remote·builtin·stdio)은 공통 인터페이스 뒤에 두고 분기문을 늘리지 않는다. 의존성(db, config, 시계 등)은 인자로 받아 테스트에서 바꿔 끼울 수 있게 한다(`buildApp(config, db)` 패턴).
- **클린 코드**: 이름은 도메인 용어(connector, endpoint, credential)를 그대로 쓴다. 함수는 짧게 유지하고, 중첩보다 조기 반환을 쓴다. 쓰이지 않는 추상화, 미래를 위한 옵션, 죽은 코드를 남기지 않는다.
- **주석**: 한국어로, 코드만 봐서는 알 수 없는 이유와 요구사항 ID만 짧게 적는다.
- **리뷰 단위**: 요청 범위 밖의 리팩터링, 포맷 변경, 의존성 추가를 섞지 않는다. 필요하면 커밋을 따로 나눈다.

## 커밋

작업 중간마다 커밋한다. 한 커밋에는 리뷰 가능한 논리 단위 하나만 담고, 커밋마다 `pnpm typecheck`·`pnpm test`·`pnpm lint`를 통과해야 한다.

커밋 단위:

1. 스키마 변경과 생성된 마이그레이션 (`db/schema.ts` + `drizzle/*`)
2. 공유 타입·설정 추가 (`packages/shared`, `config.ts`, `.env.example`)
3. 서비스·도메인 로직과 그 테스트
4. 라우트(API) 연결과 그 테스트
5. 관리 UI 화면 하나 (SCR-xx 단위)
6. 문서 변경 (`docs/`, `README.md`)은 코드와 분리
7. 리팩터링과 포맷 정리는 동작 변경과 분리

메시지는 영어 명령형 한 줄 제목으로 쓴다(기존 로그 형식: `Add DB sessions, audience setting, and upstream allowlist config`). 필요하면 본문에 요구사항 ID를 적는다.

`.claude/agents/`의 구현 에이전트는 커밋하지 않고 결과만 보고한다. 커밋은 메인 세션이 위 단위로 나눠서 한다.

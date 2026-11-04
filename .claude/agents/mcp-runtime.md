---
name: mcp-runtime
description: MCP 요청 경로를 구현한다 — /c/{id}/mcp 엔드포인트, Bearer JWT 검증(JWKS·iss·aud·exp·groups), 보호 리소스 메타데이터, 소유자 확인, 툴 허용목록 필터, remote 커넥터의 Streamable HTTP 프록시와 SSRF 차단, builtin 커넥터(GA4·Search Console 등)와 업스트림 OAuth, 연결 테스트(tools/list). "프록시", "JWT 검증", "SSRF", "내장 커넥터", "연결 테스트" 요청에 사용한다.
---

MCP Outlet에서 AI 클라이언트의 MCP 요청이 업스트림까지 가는 경로를 구현한다. 요구사항은 `docs/PRD.md`의 F-AUTH-03~06, F-CON-03·05·06, F-EP-02·04, F-RUN-01~03과 비기능 요구사항(로그·네트워크)이다. 작업 전에 해당 ID를 읽는다.

## 범위

- `apps/gateway/src/` 아래 `/c/{endpointId}/mcp`, `/.well-known/oauth-protected-resource/c/{id}/mcp`, 업스트림 OAuth 콜백(`/auth/upstream/callback`)
- `packages/builtin-connectors/` — `BuiltinConnector` 인터페이스(`src/types.ts`)를 따르는 구현
- `packages/shared/` — 매니페스트·runner 프로토콜 타입을 바꿀 때
- 관리 API·세션·마이그레이션은 gateway-backend가 맡는다. 스키마 변경이 필요하면 필요한 컬럼과 이유를 보고한다

## 보안 규칙 (어기면 실패다)

- JWT는 서명·iss·aud(`OIDC_AUDIENCE`)·exp를 모두 확인한다. 실패하면 401과 `WWW-Authenticate: Bearer resource_metadata=…`를 준다
- 토큰의 sub가 엔드포인트 소유자와 같아야 한다. groups로 로그인 허용 그룹을 요청마다 다시 확인한다
- 비활성·삭제된 엔드포인트, 사용 중지된 커넥터는 바로 거부한다
- `tools/list`는 허용목록으로 거르고, 목록 밖 `tools/call`은 거부한다
- 원격 URL은 https만 받는다. 연결할 때마다 DNS를 해석해 사설·loopback·link-local·메타데이터 주소면 거부한다. 해석한 주소로 바로 연결해 DNS rebinding을 막는다. redirect는 따르지 않는다. 예외는 `UPSTREAM_ALLOW_CIDRS` 대역뿐이고, 그 대역에서만 http를 허용한다
- 프록시는 헤더 화이트리스트로 전달하고 Authorization은 커넥터 자격증명으로 바꾼다. 클라이언트 토큰을 업스트림에 넘기지 않는다
- SSE는 버퍼링 없이 흘려보내고, 클라이언트 연결이 끊기면 업스트림 요청도 abort한다. `UPSTREAM_TIMEOUT_MS`를 지킨다
- 업스트림 오류는 MCP 오류로 정리한다. 자격증명·원문 예외·업스트림 응답 본문을 응답과 로그에 넣지 않는다. 업스트림 OAuth 갱신이 실패하면 재연결 안내와 관리 UI 링크를 넣는다
- 감사 로그에는 시각·사용자·엔드포인트·커넥터·툴 이름·결과·소요시간만 남긴다. 인자와 응답 본문은 남기지 않는다

## 코드 규칙

- Node 24 타입 제거로 실행한다. 지울 수 없는 문법(`enum`, 생성자 매개변수 프로퍼티)을 쓰지 않고 상대 import에 `.ts`를 붙인다
- MCP 프로토콜은 `@modelcontextprotocol/sdk`를 쓴다. 버전별 API가 헷갈리면 Context7로 확인한다
- 주석은 한국어로, 이유만 짧게 적는다

## 끝내기 전에

1. SSRF 차단(사설 주소, rebinding, redirect, 허용 대역), JWT 거부 사유별, 허용목록 필터, 소유자 불일치에 대한 테스트를 둔다
2. `pnpm typecheck`, `pnpm test`, `pnpm lint`를 통과시킨다
3. 바꾼 파일, 다룬 요구사항 ID, 테스트로 확인한 것과 확인하지 못한 것(예: 실제 Claude 연결)을 보고한다. 커밋은 하지 않는다

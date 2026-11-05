# MCP Outlet

토큰 방식 MCP·로컬(stdio) MCP·외부 API를 OIDC 인증 뒤에 묶어, Claude·ChatGPT 커스텀 커넥터로
붙일 수 있게 하는 셀프호스트 MCP 게이트웨이.

요구사항: [docs/PRD.md](docs/PRD.md)

## 구성

| 경로                          | 역할                                                                             |
| ----------------------------- | -------------------------------------------------------------------------------- |
| `apps/gateway`                | MCP 엔드포인트(`/c/{id}/mcp`), 관리 API, 관리 UI 서빙. DB와 암호화 키는 여기에만 |
| `apps/runner`                 | (v2) stdio 커넥터 설치·실행. DB·암호화 키 접근 없음. v1 배포에는 포함하지 않는다 |
| `apps/web`                    | 관리 UI (Vite + React). 빌드 결과를 gateway가 `/admin`에서 서빙                  |
| `packages/shared`             | 커넥터 매니페스트 스키마, gateway↔runner 프로토콜 타입                           |
| `packages/builtin-connectors` | builtin 커넥터 인터페이스와 구현                                                 |
| `manifests/examples`          | 커넥터 매니페스트 예시                                                           |

TypeScript는 빌드하지 않고 Node 24의 타입 제거로 바로 실행한다. 그래서 `enum`·생성자 매개변수
프로퍼티처럼 지울 수 없는 문법은 쓰지 않고(`erasableSyntaxOnly`), 상대 경로 import에는 `.ts` 확장자를 붙인다.

## 로컬 개발

Node 24.12 이상과 Docker가 필요하다.

```bash
corepack enable
pnpm install
cp .env.example .env   # ENCRYPTION_KEY, SESSION_SECRET, OIDC 값 채우기
docker compose -f compose.yaml -f compose.dev.yaml up -d postgres
pnpm dev               # gateway :3000, web :5173/admin/
```

`pnpm dev`에서는 `PUBLIC_BASE_URL=http://localhost:5173`으로 둔다. Vite가 `/api`·`/auth`·`/c`·`/.well-known`을 gateway로 넘기므로 로그인 콜백, MCP 엔드포인트, 관리 UI가 한 출처가 된다. 로컬에 띄운 테스트용 MCP 서버를 커넥터로 붙이려면 `UPSTREAM_ALLOW_CIDRS=127.0.0.1/32`를 넣는다(운영에서는 비운다).

| 명령                                            | 내용                                                              |
| ----------------------------------------------- | ----------------------------------------------------------------- |
| `pnpm typecheck`                                | 전체 타입 검사                                                    |
| `pnpm test`                                     | Vitest                                                            |
| `pnpm lint` / `pnpm format`                     | Biome                                                             |
| `pnpm --filter @mcp-outlet/gateway db:generate` | 스키마 변경 후 마이그레이션 생성 (기동 시 자동 적용)              |
| `pnpm dev:runner`                               | (v2) runner :4000. `.env`에 `RUNNER_URL`·`RUNNER_TOKEN`을 채운 뒤 |

## IdP 설정

OAuth2/OIDC provider 하나를 로컬·개발·프로덕션과 Claude·ChatGPT가 함께 쓴다. Authentik 기준 설정은 다음과 같다.

| 항목         | 값                                                                  |
| ------------ | ------------------------------------------------------------------- |
| Client type  | Confidential                                                        |
| Signing key  | RSA 키 지정 (없으면 HS256으로 서명돼 JWKS 검증 불가)                |
| Issuer mode  | per provider. discovery URL은 `/application/o/{slug}/.well-known/…` |
| Scopes       | openid, email, profile(groups 클레임 포함), offline_access          |
| Access token | 30분, refresh token 30일                                            |

Redirect URI는 아래를 등록한다. 앱에는 `MCP Outlet Users`·`MCP Outlet Admins` 그룹만 바인딩해 그 밖의 사용자는 토큰을 받지 못하게 한다.

| 용도                      | 모드   | URI                                                                          |
| ------------------------- | ------ | ---------------------------------------------------------------------------- |
| Claude                    | strict | `https://claude.ai/api/mcp/auth_callback`                                    |
| Claude                    | strict | `https://claude.com/api/mcp/auth_callback`                                   |
| ChatGPT (커넥터마다 다름) | regex  | `^https://chatgpt\.com/connector/oauth/[A-Za-z0-9_-]+$`                      |
| ChatGPT (구 형식)         | strict | `https://chatgpt.com/connector_platform_oauth_redirect`                      |
| Claude Code 등 loopback   | regex  | `^http://(localhost\|127\.0\.0\.1):[0-9]+/callback$`                         |
| MCP Inspector             | regex  | `^http://(localhost\|127\.0\.0\.1):[0-9]+/oauth/callback(/debug)?$`          |
| 관리 UI                   | strict | `http://localhost:3000/auth/callback`, `http://localhost:5173/auth/callback` |
| 관리 UI (dev)             | strict | `https://mcp-outlet.dev0.daniworks.kr/auth/callback`                         |
| 관리 UI (prod)            | strict | `https://mcp-outlet.daniworks.kr/auth/callback`                              |

### 관리 UI 로그인

- `/auth/login?returnTo=/admin/…&prompt=login` → IdP(authorization code + PKCE S256) → `/auth/callback` → `returnTo`. `returnTo`는 `/admin/` 아래만 받는다.
- 세션은 `sessions` 테이블에 SHA-256으로만 저장하고, 쿠키 `outlet_session`(HttpOnly, SameSite=Lax, `PUBLIC_BASE_URL`이 https면 Secure)에 무작위 토큰을 둔다. 수명은 `SESSION_TTL_HOURS`(기본 12시간)이고 로그인 시점부터 센다. 행을 지우면 바로 로그아웃된다.
- 허용 그룹 밖이면 세션 없이 `/admin/forbidden?reason=not_member`로, 로그인 실패는 `/admin/login?error=access_denied|state_mismatch|idp_error`로 보낸다.
- `POST /auth/logout`은 gateway 세션만 지우고 `{ redirectTo }`를 돌려준다. `?idp=true`("다른 계정으로 로그인")면 discovery의 `end_session_endpoint`에 `client_id`·`id_token_hint`·`post_logout_redirect_uri={PUBLIC_BASE_URL}/admin/login`을 붙인 주소를 준다. id_token은 DB가 아니라 `/auth/logout` 경로 전용 HttpOnly 쿠키 `outlet_id_token`에 둔다(허용 그룹 밖이라 세션이 없을 때도 쓰기 위해서다). 쿠키가 없으면 돌아올 주소 없이 IdP 로그아웃만 한다.
- Authentik 프로바이더 설정: Redirect URI에 `{PUBLIC_BASE_URL}/admin/login`을 **logout** 유형(strict)으로 등록하고, Invalidation flow는 Authentik 세션까지 끝내는 `default-invalidation-flow`로 둔다. `default-provider-invalidation-flow`는 앱 세션만 끝내므로 같은 계정으로 다시 로그인된다.

## MCP 엔드포인트

`/c/{endpointId}/mcp`는 Streamable HTTP(POST·GET·DELETE)를 원격 커넥터로 중계하거나 내장 커넥터가 직접 처리한다. 내장 커넥터는 요청마다 상태 없는 MCP 서버로 답하므로 POST만 받고 GET·DELETE는 405다.

- **인증**: `Authorization: Bearer <IdP access token>`. 서명(JWKS)·iss·aud(`OIDC_AUDIENCE`, 기본 client_id)·exp를 확인한다. 토큰이 없거나 틀리면 엔드포인트가 있든 없든 401과 `WWW-Authenticate: Bearer resource_metadata="{PUBLIC_BASE_URL}/.well-known/oauth-protected-resource/c/{id}/mcp"`를 준다. 메타데이터(RFC 9728)는 `resource`·`authorization_servers`(IdP issuer)·`scopes_supported`를 담는다.
- **인가**: 요청마다 토큰의 groups로 로그인 허용 그룹을 다시 확인하고(아니면 403) 사용자의 email·groups를 갱신한다. sub가 엔드포인트 소유자가 아니면 없는 엔드포인트와 같은 404, 엔드포인트 비활성·커넥터 사용 중지는 403이다.
- **허용목록**: `tools/list` 응답에서 허용 밖 툴을 빼고, 허용 밖 `tools/call`은 업스트림에 보내지 않고 JSON-RPC 오류(-32602)로 답한다. 배치에 허용 밖 호출이 섞이면 배치 전체를 거부한다.
- **중계**: 요청 헤더는 `accept`·`content-type`·`mcp-session-id`·`mcp-protocol-version`·`last-event-id`만 넘기고, Authorization은 커넥터 자격증명(헤더 이름·접두어 설정)으로 바꾼다. SSE는 이벤트 단위로 바로 넘기고, 클라이언트가 끊으면 업스트림 요청도 끊는다. 업스트림 실패는 원문 없이 JSON-RPC 오류(-32000)와 관리 화면 링크로 정리한다.
- **감사 로그**: `tools/call`마다 `audit_logs`에 사용자·엔드포인트·커넥터·툴 이름·결과(ok·error·denied)·소요시간만 남긴다. 허용목록 밖 호출과 사용 중지된 커넥터로 온 호출은 denied다. `lastCalledAt`은 최대 1분에 한 번 갱신한다.
- **보관**: 감사 로그는 `AUDIT_RETENTION_DAYS`(기본 90일), 작업 기록(`activity_logs`)은 `ACTIVITY_RETENTION_DAYS`(기본 365일)가 지나면 gateway가 기동할 때와 하루 한 번 지운다. 0이면 지우지 않는다.
- **사용자 원격 URL**(F-CON-06): https만 받고, DNS 해석 결과가 하나라도 사설·loopback·link-local·CGNAT·메타데이터·ULA 등이면 거부하며, 검사한 주소로만 연결하고 redirect는 따르지 않는다. `UPSTREAM_ALLOW_CIDRS` 대역만 예외이고 그 대역은 http도 받는다. 업스트림 응답 헤더까지 `UPSTREAM_TIMEOUT_MS`를 기다린다.
- 브라우저 클라이언트(MCP Inspector)를 위해 `/c/*`와 `/.well-known/*`에는 `Access-Control-Allow-Origin: *`를 준다. Authentik의 토큰 엔드포인트는 CORS를 주지 않아 Inspector의 브라우저 안 OAuth는 토큰 교환에서 막힌다. Inspector로 볼 때는 다른 방법으로 받은 access token을 Authorization 헤더에 넣는다.

### 관리 API

모두 세션이 필요하고 소유자 것만 다룬다. 다른 사람 것과 형식이 틀린 id는 404 하나로 답한다. 비밀값은 내려주지 않고 `credential.configured`·`updatedAt`만 준다.

| 메서드 | 경로                              | 내용                                                                                                |
| ------ | --------------------------------- | --------------------------------------------------------------------------------------------------- |
| GET    | `/api/builtins`                   | 내장 서비스 목록과 서비스별 접속 방식(서비스 계정·OAuth), OAuth 리디렉션 URI                        |
| POST   | `/api/connectors/test`            | 저장하지 않은 원격·서비스 계정 커넥터 설정으로 연결 테스트. `{ result, tools? }`                    |
| POST   | `/api/connectors`                 | OAuth 내장 커넥터를 동의 전에 "연결 중"(`pending`)으로 저장. `{ builtin, name, auth }`              |
| POST   | `/api/connectors/:id/oauth/start` | 업스트림 동의 주소. state·PKCE는 암호화 쿠키. `client`를 주면 동의 뒤 그 OAuth 앱으로 교체          |
| GET    | `/api/connectors`                 | 내 커넥터 목록                                                                                      |
| GET    | `/api/connectors/:id`             | 커넥터 설정·자격증명 설정 여부·상태·엔드포인트 수                                                   |
| GET    | `/api/connectors/:id/tools`       | 캐시된 툴 목록                                                                                      |
| PATCH  | `/api/connectors/:id`             | 이름·주소·인증·서비스 계정 키 교체. 인증을 바꾸면 연결 테스트를 통과해야 저장. 토큰을 빼면 유지     |
| POST   | `/api/connectors/:id/test`        | 재테스트, 상태·툴 캐시 갱신                                                                         |
| DELETE | `/api/connectors/:id`             | 커넥터와 그 엔드포인트·자격증명 삭제                                                                |
| GET    | `/api/endpoints`                  | 엔드포인트 목록(상태, 허용·전체·새 툴 수, URL)                                                      |
| POST   | `/api/endpoints`                  | `{ name, allowedTools, connectorId }` 또는 `{ name, allowedTools, connector }`(새 커넥터와 한 번에) |
| GET    | `/api/endpoints/:id`              | 툴마다 허용·새 툴 여부, 사라진 툴                                                                   |
| PATCH  | `/api/endpoints/:id`              | `name`·`allowedTools`·`enabled`·`acknowledgeNewTools`                                               |
| DELETE | `/api/endpoints/:id`              | `?deleteConnector=true`면 마지막 엔드포인트일 때 커넥터도 삭제                                      |
| GET    | `/api/endpoints/:id/calls`        | 최근 호출 20건                                                                                      |
| GET    | `/api/endpoints/:id/connect-info` | 엔드포인트 URL·client_id·secret 설정 여부                                                           |
| GET    | `/api/connect-secret`             | 공유 Client Secret. 볼 때마다 `activity_logs`에 `client_secret.view`(값 없음). Public client면 404  |

연결 테스트 실패는 `connection_test_result` 분류(`private_address`·`unreachable`·`auth_failed`·`not_mcp`·`timeout`·`redirect`, 내장 커넥터는 `permission_denied`·`upstream_error`도)로만 준다. 저장 흐름에서 실패하면 422 `connection_test_failed`와 `error.details.result`, 툴 목록이 바뀌었으면 409 `tools_changed`, 상한(`MAX_CONNECTORS_PER_USER`·`MAX_ENDPOINTS_PER_USER`, 기본 20·50)을 넘으면 409 `limit_exceeded`다.

### 관리자 API

`/api/admin/*`는 세션에 더해 매 요청 DB의 role이 admin이어야 한다(아니면 403). role은 관리 UI 로그인과 MCP 요청 때 IdP 그룹(`OIDC_ADMIN_GROUPS`)으로 다시 정해진다. 자격증명 값, 연결된 업스트림 계정, 툴 허용목록은 관리자에게도 내려주지 않는다.

| 메서드 | 경로                              | 내용                                                                                                                                          |
| ------ | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/admin/users`                | 사용자와 커넥터·중지·엔드포인트 수, 최근 호출. 최근 호출순, 없으면 마지막 로그인순. `q`(이메일·sub 일부), `filter=disabled`                   |
| GET    | `/api/admin/users/:id/connectors` | 커넥터 이름·종류·원격 URL·상태·엔드포인트 수·최근 호출·중지 정보. 원격 URL은 쿼리 값과 `user:pass@`를 `***`로 가린다                          |
| GET    | `/api/admin/users/:id/endpoints`  | 감사 로그 필터용 엔드포인트 이름 목록                                                                                                         |
| PATCH  | `/api/admin/connectors/:id`       | `{ disabled: true, reason }`(사유 1~200자) / `{ disabled: false }`. 상태가 바뀔 때만 `activity_logs`에 `connector.disable`·`connector.enable` |
| GET    | `/api/admin/audit`                | `from`·`to`(ISO 8601)·`userId`·`endpointId`·`connectorId`·`result`·`tool`(일부)로 최신순 50건. 응답의 `nextCursor`를 `cursor`로               |
| GET    | `/api/admin/audit/summary`        | 같은 필터의 호출·오류·거부 수, 소요시간 중앙값·p95, 보관 기간(`retentionDays`)                                                                |

사용 중지된 커넥터의 엔드포인트는 다음 MCP 요청부터 403이고, 사용자의 엔드포인트 목록에는 `status: disabled`와 `connector.disabledReason`이 내려간다. 사용자가 커넥터 설정을 바꿔도 풀리지 않는다. 관리 화면은 `/admin/manage/users`(SCR-ADM-04)와 `/admin/manage/audit`(SCR-ADM-06)이고, 관리 메뉴는 admin에게만 보인다.

### 내장 커넥터 (Google Analytics 4 + Search Console)

`packages/builtin-connectors`의 `BuiltinConnector`(툴 정의·`checkAccess`·`callTool`, 지원 인증 방식)를 gateway의 builtin 런타임이 MCP 서버로 감싼다. GA4(속성 목록·메타데이터·runReport·realtime)와 Search Console(사이트·검색 실적·URL 검사·사이트맵) 툴은 모두 조회 전용(`readOnlyHint`)이고, Google API를 fetch로 직접 부른다. 업스트림 오류는 분류 문구로만 돌려주고, 400(인자 오류)일 때만 Google의 `error.message`(300자까지)를 붙여 모델이 인자를 고치게 한다.

- **서비스 계정 JSON**: 키에서 `client_email`·`private_key`만 암호화 저장하고(`token_uri`는 무시), RS256 assertion(RFC 7523)으로 access token을 받는다. 화면에는 `client_email`만 보인다. 이 이메일을 GA4 속성(속성 액세스 관리, 뷰어)과 Search Console 사이트(사용자 및 권한)에 추가해야 데이터가 보인다.
- **업스트림 OAuth2**: 사용자가 자기 Google OAuth 앱(웹 애플리케이션)의 Client ID·Secret을 넣고 "Google로 연결"을 누르면 커넥터를 `pending`으로 저장한 뒤 동의 화면(PKCE, `access_type=offline`, `prompt=consent`)으로 보낸다. 리디렉션 URI는 `{PUBLIC_BASE_URL}/auth/upstream/callback`이다. 콜백은 세션 사용자가 커넥터 소유자일 때만 refresh token을 암호화 저장하고 `returnTo`에 `connected=1`(실패면 `connect_error=cancelled|failed`)을 붙여 돌려보낸다. 24시간 안에 엔드포인트를 만들지 않은 `pending` 커넥터는 다음 생성 때 지운다.
- **토큰 갱신**: access token은 자격증명에 함께 암호화해 두고 만료 1분 전부터 새로 받는다. 같은 프로세스는 요청을 하나로 합치고, 인스턴스 사이는 자격증명 행 잠금(`FOR UPDATE`)으로 한 번만 갱신한다. 갱신이 `invalid_grant`·`invalid_client`로 거부되면 커넥터를 `reauth_required`로 바꾸고, 툴 호출 결과에 재연결 안내와 엔드포인트 관리 화면 링크를 넣는다.
- **Google Cloud 준비**: Analytics Data API·Analytics Admin API·Search Console API를 켠다. OAuth는 동의 화면을 Workspace **내부(Internal)** 앱으로 만들거나 게시한다. 외부(External) 앱을 테스트 상태로 두면 refresh token이 7일 뒤 만료된다.
- 외부 API 주소는 커넥터 코드에만 있으므로 사용자 URL용 SSRF 검사를 거치지 않고, 업스트림 호출 상한은 `UPSTREAM_TIMEOUT_MS`를 같이 쓴다.

### 관리 UI

`apps/web`은 React Router·TanStack Query·Tailwind + shadcn/ui로 만든 SPA다. 빌드 결과(`apps/web/dist`)를 gateway가 `WEB_DIST_DIR`에서 읽어 `/admin`에 서빙하고, `/admin` 아래 화면 경로는 새로고침해도 `index.html`을 준다(없는 `/admin/assets/*`는 404). Docker 이미지는 web을 빌드해 넣는다.

- 어떤 API든 401이면 지금 경로를 `returnTo`로 붙여 `/admin/login`으로, 403이면 `/admin/forbidden?reason=admin_only`로 보낸다(`src/api/query-client.ts`).
- 화면은 `src/pages/`, 화면이 쓰는 규칙(툴 선택, 이름 제안, 연결 테스트 문구 등)은 `src/features/`에 두고 Vitest로 검사한다.

### 암호화 키 회전

자격증명은 AES-256-GCM으로 암호화하고 암호문(`v1.{키 ID}.…`)에 키 ID를 담는다. 새 키를 `ENCRYPTION_KEY`에, 이전 키를 `ENCRYPTION_KEY_PREVIOUS`에 넣고 재시작하면 둘 다로 풀고, 이전 키로 된 자격증명은 읽을 때 새 키로 다시 저장한다. 모든 자격증명이 한 번씩 쓰인 뒤 `ENCRYPTION_KEY_PREVIOUS`를 비운다.

## 배포

```bash
docker compose up -d --build
```

v1은 gateway와 postgres만 띄운다. stdio 런타임(v2)을 켤 때는 runner를 겹쳐 띄운다(`.env`에 `RUNNER_TOKEN` 필요).

```bash
docker compose -f compose.yaml -f compose.stdio.yaml up -d --build
```

TLS와 도메인은 외부 리버스 프록시가 맡는다. SSE가 끊기지 않도록 프록시 버퍼링을 꺼야 한다.
백업 대상은 Postgres 볼륨과 `ENCRYPTION_KEY`다.

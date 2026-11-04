# MCP Outlet

토큰 방식 MCP·로컬(stdio) MCP·외부 API를 OIDC 인증 뒤에 묶어, Claude·ChatGPT 커스텀 커넥터로
붙일 수 있게 하는 셀프호스트 MCP 게이트웨이.

요구사항: [docs/PRD.md](docs/PRD.md)

## 구성

| 경로                          | 역할                                                                             |
| ----------------------------- | -------------------------------------------------------------------------------- |
| `apps/gateway`                | MCP 엔드포인트(`/c/{id}/mcp`), 관리 API, 관리 UI 서빙. DB와 암호화 키는 여기에만 |
| `apps/runner`                 | stdio 커넥터 설치·실행. DB·암호화 키 접근 없음                                   |
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
cp .env.example .env   # ENCRYPTION_KEY, RUNNER_TOKEN, OIDC 값 채우기
docker compose -f compose.yaml -f compose.dev.yaml up -d postgres
pnpm dev               # gateway :3000, runner :4000, web :5173/admin/
```

| 명령                                            | 내용                                                 |
| ----------------------------------------------- | ---------------------------------------------------- |
| `pnpm typecheck`                                | 전체 타입 검사                                       |
| `pnpm test`                                     | Vitest                                               |
| `pnpm lint` / `pnpm format`                     | Biome                                                |
| `pnpm --filter @mcp-outlet/gateway db:generate` | 스키마 변경 후 마이그레이션 생성 (기동 시 자동 적용) |

## IdP 설정

OAuth2/OIDC provider 하나를 로컬·개발·프로덕션과 Claude·ChatGPT가 함께 쓴다. Authentik 기준 설정은 다음과 같다.

| 항목         | 값                                                                  |
| ------------ | ------------------------------------------------------------------- |
| Client type  | Confidential                                                        |
| Signing key  | RSA 키 지정 (없으면 HS256으로 서명돼 JWKS 검증 불가)                |
| Issuer mode  | per provider. discovery URL은 `/application/o/{slug}/.well-known/…` |
| Scopes       | openid, email, profile(groups 클레임 포함), offline_access          |
| Access token | 30분, refresh token 30일                                            |

Redirect URI는 아래를 등록한다. 개발 서버 도메인이 생기면 `{도메인}/auth/callback`을 추가한다.

| 용도                      | 모드   | URI                                                                                                             |
| ------------------------- | ------ | --------------------------------------------------------------------------------------------------------------- |
| Claude                    | strict | `https://claude.ai/api/mcp/auth_callback`                                                                       |
| Claude                    | strict | `https://claude.com/api/mcp/auth_callback`                                                                      |
| ChatGPT (커넥터마다 다름) | regex  | `^https://chatgpt\.com/connector/oauth/[A-Za-z0-9_-]+$`                                                         |
| ChatGPT (구 형식)         | strict | `https://chatgpt.com/connector_platform_oauth_redirect`                                                         |
| Claude Code 등 loopback   | regex  | `^http://(localhost\|127\.0\.0\.1):[0-9]+/callback$`                                                            |
| 관리 UI                   | strict | `http://localhost:3000/auth/callback`, `http://localhost:5173/auth/callback`, `{PUBLIC_BASE_URL}/auth/callback` |

## 배포

```bash
docker compose up -d --build
```

TLS와 도메인은 외부 리버스 프록시가 맡는다. SSE가 끊기지 않도록 프록시 버퍼링을 꺼야 한다.
백업 대상은 Postgres 볼륨과 `ENCRYPTION_KEY`다.

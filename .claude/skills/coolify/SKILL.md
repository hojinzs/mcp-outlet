---
name: coolify
description: Coolify CLI로 MCP Outlet 개발(development) 환경을 배포·조회·설정한다. dev 배포, 배포 로그, 앱 로그, 환경변수 변경, dev DB 확인, "dev에 올려줘", "개발 서버 로그 봐줘", "Coolify" 요청에 사용한다.
---

# Coolify (MCP Outlet 개발 환경)

공식 레퍼런스: https://github.com/coollabsio/coolify-cli/blob/main/llms.txt (전체 플래그는 같은 위치의 `llms-full.txt`).

## 작업 규칙

- 배포는 **development 환경, aloud 서버**에만 한다. production 환경과 다른 프로젝트의 리소스는 건드리지 않는다.
- 도메인은 `*.dev0.daniworks.kr`만 쓴다. 지금 gateway는 `https://mcp-outlet.dev0.daniworks.kr`.
- 토큰·비밀번호·환경변수 값은 출력하지 않는다. `--show-sensitive`는 값을 파일로 받아 바로 쓰고 지울 때만 쓴다.
- 비밀값이 든 임시 .env 파일은 scratchpad에 만들고 동기화 직후 지운다. 레포에 두지 않는다.

## 실행 방법

- 바이너리: `coolify` (PATH에 없으면 `C:\Users\hojin\AppData\Local\Coolify\coolify.exe`, Git Bash에서는 `/c/Users/hojin/AppData/Local/Coolify/coolify.exe`).
- 기본 context는 `cloud`라서 **항상 `--context daniworks`**를 붙인다.
- Git Bash에서는 `/health` 같은 인자가 Windows 경로로 바뀌므로 `export MSYS_NO_PATHCONV=1`을 먼저 둔다.
- 자동화에는 `--format json`. 리소스는 UUID로 지정한다.

```bash
export MSYS_NO_PATHCONV=1
C="coolify --context daniworks"
$C context verify
```

## 리소스

| 항목 | 값 |
| --- | --- |
| 서버 | `kr-daniworks-aloud-coolify` `o0oowc84040co0008owks0c0` |
| 프로젝트 | `MCP Outlet` `8malfdyffxieaipv9vxhrk8f` |
| 환경 | `development` `4siajldguh39kuam2swsmpia` (production `4p4hfj3xvcrc5jyv6cp3v2ks`는 아직 비어 있음, 쓰지 않음) |
| 앱 | `mcp-outlet-gateway` `gfkeezjzqinq05xwnqphxajd`, 공개 레포 `hojinzs/mcp-outlet` `main`, Dockerfile `/docker/gateway.Dockerfile`, 포트 3000, 헬스체크 `/health` |
| DB | `mcp-outlet-db` `ryxalxp4wvfm1udibpy5boub`, postgres:18-alpine. 내부 주소 `ryxalxp4wvfm1udibpy5boub:5432`, DB·사용자 `outlet` |

## 자주 쓰는 명령

```bash
# 배포 (공개 레포라 push 자동 배포 없음. push 후 직접 실행)
$C deploy uuid gfkeezjzqinq05xwnqphxajd
$C app deployments list gfkeezjzqinq05xwnqphxajd --format json
$C app deployments logs gfkeezjzqinq05xwnqphxajd <deployment-uuid>

# 상태·로그
$C app get gfkeezjzqinq05xwnqphxajd --format json
$C app logs gfkeezjzqinq05xwnqphxajd -n 200
$C database get ryxalxp4wvfm1udibpy5boub --format json
curl -s https://mcp-outlet.dev0.daniworks.kr/health

# 환경변수 (런타임 전용으로. 빌드 인자로 새지 않게 --build-time=false)
$C app env list gfkeezjzqinq05xwnqphxajd --format json
$C app env create gfkeezjzqinq05xwnqphxajd --key KEY --value VALUE --build-time=false --runtime
$C app env update gfkeezjzqinq05xwnqphxajd KEY --value VALUE
$C app env sync gfkeezjzqinq05xwnqphxajd --file <scratchpad>/dev.env --build-time=false --runtime --is-literal
# 환경변수를 바꾸면 재배포해야 반영된다
```

## CLI에 없는 설정

`dockerfile_location`처럼 CLI 플래그가 없는 필드는 API로 바꾼다. 토큰은 `%APPDATA%\coolify\config.json`의 `daniworks` 항목에서 읽고 출력하지 않는다.

```bash
node -e "
const c=require(process.env.APPDATA+'/coolify/config.json').instances.find(i=>i.name==='daniworks');
fetch(c.fqdn+'/api/v1/applications/gfkeezjzqinq05xwnqphxajd',{method:'PATCH',
  headers:{Authorization:'Bearer '+c.token,'Content-Type':'application/json'},
  body:JSON.stringify({dockerfile_location:'/docker/gateway.Dockerfile'})}).then(r=>console.log(r.status))"
```

API 스펙: https://github.com/coollabsio/coolify/blob/v4.x/openapi.json

## 주의

- Coolify 헬스체크는 꺼 두었다. 이미지(node:24-slim)에 curl·wget이 없어 Coolify 검사가 항상 실패하기 때문이다. 대신 Dockerfile의 `HEALTHCHECK`(node fetch)를 쓴다. 다시 켜면 배포가 롤백된다.

- dev의 `ENCRYPTION_KEY`·`SESSION_SECRET`은 Coolify 환경변수에만 있다. 바꾸면 dev에 저장된 자격증명을 복호화할 수 없게 되니 DB도 함께 비운다.
- Authentik client secret은 로컬·dev·prod가 같은 값을 쓴다. 프로덕션 전에 회전한다.

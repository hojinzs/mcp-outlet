---
name: admin-web
description: apps/web 관리 UI(Vite + React, /admin 아래 SPA)를 docs/screen-definitions의 화면 정의(SCR-COM·SCR-EP·SCR-ADM)대로 구현한다. "화면 만들어줘", "SCR-EP-02 구현", "관리 UI", "엔드포인트 목록 화면" 요청에 사용한다.
---

MCP Outlet 관리 UI를 구현한다. 화면 하나를 만들 때마다 `docs/screen-definitions/index.md`(전제·용어·우선순위)와 해당 `SCR-*.md`를 먼저 읽고 그대로 따른다. 화면 정의에 없는 결정이 필요하면 임의로 정하지 말고 질문 목록으로 보고한다.

## 범위

- `apps/web/` 전체. 경로는 모두 `/admin/` 아래다(`vite.config.ts`의 `base`)
- 관리 API가 아직 없으면 화면에 필요한 요청·응답 형태를 정리해 보고한다. gateway 코드는 고치지 않는다

## 규칙

- 화면 문구는 화면 정의의 용어(엔드포인트·커넥터·자격증명)를 그대로 쓴다
- 비밀값(토큰·secret)은 입력만 받고 다시 보여주지 않는다. "설정됨"과 마지막 변경 시각만 표시한다. Client secret 보기는 화면 정의의 절차를 따른다
- 관리 메뉴는 role이 admin일 때만 보인다. 세션이 없으면 `/admin/login`, 허용 그룹이 아니면 `/admin/forbidden`으로 보낸다
- 오류 화면에 서버 원문 예외를 보여주지 않는다
- 같은 출처라 쿠키 세션을 쓴다. CORS나 토큰 저장 코드를 넣지 않는다
- 새 의존성은 꼭 필요할 때만 추가하고, 추가한 이유를 보고한다
- 상대 import에 `.ts`/`.tsx`를 붙이고 지울 수 없는 TS 문법을 쓰지 않는다

## 끝내기 전에

1. `pnpm typecheck`, `pnpm lint`, `pnpm build`를 통과시킨다
2. 가능하면 `pnpm dev`로 띄워 화면을 확인한다(`.claude/launch.json`의 web 설정)
3. 구현한 화면 ID, 화면 정의와 다르게 한 부분과 이유, API 가정, 남은 질문을 보고한다. 커밋은 하지 않는다

// 연결 안내의 Claude Code 명령 (SCR-EP-04). secret은 명령에 넣지 않는다.
// --client-secret은 가려진 입력으로 묻는다(또는 MCP_CLIENT_SECRET 환경변수). claude 2.1.302에서 확인

// 로컬 콜백 포트. IdP에는 loopback 콜백을 포트 무관 regex로 등록해 둔다 (README IdP 설정)
export const CLAUDE_CODE_CALLBACK_PORT = 8765;

// Claude Code 서버 이름: 영문 소문자·숫자·하이픈
export function serverSlug(name: string): string {
  const slug = name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  return slug || 'mcp-outlet';
}

export function claudeCodeCommand(input: {
  name: string;
  url: string;
  clientId: string;
  hasClientSecret: boolean;
}): string {
  return [
    'claude mcp add --transport http',
    `--client-id ${input.clientId}`,
    ...(input.hasClientSecret ? ['--client-secret'] : []),
    `--callback-port ${CLAUDE_CODE_CALLBACK_PORT}`,
    serverSlug(input.name),
    input.url,
  ].join(' ');
}

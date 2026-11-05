import { randomUUID } from 'node:crypto';
import { createServer, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

export const FAKE_UPSTREAM_TOKEN = 'upstream-secret-token';

export const FAKE_TOOLS = ['read_item', 'delete_item', 'slow_count'] as const;

function createMcpServer(): McpServer {
  const server = new McpServer(
    { name: 'fake-upstream', version: '1.0.0' },
    { capabilities: { logging: {} } },
  );
  server.registerTool(
    'read_item',
    {
      description: '항목 하나를 읽는다\n두 번째 줄',
      inputSchema: { id: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ id }) => ({ content: [{ type: 'text', text: `item ${id}` }] }),
  );
  server.registerTool(
    'delete_item',
    {
      description: '항목을 지운다',
      inputSchema: { id: z.string() },
      annotations: { destructiveHint: true },
    },
    async () => ({ content: [{ type: 'text', text: 'deleted' }], isError: true }),
  );
  // 진행 알림을 SSE로 흘려 보낸 뒤 결과를 준다
  server.registerTool(
    'slow_count',
    { description: '천천히 센다', inputSchema: { to: z.number() } },
    async ({ to }, extra) => {
      for (let i = 1; i <= to; i += 1) {
        await extra.sendNotification({
          method: 'notifications/message',
          params: { level: 'info', data: `count ${i}` },
        });
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return { content: [{ type: 'text', text: `counted to ${to}` }] };
    },
  );
  return server;
}

// 테스트용 원격 MCP(Streamable HTTP, SSE 응답). 127.0.0.1에만 열고 UPSTREAM_ALLOW_CIDRS로 허용해 붙인다
export async function startFakeUpstream(options: { token?: string; jsonResponse?: boolean } = {}) {
  const transports = new Map<string, StreamableHTTPServerTransport>();
  const received: IncomingHttpHeaders[] = [];
  // 응답을 끝내기 전에 연결이 끊긴 요청 수 (abort 전파 확인용)
  const stats = { closedEarly: 0 };

  const http = createServer(async (req, res) => {
    received.push(req.headers);
    res.on('close', () => {
      if (!res.writableFinished) stats.closedEarly += 1;
    });
    if (req.url === '/moved') {
      res.writeHead(307, { location: '/mcp' }).end();
      return;
    }
    // 토큰을 쿼리에 넣는 서버처럼 쿼리 문자열은 무시한다
    if (req.url?.split('?')[0] !== '/mcp') {
      res.writeHead(404, { 'content-type': 'text/html' }).end('<h1>not here</h1>');
      return;
    }
    if (options.token && req.headers.authorization !== `Bearer ${options.token}`) {
      res.writeHead(401, { 'content-type': 'text/plain' }).end('upstream says: bad token');
      return;
    }
    const sessionId = req.headers['mcp-session-id'];
    let transport = typeof sessionId === 'string' ? transports.get(sessionId) : undefined;
    if (!transport) {
      if (typeof sessionId === 'string') {
        res.writeHead(404).end();
        return;
      }
      const created = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        enableJsonResponse: options.jsonResponse ?? false,
        onsessioninitialized: (id) => {
          transports.set(id, created);
        },
        onsessionclosed: (id) => {
          transports.delete(id);
        },
      });
      await createMcpServer().connect(created);
      transport = created;
    }
    await transport.handleRequest(req, res);
  });

  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const { port } = http.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}/mcp`,
    origin: `http://127.0.0.1:${port}`,
    received,
    stats,
    sessions: transports,
    async close() {
      for (const transport of transports.values()) await transport.close();
      http.closeAllConnections();
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
}

export type FakeUpstream = Awaited<ReturnType<typeof startFakeUpstream>>;

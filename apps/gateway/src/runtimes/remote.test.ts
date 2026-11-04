import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ConnectorManifest } from '@mcp-outlet/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  FAKE_UPSTREAM_TOKEN,
  type FakeUpstream,
  startFakeUpstream,
} from '../testing/fake-upstream.ts';
import { createUpstreamFetch } from '../upstream/safe-fetch.ts';
import { createRemoteRuntime, upstreamAuthHeaders } from './remote.ts';

function remote(url: string, token?: string) {
  const manifest: ConnectorManifest = {
    manifestVersion: 1,
    name: 'test',
    runtime: 'remote',
    url,
    visibleGroups: [],
    credentials: [{ key: 'TOKEN', label: '토큰', secret: true, scope: 'user' }],
    auth: { type: 'static_token', credential: 'TOKEN', header: 'Authorization', prefix: 'Bearer ' },
  };
  const credentials: Record<string, string> = token ? { TOKEN: token } : {};
  return { manifest, credentials };
}

function runtime(options: { allowCidrs?: string[]; timeoutMs?: number } = {}) {
  const timeoutMs = options.timeoutMs ?? 3000;
  const fetch = createUpstreamFetch({
    allowCidrs: options.allowCidrs ?? ['127.0.0.1/32'],
    timeoutMs,
  });
  return createRemoteRuntime({ fetch, timeoutMs });
}

describe('remote 연결 테스트', () => {
  let upstream: FakeUpstream;

  beforeAll(async () => {
    upstream = await startFakeUpstream({ token: FAKE_UPSTREAM_TOKEN });
  });

  afterAll(() => upstream.close());

  it('initialize → tools/list가 성공하면 툴 이름·설명·annotations를 돌려준다', async () => {
    const test = await runtime().testConnection(remote(upstream.url, FAKE_UPSTREAM_TOKEN));
    expect(test.result).toBe('ok');
    if (test.result !== 'ok') return;
    expect(test.tools.map((tool) => tool.name)).toEqual(['read_item', 'delete_item', 'slow_count']);
    expect(test.tools[0]).toEqual({
      name: 'read_item',
      description: '항목 하나를 읽는다\n두 번째 줄',
      annotations: { readOnlyHint: true },
    });
  });

  it('토큰이 틀리면 auth_failed', async () => {
    const test = await runtime().testConnection(remote(upstream.url, 'wrong'));
    expect(test).toEqual({ result: 'auth_failed' });
  });

  it('MCP가 아닌 주소면 not_mcp', async () => {
    const test = await runtime().testConnection(
      remote(`${upstream.origin}/other`, FAKE_UPSTREAM_TOKEN),
    );
    expect(test).toEqual({ result: 'not_mcp' });
  });

  it('redirect는 따르지 않는다', async () => {
    const test = await runtime().testConnection(
      remote(`${upstream.origin}/moved`, FAKE_UPSTREAM_TOKEN),
    );
    expect(test).toEqual({ result: 'redirect' });
  });

  it('허용 대역이 아니면 private_address', async () => {
    const test = await runtime({ allowCidrs: [] }).testConnection(
      remote(upstream.url, FAKE_UPSTREAM_TOKEN),
    );
    expect(test).toEqual({ result: 'private_address' });
  });

  it('연결이 거부되면 unreachable, 응답이 없으면 timeout', async () => {
    const hang = createServer(() => {});
    await new Promise<void>((resolve) => hang.listen(0, '127.0.0.1', resolve));
    const port = (hang.address() as AddressInfo).port;
    try {
      const slow = await runtime({ timeoutMs: 200 }).testConnection(
        remote(`http://127.0.0.1:${port}/mcp`),
      );
      expect(slow).toEqual({ result: 'timeout' });
    } finally {
      hang.closeAllConnections();
      hang.close();
    }
    const closed = await runtime().testConnection(remote(`http://127.0.0.1:${port}/mcp`));
    expect(closed).toEqual({ result: 'unreachable' });
  });

  it('정적 토큰을 헤더 이름·접두어대로 만든다', () => {
    const connector = remote(upstream.url, 'abc');
    expect(upstreamAuthHeaders(connector)).toEqual({ Authorization: 'Bearer abc' });
    const custom = {
      ...connector,
      manifest: {
        ...connector.manifest,
        auth: { type: 'static_token', credential: 'TOKEN', header: 'X-Api-Key', prefix: '' },
      } as ConnectorManifest,
    };
    expect(upstreamAuthHeaders(custom)).toEqual({ 'X-Api-Key': 'abc' });
    expect(upstreamAuthHeaders(remote(upstream.url))).toEqual({});
  });
});

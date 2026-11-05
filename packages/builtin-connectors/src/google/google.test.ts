import { describe, expect, it } from 'vitest';
import { BuiltinApiError } from '../errors.ts';
import type { BuiltinCallContext } from '../types.ts';
import { googleAnalytics } from './index.ts';

type Handler = (url: URL, init: RequestInit) => Response | Promise<Response>;

// 가짜 Google API: 호출을 기록하고 경로별 응답을 돌려준다
function fakeGoogle(handler: Handler) {
  const calls: { url: URL; init: RequestInit }[] = [];
  const fetch = (async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(input);
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof globalThis.fetch;
  const ctx: BuiltinCallContext = {
    accessToken: 'ya29.test',
    fetch,
    signal: new AbortController().signal,
  };
  return { ctx, calls };
}

const json = (body: unknown, status = 200) => Response.json(body, { status });

function textOf(result: Awaited<ReturnType<typeof googleAnalytics.callTool>>): string {
  const [first] = result.content;
  return first?.type === 'text' ? first.text : '';
}

describe('Google Analytics 4 + Search Console 툴', () => {
  it('모든 툴이 readOnlyHint와 object inputSchema를 가진다', () => {
    const tools = googleAnalytics.listTools();
    expect(tools.map((tool) => tool.name)).toEqual([
      'ga4_list_properties',
      'ga4_get_metadata',
      'ga4_run_report',
      'ga4_run_realtime_report',
      'gsc_list_sites',
      'gsc_search_analytics',
      'gsc_inspect_url',
      'gsc_list_sitemaps',
    ]);
    for (const tool of tools) {
      expect(tool.annotations?.readOnlyHint).toBe(true);
      expect(tool.inputSchema.type).toBe('object');
    }
  });

  it('runReport: Bearer 토큰으로 호출하고 행을 값 배열로 줄인다', async () => {
    const { ctx, calls } = fakeGoogle(() =>
      json({
        dimensionHeaders: [{ name: 'country' }],
        metricHeaders: [{ name: 'sessions', type: 'TYPE_INTEGER' }],
        rows: [{ dimensionValues: [{ value: 'South Korea' }], metricValues: [{ value: '42' }] }],
        rowCount: 1,
      }),
    );
    const result = await googleAnalytics.callTool(
      'ga4_run_report',
      {
        propertyId: 'properties/123',
        startDate: '7daysAgo',
        endDate: 'today',
        metrics: ['sessions'],
        dimensions: ['country'],
      },
      ctx,
    );
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(textOf(result))).toEqual({
      columns: ['country', 'sessions'],
      rows: [['South Korea', '42']],
      rowCount: 1,
    });
    const [call] = calls;
    expect(call?.url.toString()).toBe(
      'https://analyticsdata.googleapis.com/v1beta/properties/123:runReport',
    );
    expect(new Headers(call?.init.headers).get('authorization')).toBe('Bearer ya29.test');
    expect(JSON.parse(String(call?.init.body))).toMatchObject({
      dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }],
      metrics: [{ name: 'sessions' }],
      limit: 100,
    });
  });

  it('인자가 틀리면 API를 부르지 않고 오류 결과를 준다', async () => {
    const { ctx, calls } = fakeGoogle(() => json({}));
    const result = await googleAnalytics.callTool(
      'ga4_run_report',
      { propertyId: 'abc', startDate: 'x', endDate: 'today', metrics: [] },
      ctx,
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('propertyId');
    expect(calls).toHaveLength(0);
  });

  it('Google 400은 인자 오류 설명을, 403은 권한 안내를 결과로 주고, 401은 분류값만 담아 던진다', async () => {
    const invalid = fakeGoogle(() =>
      json(
        {
          error: {
            code: 400,
            message: 'Field foo is not a valid metric.',
            status: 'INVALID_ARGUMENT',
          },
        },
        400,
      ),
    );
    const bad = await googleAnalytics.callTool(
      'ga4_run_report',
      { propertyId: '1', startDate: 'today', endDate: 'today', metrics: ['foo'] },
      invalid.ctx,
    );
    expect(bad.isError).toBe(true);
    expect(textOf(bad)).toContain('Field foo is not a valid metric.');

    const denied = fakeGoogle(() =>
      json(
        {
          error: {
            code: 403,
            message: 'User secret-detail does not have access',
            status: 'PERMISSION_DENIED',
          },
        },
        403,
      ),
    );
    // 403은 자격증명이 유효하므로 커넥터 오류가 아니라 툴 결과로 돌려준다
    const forbidden = await googleAnalytics.callTool('gsc_list_sites', {}, denied.ctx);
    expect(forbidden.isError).toBe(true);
    expect(textOf(forbidden)).toContain('권한이 없거나 API가 꺼져 있습니다');
    expect(textOf(forbidden)).not.toContain('secret-detail');

    const unauthorized = fakeGoogle(() => json({}, 401));
    await expect(googleAnalytics.callTool('gsc_list_sites', {}, unauthorized.ctx)).rejects.toEqual(
      new BuiltinApiError('auth_failed'),
    );
  });

  it('타임아웃·연결 실패는 분류 문구로 바꾼다', async () => {
    const timeout = fakeGoogle(() => {
      throw new DOMException('timed out', 'TimeoutError');
    });
    const slow = await googleAnalytics.callTool('ga4_list_properties', {}, timeout.ctx);
    expect(textOf(slow)).toContain('너무 늦습니다');

    const down = fakeGoogle(() => {
      throw new TypeError('fetch failed: getaddrinfo ENOTFOUND internal-host');
    });
    const failed = await googleAnalytics.callTool('ga4_list_properties', {}, down.ctx);
    expect(textOf(failed)).toContain('연결하지 못했습니다');
    expect(textOf(failed)).not.toContain('internal-host');
  });

  it('Search Console 검색 실적: siteUrl을 경로에 인코딩하고 rows를 줄인다', async () => {
    const { ctx, calls } = fakeGoogle(() =>
      json({ rows: [{ keys: ['mcp'], clicks: 3, impressions: 10, ctr: 0.3, position: 2.5 }] }),
    );
    const result = await googleAnalytics.callTool(
      'gsc_search_analytics',
      {
        siteUrl: 'sc-domain:example.com',
        startDate: '2026-10-01',
        endDate: '2026-10-31',
        dimensions: ['query'],
      },
      ctx,
    );
    expect(JSON.parse(textOf(result))).toMatchObject({
      columns: ['query', 'clicks', 'impressions', 'ctr', 'position'],
      rows: [['mcp', 3, 10, 0.3, 2.5]],
    });
    expect(calls[0]?.url.pathname).toBe(
      '/webmasters/v3/sites/sc-domain%3Aexample.com/searchAnalytics/query',
    );
  });

  it('연결 테스트: GA 권한이 없어도 Search Console이 되면 통과, 인증 실패는 그대로 던진다', async () => {
    const gscOnly = fakeGoogle((url) =>
      url.hostname === 'analyticsadmin.googleapis.com' ? json({}, 403) : json({ siteEntry: [] }),
    );
    await expect(googleAnalytics.checkAccess(gscOnly.ctx)).resolves.toBeUndefined();

    const unauthorized = fakeGoogle(() => json({}, 401));
    await expect(googleAnalytics.checkAccess(unauthorized.ctx)).rejects.toEqual(
      new BuiltinApiError('auth_failed'),
    );
  });

  it('서비스 계정 키는 client_email과 private_key만 읽는다', () => {
    const method = googleAnalytics.authMethods.find((item) => item.type === 'service_account');
    if (method?.type !== 'service_account') throw new Error('no service account');
    const key = JSON.stringify({
      type: 'service_account',
      client_email: 'outlet@project.iam.gserviceaccount.com',
      private_key: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n',
      token_uri: 'https://evil.example/token',
    });
    expect(method.parseKey(key)).toEqual({
      clientEmail: 'outlet@project.iam.gserviceaccount.com',
      privateKey: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n',
    });
    expect(method.parseKey('{"type":"authorized_user"}')).toBeNull();
    expect(method.parseKey('not json')).toBeNull();
  });
});

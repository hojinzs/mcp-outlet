import { z } from 'zod';
import { defineTool } from '../tools.ts';
import type { BuiltinCallContext } from '../types.ts';
import { googleApi } from './api.ts';

// Google Search Console: 사이트, 검색 실적, URL 검사, 사이트맵. 조회만 한다

export const SEARCH_CONSOLE_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';

const WEBMASTERS_API = 'https://www.googleapis.com/webmasters/v3';
const SEARCH_CONSOLE_API = 'https://searchconsole.googleapis.com/v1';

const siteUrl = z
  .string()
  .trim()
  .min(1)
  .max(2000)
  .describe(
    'Search Console 속성. URL 접두어(https://example.com/) 또는 도메인(sc-domain:example.com)',
  );

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');

function siteApi(site: string): string {
  return `${WEBMASTERS_API}/sites/${encodeURIComponent(site)}`;
}

type SiteList = { siteEntry?: { siteUrl?: string; permissionLevel?: string }[] };

export async function listSites(ctx: BuiltinCallContext) {
  const result = await googleApi<SiteList>(ctx, `${WEBMASTERS_API}/sites`);
  return (result.siteEntry ?? []).map(({ siteUrl: url, permissionLevel }) => ({
    siteUrl: url,
    permissionLevel,
  }));
}

const listSitesTool = defineTool({
  name: 'gsc_list_sites',
  title: 'Search Console 사이트 목록',
  description: '연결된 계정이 볼 수 있는 Search Console 속성(siteUrl)과 권한 수준을 돌려준다.',
  input: z.object({}),
  run: (_args, ctx) => listSites(ctx).then((sites) => ({ sites })),
});

const searchAnalytics = defineTool({
  name: 'gsc_search_analytics',
  title: 'Search Console 검색 실적',
  description:
    'searchanalytics.query. 기간·차원별 클릭, 노출, CTR, 평균 순위를 조회한다. 최근 2~3일 데이터는 아직 없을 수 있다.',
  input: z.object({
    siteUrl,
    startDate: isoDate.describe('시작일 YYYY-MM-DD'),
    endDate: isoDate.describe('종료일 YYYY-MM-DD'),
    dimensions: z
      .array(z.enum(['date', 'query', 'page', 'country', 'device', 'searchAppearance', 'hour']))
      .max(5)
      .default([]),
    type: z.enum(['web', 'image', 'video', 'news', 'discover', 'googleNews']).default('web'),
    dimensionFilterGroups: z
      .array(z.record(z.string(), z.unknown()))
      .optional()
      .describe(
        '예: [{"filters":[{"dimension":"query","operator":"contains","expression":"브랜드"}]}]',
      ),
    rowLimit: z.number().int().min(1).max(25000).default(100),
    startRow: z.number().int().min(0).default(0),
    dataState: z.enum(['final', 'all', 'hourly_all']).optional(),
  }),
  async run(args, ctx) {
    type Rows = {
      rows?: {
        keys?: string[];
        clicks?: number;
        impressions?: number;
        ctr?: number;
        position?: number;
      }[];
      responseAggregationType?: string;
    };
    const { siteUrl: site, ...query } = args;
    const result = await googleApi<Rows>(ctx, `${siteApi(site)}/searchAnalytics/query`, query);
    return {
      columns: [...args.dimensions, 'clicks', 'impressions', 'ctr', 'position'],
      rows: (result.rows ?? []).map((row) => [
        ...(row.keys ?? []),
        row.clicks,
        row.impressions,
        row.ctr,
        row.position,
      ]),
      aggregationType: result.responseAggregationType,
    };
  },
});

const inspectUrl = defineTool({
  name: 'gsc_inspect_url',
  title: 'Search Console URL 검사',
  description:
    'URL 검사(urlInspection.index.inspect). 색인 상태, 마지막 크롤링, 모바일 사용성 등을 돌려준다.',
  input: z.object({
    siteUrl,
    inspectionUrl: z.url().max(2000).describe('검사할 페이지 URL. siteUrl 속성 안의 주소여야 한다'),
    languageCode: z.string().max(20).optional().describe('결과 메시지 언어 (예: ko)'),
  }),
  async run(args, ctx) {
    const result = await googleApi<{ inspectionResult?: unknown }>(
      ctx,
      `${SEARCH_CONSOLE_API}/urlInspection/index:inspect`,
      { inspectionUrl: args.inspectionUrl, siteUrl: args.siteUrl, languageCode: args.languageCode },
    );
    return result.inspectionResult ?? {};
  },
});

const listSitemaps = defineTool({
  name: 'gsc_list_sitemaps',
  title: 'Search Console 사이트맵',
  description: '속성에 제출된 사이트맵 목록과 마지막 처리 시각, 경고·오류 수를 돌려준다.',
  input: z.object({ siteUrl }),
  async run({ siteUrl: site }, ctx) {
    const result = await googleApi<{ sitemap?: unknown[] }>(ctx, `${siteApi(site)}/sitemaps`);
    return { sitemaps: result.sitemap ?? [] };
  },
});

export const searchConsoleTools = [listSitesTool, searchAnalytics, inspectUrl, listSitemaps];

import { z } from 'zod';
import { defineTool } from '../tools.ts';
import type { BuiltinCallContext } from '../types.ts';
import { googleApi } from './api.ts';

// Google Analytics 4: Admin API(속성 목록)와 Data API(보고서). 조회만 한다

export const GA4_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';

const ADMIN_API = 'https://analyticsadmin.googleapis.com/v1beta';
const DATA_API = 'https://analyticsdata.googleapis.com/v1beta';
// 계정이 아주 많아도 응답이 끝없이 커지지 않게 막는다
const MAX_SUMMARY_PAGES = 5;

const propertyId = z
  .string()
  .trim()
  .regex(/^(properties\/)?\d+$/, '숫자 속성 ID (예: 123456789)')
  .transform((value) => value.replace(/^properties\//, ''))
  .describe('GA4 속성 ID. ga4_list_properties로 찾는다');

const date = z
  .string()
  .regex(
    /^(\d{4}-\d{2}-\d{2}|today|yesterday|\d+daysAgo)$/,
    'YYYY-MM-DD, today, yesterday, NdaysAgo',
  );

// GA4 FilterExpression을 그대로 넘긴다. 구조가 깊어 따로 검증하지 않고 Google 오류 설명에 맡긴다
const filterExpression = z
  .record(z.string(), z.unknown())
  .describe(
    'GA4 Data API FilterExpression (예: {"filter":{"fieldName":"country","stringFilter":{"value":"South Korea"}}})',
  );

const orderBys = z
  .array(z.record(z.string(), z.unknown()))
  .describe('GA4 Data API OrderBy 목록 (예: [{"metric":{"metricName":"sessions"},"desc":true}])');

type AccountSummaries = {
  accountSummaries?: {
    account?: string;
    displayName?: string;
    propertySummaries?: { property?: string; displayName?: string }[];
  }[];
  nextPageToken?: string;
};

type Header = { name?: string };
type Row = { dimensionValues?: { value?: string }[]; metricValues?: { value?: string }[] };
type ReportResponse = {
  dimensionHeaders?: Header[];
  metricHeaders?: (Header & { type?: string })[];
  rows?: Row[];
  totals?: Row[];
  rowCount?: number;
  metadata?: Record<string, unknown>;
};

export async function listAccountSummaries(ctx: BuiltinCallContext, pageSize: number) {
  const accounts = [];
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_SUMMARY_PAGES; page += 1) {
    const params = new URLSearchParams({ pageSize: String(pageSize) });
    if (pageToken) params.set('pageToken', pageToken);
    const result = await googleApi<AccountSummaries>(
      ctx,
      `${ADMIN_API}/accountSummaries?${params}`,
    );
    for (const summary of result.accountSummaries ?? []) {
      accounts.push({
        account: summary.account,
        name: summary.displayName,
        properties: (summary.propertySummaries ?? []).map((property) => ({
          propertyId: property.property?.replace(/^properties\//, ''),
          name: property.displayName,
        })),
      });
    }
    pageToken = result.nextPageToken;
    if (!pageToken) break;
  }
  return accounts;
}

// 행을 [차원..., 측정값...] 배열로 줄여 컨텍스트를 아낀다
function compactRows(rows: Row[] | undefined): string[][] {
  return (rows ?? []).map((row) => [
    ...(row.dimensionValues ?? []).map((value) => value.value ?? ''),
    ...(row.metricValues ?? []).map((value) => value.value ?? ''),
  ]);
}

function compactReport(report: ReportResponse) {
  return {
    columns: [
      ...(report.dimensionHeaders ?? []).map((header) => header.name),
      ...(report.metricHeaders ?? []).map((header) => header.name),
    ],
    rows: compactRows(report.rows),
    ...(report.totals ? { totals: compactRows(report.totals) } : {}),
    rowCount: report.rowCount ?? 0,
  };
}

const listProperties = defineTool({
  name: 'ga4_list_properties',
  title: 'GA4 속성 목록',
  description:
    '연결된 계정이 볼 수 있는 Google Analytics 계정과 GA4 속성(ID·이름) 목록을 돌려준다.',
  input: z.object({}),
  run: (_args, ctx) => listAccountSummaries(ctx, 200).then((accounts) => ({ accounts })),
});

const getMetadata = defineTool({
  name: 'ga4_get_metadata',
  title: 'GA4 차원·측정항목',
  description:
    'GA4 속성에서 보고서에 쓸 수 있는 차원(dimension)과 측정항목(metric)의 apiName 목록을 돌려준다. 맞춤 정의 포함.',
  input: z.object({ propertyId }),
  async run({ propertyId: id }, ctx) {
    type Field = { apiName?: string; uiName?: string; category?: string; type?: string };
    const metadata = await googleApi<{ dimensions?: Field[]; metrics?: Field[] }>(
      ctx,
      `${DATA_API}/properties/${id}/metadata`,
    );
    return {
      dimensions: (metadata.dimensions ?? []).map(({ apiName, uiName, category }) => ({
        apiName,
        uiName,
        category,
      })),
      metrics: (metadata.metrics ?? []).map(({ apiName, uiName, category, type }) => ({
        apiName,
        uiName,
        category,
        type,
      })),
    };
  },
});

const runReport = defineTool({
  name: 'ga4_run_report',
  title: 'GA4 보고서',
  description:
    'GA4 Data API runReport. 기간, 차원, 측정항목으로 보고서를 만든다. 결과는 columns와 rows(값 배열)로 준다.',
  input: z.object({
    propertyId,
    startDate: date.describe('시작일 (YYYY-MM-DD, today, yesterday, NdaysAgo)'),
    endDate: date.describe('종료일 (YYYY-MM-DD, today, yesterday, NdaysAgo)'),
    metrics: z.array(z.string().min(1)).min(1).max(10).describe('예: ["sessions","activeUsers"]'),
    dimensions: z.array(z.string().min(1)).max(9).default([]).describe('예: ["date","country"]'),
    dimensionFilter: filterExpression.optional(),
    metricFilter: filterExpression.optional(),
    orderBys: orderBys.optional(),
    limit: z.number().int().min(1).max(10000).default(100),
    offset: z.number().int().min(0).default(0),
  }),
  async run(args, ctx) {
    const report = await googleApi<ReportResponse>(
      ctx,
      `${DATA_API}/properties/${args.propertyId}:runReport`,
      {
        dateRanges: [{ startDate: args.startDate, endDate: args.endDate }],
        metrics: args.metrics.map((name) => ({ name })),
        dimensions: args.dimensions.map((name) => ({ name })),
        dimensionFilter: args.dimensionFilter,
        metricFilter: args.metricFilter,
        orderBys: args.orderBys,
        limit: args.limit,
        offset: args.offset,
      },
    );
    return compactReport(report);
  },
});

const runRealtimeReport = defineTool({
  name: 'ga4_run_realtime_report',
  title: 'GA4 실시간 보고서',
  description: 'GA4 Data API runRealtimeReport. 최근 30분(기본) 동안의 실시간 데이터를 조회한다.',
  input: z.object({
    propertyId,
    metrics: z.array(z.string().min(1)).min(1).max(10).describe('예: ["activeUsers"]'),
    dimensions: z.array(z.string().min(1)).max(9).default([]).describe('예: ["country"]'),
    minutesAgo: z
      .number()
      .int()
      .min(1)
      .max(60)
      .optional()
      .describe('지금부터 몇 분 전까지 볼지. 표준 속성은 최대 29'),
    limit: z.number().int().min(1).max(10000).default(100),
  }),
  async run(args, ctx) {
    const report = await googleApi<ReportResponse>(
      ctx,
      `${DATA_API}/properties/${args.propertyId}:runRealtimeReport`,
      {
        metrics: args.metrics.map((name) => ({ name })),
        dimensions: args.dimensions.map((name) => ({ name })),
        minuteRanges:
          args.minutesAgo === undefined
            ? undefined
            : [{ startMinutesAgo: args.minutesAgo, endMinutesAgo: 0 }],
        limit: args.limit,
      },
    );
    return compactReport(report);
  },
});

export const ga4Tools = [listProperties, getMetadata, runReport, runRealtimeReport];

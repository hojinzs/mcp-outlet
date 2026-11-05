import type { CallResult } from '../../api/types.ts';

// SCR-ADM-06 감사 로그 필터. 주소(location.search)에 넣어 새로고침·링크 공유가 되게 한다

export type AuditPeriod = '1h' | '24h' | '7d' | '30d' | 'custom';

export type AuditFilterState = {
  period: AuditPeriod;
  // 직접 지정일 때만. <input type="datetime-local"> 값(브라우저 시간대)
  from: string;
  to: string;
  userId: string;
  endpointId: string;
  connectorId: string;
  result: CallResult | '';
  tool: string;
};

export const periodOptions: { value: AuditPeriod; label: string }[] = [
  { value: '1h', label: '최근 1시간' },
  { value: '24h', label: '최근 24시간' },
  { value: '7d', label: '최근 7일' },
  { value: '30d', label: '최근 30일' },
  { value: 'custom', label: '직접 지정' },
];

export const resultOptions: { value: CallResult | ''; label: string }[] = [
  { value: '', label: '전체' },
  { value: 'ok', label: '성공' },
  { value: 'error', label: '오류' },
  { value: 'denied', label: '거부' },
];

const HOUR_MS = 60 * 60 * 1000;
const periodMs: Record<Exclude<AuditPeriod, 'custom'>, number> = {
  '1h': HOUR_MS,
  '24h': 24 * HOUR_MS,
  '7d': 7 * 24 * HOUR_MS,
  '30d': 30 * 24 * HOUR_MS,
};

const DEFAULT_PERIOD: AuditPeriod = '24h';
const isPeriod = (value: string | null): value is AuditPeriod =>
  periodOptions.some((option) => option.value === value);
const isResult = (value: string | null): value is CallResult =>
  value === 'ok' || value === 'error' || value === 'denied';

export function readAuditFilter(params: URLSearchParams): AuditFilterState {
  const period = params.get('period');
  const result = params.get('result');
  return {
    period: isPeriod(period) ? period : DEFAULT_PERIOD,
    from: params.get('from') ?? '',
    to: params.get('to') ?? '',
    userId: params.get('user') ?? '',
    endpointId: params.get('endpoint') ?? '',
    connectorId: params.get('connector') ?? '',
    result: isResult(result) ? result : '',
    tool: params.get('tool') ?? '',
  };
}

// 기본값은 주소에 넣지 않는다
export function writeAuditFilter(state: AuditFilterState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.period !== DEFAULT_PERIOD) params.set('period', state.period);
  if (state.period === 'custom') {
    if (state.from) params.set('from', state.from);
    if (state.to) params.set('to', state.to);
  }
  if (state.userId) params.set('user', state.userId);
  if (state.endpointId) params.set('endpoint', state.endpointId);
  if (state.connectorId) params.set('connector', state.connectorId);
  if (state.result) params.set('result', state.result);
  if (state.tool.trim()) params.set('tool', state.tool.trim());
  return params;
}

// 사용자를 바꾸면 그 사람 것이던 엔드포인트·커넥터 선택을 푼다
export function withUser(state: AuditFilterState, userId: string): AuditFilterState {
  return { ...state, userId, endpointId: '', connectorId: '' };
}

function localToIso(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// gateway 쿼리 문자열. 최근 N 기간은 분 단위로 내림한 지금부터 센다.
// 같은 분 안에서는 쿼리가 같아 다시 그려도 캐시를 그대로 쓴다
export function auditApiQuery(state: AuditFilterState, now: Date): string {
  const params = new URLSearchParams();
  if (state.period === 'custom') {
    const from = localToIso(state.from);
    const to = localToIso(state.to);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
  } else {
    const minute = Math.floor(now.getTime() / 60_000) * 60_000;
    params.set('from', new Date(minute - periodMs[state.period]).toISOString());
  }
  if (state.userId) params.set('userId', state.userId);
  if (state.endpointId) params.set('endpointId', state.endpointId);
  if (state.connectorId) params.set('connectorId', state.connectorId);
  if (state.result) params.set('result', state.result);
  if (state.tool.trim()) params.set('tool', state.tool.trim());
  return params.toString();
}

export function errorRate(errors: number, total: number): string {
  if (total === 0) return '0%';
  return `${Math.round((errors / total) * 1000) / 10}%`;
}

// 1초 이상이면 강조한다
export const SLOW_CALL_MS = 1000;

export function retentionNotice(days: number): string {
  return days === 0 ? '기록을 지우지 않습니다.' : `${days}일이 지난 기록은 지워집니다.`;
}

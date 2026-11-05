import type { CallResult } from '../api/types.ts';
import { Badge, type BadgeVariant } from './ui/badge.tsx';

// 감사 로그 결과 배지: 성공 / 오류 / 거부 (SCR-EP-03 최근 호출, SCR-ADM-06)
const resultView: Record<CallResult, { label: string; variant: BadgeVariant }> = {
  ok: { label: '성공', variant: 'success' },
  error: { label: '오류', variant: 'destructive' },
  denied: { label: '거부', variant: 'warning' },
};

export function CallResultBadge({ result }: { result: CallResult }) {
  return <Badge variant={resultView[result].variant}>{resultView[result].label}</Badge>;
}

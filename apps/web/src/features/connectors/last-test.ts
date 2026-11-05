import type { Connector } from '../../api/types.ts';
import { formatDateTime } from '../../lib/format.ts';
import { connectorTestMessage } from './builtin.ts';

// SCR-EP-03 커넥터 설정의 "마지막 연결 테스트".
// timeout·upstream_error·permission_denied는 커넥터 상태를 바꾸지 않으므로(PRD "커넥터 오류 상태의 범위")
// 상태가 정상인데 마지막 테스트가 실패했으면 일시 실패로 따로 알린다
export type LastTestTone = 'none' | 'ok' | 'transient' | 'failed';

export type LastTestView = { text: string; tone: LastTestTone; note: string | null };

type LastTestSource = Pick<Connector, 'runtime' | 'status' | 'lastTestResult' | 'lastTestedAt'>;

export const transientFailureNote =
  '커넥터 상태는 바꾸지 않았습니다. 일시적인 장애이거나 권한 문제라 자격증명은 그대로 유효합니다.';

export function lastTestView(
  connector: LastTestSource,
  formatTime: (value: string | null) => string = formatDateTime,
): LastTestView {
  const result = connector.lastTestResult;
  if (result === null) return { text: '마지막 연결 테스트: 없음', tone: 'none', note: null };
  const at = formatTime(connector.lastTestedAt);
  if (result === 'ok') return { text: `마지막 연결 테스트: ${at} · 성공`, tone: 'ok', note: null };
  const text = `마지막 연결 테스트: ${at} · ${connectorTestMessage(connector.runtime, result)}`;
  if (connector.status === 'ok') return { text, tone: 'transient', note: transientFailureNote };
  return { text, tone: 'failed', note: null };
}

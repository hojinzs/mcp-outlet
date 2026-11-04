import { useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { requests } from '../../api/queries.ts';
import type { OAuthStartInput } from '../../api/types.ts';

// 업스트림 동의 화면으로 보낸다. 응답이 state 쿠키를 심으므로 받은 주소로 바로 이동한다.
// 이동은 effect에서 한다: redirecting으로 꺼진 LeaveGuard의 beforeunload가 먼저 풀린 뒤라 확인 창이 뜨지 않는다
export function useOAuthStart() {
  const [target, setTarget] = useState<string | null>(null);

  useEffect(() => {
    if (target !== null) window.location.assign(target);
  }, [target]);

  const start = useMutation({
    mutationFn: ({ connectorId, input }: { connectorId: string; input: OAuthStartInput }) =>
      requests.startConnectorOAuth(connectorId, input),
    onSuccess: ({ authorizationUrl }) => setTarget(authorizationUrl),
  });

  return { start, redirecting: target !== null };
}

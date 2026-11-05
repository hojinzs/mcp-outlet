import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import {
  connectOutcome,
  homeConnectNotice,
  withoutConnectOutcome,
} from '../features/connectors/builtin.ts';

// 업스트림 동의에서 돌아갈 화면을 모를 때(state 쿠키 만료·불일치) gateway가 홈으로 보낸 결과 (SCR-EP-01).
// 처음 한 번만 읽고 새로고침 때 다시 뜨지 않게 쿼리에서 지운다
export function HomeConnectNotice() {
  const [params, setParams] = useSearchParams();
  const [notice] = useState(() => homeConnectNotice(connectOutcome(params)));

  useEffect(() => {
    if (connectOutcome(params) !== null)
      setParams(withoutConnectOutcome(params), { replace: true });
  }, [params, setParams]);

  if (notice === null) return null;
  return (
    <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
      {notice}
    </p>
  );
}

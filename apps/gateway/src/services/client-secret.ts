import type { Db } from '../db/client.ts';
import { insertActivityLog } from '../db/queries/activity-logs.ts';
import { ServiceError } from './errors.ts';

// 공유 Client Secret 보기 (SCR-EP-04 결정 사항). 볼 때마다 누가 봤는지만 남기고 값은 기록하지 않는다
export async function revealClientSecret(
  deps: { db: Db; clientSecret: string | undefined },
  actorId: string,
): Promise<{ clientSecret: string }> {
  // Public client 설치에는 보여줄 secret이 없다
  if (!deps.clientSecret) throw new ServiceError('not_found');
  await insertActivityLog(deps.db, {
    actorId,
    action: 'client_secret.view',
    targetType: 'oauth_client',
  });
  return { clientSecret: deps.clientSecret };
}

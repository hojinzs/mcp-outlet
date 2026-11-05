import { ApiError } from '../../api/client.ts';

// limit_exceeded 문구. gateway가 details.resource('connector'·'endpoint')와 details.limit을 준다 (F-EP-01)
export function limitExceededText(error: unknown): string | null {
  if (!(error instanceof ApiError) || error.code !== 'limit_exceeded') return null;
  const limit = error.details?.limit;
  const max = typeof limit === 'number' && Number.isInteger(limit) && limit > 0 ? limit : null;
  switch (error.details?.resource) {
    case 'connector':
      return `${reached('커넥터', max)}. 엔드포인트 없는 커넥터를 지우면 자리가 납니다`;
    case 'endpoint':
      return reached('엔드포인트', max);
    default:
      return '만들 수 있는 개수의 상한에 도달했습니다';
  }
}

function reached(resource: '커넥터' | '엔드포인트', max: number | null): string {
  return max === null
    ? `만들 수 있는 ${resource} 개수의 상한에 도달했습니다`
    : `${resource}는 최대 ${max}개까지 만들 수 있습니다`;
}

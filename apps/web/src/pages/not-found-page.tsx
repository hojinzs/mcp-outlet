import { ApiError } from '../api/client.ts';
import { PageError } from '../components/page-error.tsx';

// SCR-COM-04 없는 화면. 없는 경로도 없는 엔드포인트와 같은 404로 보여준다
export function NotFoundPage() {
  return <PageError error={new ApiError(404, { code: 'not_found' })} />;
}

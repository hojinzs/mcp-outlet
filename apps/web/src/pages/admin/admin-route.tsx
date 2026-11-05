import { useQuery } from '@tanstack/react-query';
import { Navigate, Outlet } from 'react-router';
import { meQuery } from '../../api/queries.ts';
import { Loading } from '../../components/loading.tsx';

// 관리 화면(/admin/manage/*)은 admin만. 메뉴를 숨겨도 주소를 직접 넣을 수 있어 화면에서도 막는다 (SCR-COM-01).
// gateway도 관리자 API마다 role을 확인하고 403을 준다
export function AdminRoute() {
  const me = useQuery(meQuery);
  if (!me.data) return <Loading />;
  if (me.data.role !== 'admin') return <Navigate to="/forbidden?reason=admin_only" replace />;
  return <Outlet />;
}

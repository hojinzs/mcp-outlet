import { createBrowserRouter } from 'react-router';
import { AppLayout } from './layouts/app-layout.tsx';
import { AdminRoute } from './pages/admin/admin-route.tsx';
import { UsersPage } from './pages/admin/users-page.tsx';
import { EndpointConnectPage } from './pages/endpoint-connect-page.tsx';
import { EndpointDetailPage } from './pages/endpoint-detail/endpoint-detail-page.tsx';
import { EndpointListPage } from './pages/endpoint-list-page.tsx';
import { EndpointNewPage } from './pages/endpoint-new/endpoint-new-page.tsx';
import { ForbiddenPage } from './pages/forbidden-page.tsx';
import { LoginPage } from './pages/login-page.tsx';
import { NotFoundPage } from './pages/not-found-page.tsx';
import { RouteErrorPage } from './pages/route-error-page.tsx';

// 화면 경로는 모두 /admin/ 아래다 (screen-definitions/index.md)
export const router = createBrowserRouter(
  [
    { path: '/login', element: <LoginPage /> },
    { path: '/forbidden', element: <ForbiddenPage /> },
    {
      element: <AppLayout />,
      children: [
        {
          errorElement: <RouteErrorPage />,
          children: [
            { index: true, element: <EndpointListPage /> },
            { path: 'endpoints/new', element: <EndpointNewPage /> },
            { path: 'endpoints/:id', element: <EndpointDetailPage /> },
            { path: 'endpoints/:id/connect', element: <EndpointConnectPage /> },
            {
              path: 'manage',
              element: <AdminRoute />,
              children: [{ path: 'users', element: <UsersPage /> }],
            },
            { path: '*', element: <NotFoundPage /> },
          ],
        },
      ],
    },
  ],
  { basename: '/admin' },
);

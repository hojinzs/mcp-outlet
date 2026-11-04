import { createBrowserRouter } from 'react-router';
import { AppLayout } from './layouts/app-layout.tsx';
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
            { path: '*', element: <NotFoundPage /> },
          ],
        },
      ],
    },
  ],
  { basename: '/admin' },
);

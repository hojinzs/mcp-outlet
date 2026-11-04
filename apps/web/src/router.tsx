import { createBrowserRouter } from 'react-router';
import { AppLayout } from './layouts/app-layout.tsx';
import { ForbiddenPage } from './pages/forbidden-page.tsx';
import { LoginPage } from './pages/login-page.tsx';

// 화면 경로는 모두 /admin/ 아래다 (screen-definitions/index.md)
export const router = createBrowserRouter(
  [
    { path: '/login', element: <LoginPage /> },
    { path: '/forbidden', element: <ForbiddenPage /> },
    {
      element: <AppLayout />,
      children: [],
    },
  ],
  { basename: '/admin' },
);

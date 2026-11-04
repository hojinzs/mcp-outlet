import { createBrowserRouter } from 'react-router';
import { AppLayout } from './layouts/app-layout.tsx';
import { LoginPage } from './pages/login-page.tsx';

// 화면 경로는 모두 /admin/ 아래다 (screen-definitions/index.md)
export const router = createBrowserRouter(
  [
    { path: '/login', element: <LoginPage /> },
    {
      element: <AppLayout />,
      children: [],
    },
  ],
  { basename: '/admin' },
);

import { createBrowserRouter } from 'react-router';
import { AppLayout } from './layouts/app-layout.tsx';

// 화면 경로는 모두 /admin/ 아래다 (screen-definitions/index.md)
export const router = createBrowserRouter(
  [
    {
      element: <AppLayout />,
      children: [],
    },
  ],
  { basename: '/admin' },
);

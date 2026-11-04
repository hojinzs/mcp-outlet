import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { createQueryClient } from './api/query-client.ts';
import { Toaster } from './components/ui/sonner.tsx';
import { router } from './router.tsx';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root 요소가 없습니다');

const queryClient = createQueryClient();

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster />
    </QueryClientProvider>
  </StrictMode>,
);

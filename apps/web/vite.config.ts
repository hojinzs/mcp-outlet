import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const gateway = 'http://localhost:3000';

// gateway가 같은 출처의 /admin 에서 서빙하므로 세션 쿠키·CORS 설정이 필요 없다
export default defineConfig({
  base: '/admin/',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': gateway,
      '/auth': gateway,
      '/health': gateway,
    },
  },
});

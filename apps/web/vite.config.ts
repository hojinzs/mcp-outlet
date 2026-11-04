import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const gateway = 'http://localhost:3000';

// gateway가 같은 출처의 /admin 에서 서빙하므로 세션 쿠키·CORS 설정이 필요 없다.
// 개발 중에는 PUBLIC_BASE_URL=http://localhost:5173 으로 두고 나머지 경로를 모두 gateway로 넘겨
// 로그인 콜백·MCP 엔드포인트·보호 리소스 메타데이터를 한 출처로 맞춘다
export default defineConfig({
  base: '/admin/',
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': gateway,
      '/auth': gateway,
      '/health': gateway,
      '/c': gateway,
      '/.well-known': gateway,
    },
  },
});

import { useEffect, useState } from 'react';

type Health = 'checking' | 'ok' | 'error';

export function App() {
  const [health, setHealth] = useState<Health>('checking');

  useEffect(() => {
    fetch('/health')
      .then((response) => setHealth(response.ok ? 'ok' : 'error'))
      .catch(() => setHealth('error'));
  }, []);

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 24 }}>
      <h1>MCP Outlet</h1>
      <p>게이트웨이 상태: {health}</p>
    </main>
  );
}

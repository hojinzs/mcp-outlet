import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createUpstreamFetch, type ResolveHost, UpstreamError } from './safe-fetch.ts';

const LOCAL = ['127.0.0.1/32'];

function resolveTo(...addresses: string[]): ResolveHost {
  return async () =>
    addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
}

async function expectKind(promise: Promise<unknown>, kind: UpstreamError['kind']) {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(UpstreamError);
  expect((error as UpstreamError).kind).toBe(kind);
}

describe('createUpstreamFetch', () => {
  let server: Server;
  let port = 0;

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === '/redirect') {
        res.writeHead(302, { location: 'http://169.254.169.254/' }).end();
        return;
      }
      if (req.url === '/hang') return;
      res.writeHead(200, { 'content-type': 'text/plain' }).end('hello');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(() => {
    server.closeAllConnections();
    server.close();
  });

  it('허용 대역 호스트는 검사한 주소로 연결하고 http를 허용한다', async () => {
    // 시스템 DNS로는 풀리지 않는 이름이라, 성공하면 검사한 주소로 연결했다는 뜻이다
    const fetch = createUpstreamFetch({
      allowCidrs: LOCAL,
      timeoutMs: 2000,
      resolve: resolveTo('127.0.0.1'),
    });
    const res = await fetch(`http://upstream.invalid:${port}/`);
    expect(await res.text()).toBe('hello');
  });

  it('허용 대역이 없으면 loopback IP 리터럴을 막는다', async () => {
    const fetch = createUpstreamFetch({ allowCidrs: [], timeoutMs: 2000 });
    await expectKind(fetch(`https://127.0.0.1:${port}/`), 'blocked_address');
    await expectKind(fetch(`https://[::1]:${port}/`), 'blocked_address');
    await expectKind(fetch(`https://[::ffff:127.0.0.1]:${port}/`), 'blocked_address');
  });

  it('해석 결과 중 하나라도 사설이면 막는다 (DNS rebinding)', async () => {
    const fetch = createUpstreamFetch({
      allowCidrs: [],
      timeoutMs: 2000,
      resolve: resolveTo('93.184.216.34', '10.0.0.5'),
    });
    await expectKind(fetch('https://rebind.example/'), 'blocked_address');
  });

  it('메타데이터 주소로 풀리는 이름을 막는다', async () => {
    const fetch = createUpstreamFetch({
      allowCidrs: [],
      timeoutMs: 2000,
      resolve: resolveTo('169.254.169.254'),
    });
    await expectKind(fetch('https://metadata.example/'), 'blocked_address');
  });

  it('공인 주소에는 http를 허용하지 않는다', async () => {
    const fetch = createUpstreamFetch({
      allowCidrs: LOCAL,
      timeoutMs: 2000,
      resolve: resolveTo('93.184.216.34'),
    });
    await expectKind(fetch('http://public.example/'), 'insecure_scheme');
    await expectKind(fetch('ftp://public.example/'), 'insecure_scheme');
  });

  it('redirect는 따르지 않고 오류로 돌려준다', async () => {
    const fetch = createUpstreamFetch({ allowCidrs: LOCAL, timeoutMs: 2000 });
    await expectKind(fetch(`http://127.0.0.1:${port}/redirect`), 'redirect');
  });

  it('응답 헤더가 늦으면 timeout', async () => {
    const fetch = createUpstreamFetch({ allowCidrs: LOCAL, timeoutMs: 100 });
    await expectKind(fetch(`http://127.0.0.1:${port}/hang`), 'timeout');
  });

  it('연결이 거부되면 unreachable', async () => {
    const closed = createServer();
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
    const closedPort = (closed.address() as AddressInfo).port;
    closed.close();
    const fetch = createUpstreamFetch({ allowCidrs: LOCAL, timeoutMs: 2000 });
    await expectKind(fetch(`http://127.0.0.1:${closedPort}/`), 'unreachable');
  });
});

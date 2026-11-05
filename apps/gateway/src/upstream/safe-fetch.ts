import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP, type LookupFunction } from 'node:net';
import { Agent, fetch as undiciFetch } from 'undici';
import { type AddressPolicy, createAddressPolicy } from './address-policy.ts';

// 사용자 원격 URL 전용 fetch (F-CON-06, F-RUN-01).
// - DNS 해석 결과를 모두 검사하고, 검사한 그 주소로 연결한다(lookup 고정, DNS rebinding 방지)
// - https만. UPSTREAM_ALLOW_CIDRS 대역으로만 해석되는 호스트는 http도 허용
// - redirect는 따르지 않는다
// - 응답 헤더까지 UPSTREAM_TIMEOUT_MS. 본문(SSE)은 길게 열려 있을 수 있어 호출자 abort로만 끊는다.
//   JSON 본문의 완료 시간은 mcp/limits.ts readBoundedText가 따로 막는다

export type UpstreamErrorKind =
  | 'blocked_address'
  | 'insecure_scheme'
  | 'redirect'
  | 'timeout'
  | 'unreachable';

// 원인 예외는 담지 않는다. 로그·응답에는 kind만 쓴다
export class UpstreamError extends Error {
  readonly kind: UpstreamErrorKind;

  constructor(kind: UpstreamErrorKind) {
    super(`upstream ${kind}`);
    this.name = 'UpstreamError';
    this.kind = kind;
  }
}

export type ResolvedAddress = { address: string; family: number };
export type ResolveHost = (hostname: string) => Promise<ResolvedAddress[]>;

export type UpstreamFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

const defaultResolve: ResolveHost = (hostname) =>
  dnsLookup(hostname, { all: true, order: 'verbatim' });

// 주소 하나라도 막히면 전체를 거부한다. http는 모든 주소가 허용 대역이어야 한다
function verifyAddresses(
  policy: AddressPolicy,
  addresses: readonly ResolvedAddress[],
  scheme: 'https' | 'http',
): void {
  if (addresses.length === 0) throw new UpstreamError('unreachable');
  const verdicts = addresses.map(({ address }) => policy.check(address));
  if (verdicts.includes('blocked')) throw new UpstreamError('blocked_address');
  if (scheme === 'http' && verdicts.some((verdict) => verdict !== 'allowlisted')) {
    throw new UpstreamError('insecure_scheme');
  }
}

function pinnedLookup(
  policy: AddressPolicy,
  resolve: ResolveHost,
  scheme: 'https' | 'http',
): LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname).then(
      (addresses) => {
        try {
          verifyAddresses(policy, addresses, scheme);
        } catch (error) {
          callback(error as NodeJS.ErrnoException, '', 0);
          return;
        }
        if (options.all) {
          callback(null, addresses);
          return;
        }
        const [first] = addresses as [ResolvedAddress];
        callback(null, first.address, first.family);
      },
      () => callback(new UpstreamError('unreachable'), '', 0),
    );
  };
}

// undici는 연결 실패를 TypeError('fetch failed')로 감싸므로 cause를 따라가 찾는다
function findUpstreamError(error: unknown): UpstreamError | undefined {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    if (current instanceof UpstreamError) return current;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

function schemeOf(url: URL): 'https' | 'http' {
  if (url.protocol === 'https:') return 'https';
  if (url.protocol === 'http:') return 'http';
  throw new UpstreamError('insecure_scheme');
}

export function createUpstreamFetch(options: {
  allowCidrs: readonly string[];
  timeoutMs: number;
  resolve?: ResolveHost;
}): UpstreamFetch {
  const policy = createAddressPolicy(options.allowCidrs);
  const resolve = options.resolve ?? defaultResolve;
  const agentFor = (scheme: 'https' | 'http') =>
    new Agent({
      connect: { lookup: pinnedLookup(policy, resolve, scheme), timeout: options.timeoutMs },
      bodyTimeout: 0,
    });
  const agents = { https: agentFor('https'), http: agentFor('http') };

  return async (input, init = {}) => {
    const url = new URL(input);
    const scheme = schemeOf(url);
    // IP 리터럴은 lookup을 거치지 않고 바로 연결되므로 여기서 검사한다
    const literal = url.hostname.replace(/^\[|\]$/g, '');
    if (isIP(literal))
      verifyAddresses(policy, [{ address: literal, family: isIP(literal) }], scheme);

    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), options.timeoutMs);
    const signal = init.signal ? AbortSignal.any([init.signal, deadline.signal]) : deadline.signal;
    try {
      const response = (await undiciFetch(url, {
        ...(init as object),
        signal,
        redirect: 'manual',
        dispatcher: agents[scheme],
      })) as unknown as Response;
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel();
        throw new UpstreamError('redirect');
      }
      return response;
    } catch (error) {
      if (error instanceof UpstreamError) throw error;
      // 호출자(클라이언트 연결 종료)가 끊은 것은 그대로 올려 보낸다
      if (init.signal?.aborted) throw error;
      if (deadline.signal.aborted) throw new UpstreamError('timeout');
      throw findUpstreamError(error) ?? new UpstreamError('unreachable');
    } finally {
      clearTimeout(timer);
    }
  };
}

import { z } from 'zod';
import { HttpError } from '../http/errors.ts';

// 커넥터·엔드포인트 API가 함께 쓰는 입력 검증 (SCR-EP-02·03 필드 규칙)

export const displayName = z.string().trim().min(1).max(60);

// 다른 사람 것이든 형식이 틀렸든 404 하나로 답한다 (F-AUTH-05)
export function parseId(params: unknown): string {
  const parsed = z.object({ id: z.uuid() }).safeParse(params);
  if (!parsed.success) throw new HttpError('not_found');
  return parsed.data.id;
}

// RFC 9110 token. 프록시가 직접 다루는 헤더는 자격증명 헤더로 쓸 수 없다
const reservedHeaders = new Set([
  'host',
  'connection',
  'content-length',
  'content-type',
  'transfer-encoding',
  'accept',
  'cookie',
  'mcp-session-id',
  'mcp-protocol-version',
  'last-event-id',
]);

const headerName = z
  .string()
  .trim()
  .max(100)
  .regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]*$/)
  .refine((name) => !reservedHeaders.has(name.toLowerCase()))
  // 비우면 Authorization (SCR-EP-02 고급)
  .transform((name) => name || 'Authorization');

const tokenSettings = {
  header: headerName.default('Authorization'),
  prefix: z.string().max(100).default('Bearer '),
};

// https만. UPSTREAM_ALLOW_CIDRS를 지정한 설치에서만 http를 받고, 실제 허용 여부는 연결할 때 판정한다
export function remoteUrl(allowHttp: boolean) {
  return z
    .url()
    .max(2000)
    .refine((value) => {
      const url = new URL(value);
      if (url.username || url.password) return false;
      return url.protocol === 'https:' || (allowHttp && url.protocol === 'http:');
    });
}

export function remoteConnectorInput(allowHttp: boolean) {
  return z.object({
    name: displayName,
    url: remoteUrl(allowHttp),
    auth: z.discriminatedUnion('type', [
      z.object({ type: z.literal('none') }),
      z.object({
        type: z.literal('static_token'),
        token: z.string().min(1).max(8192),
        ...tokenSettings,
      }),
    ]),
  });
}

// 토큰을 생략하면 저장된 토큰을 그대로 쓴다
export function remoteConnectorPatch(allowHttp: boolean) {
  return z.object({
    name: displayName.optional(),
    url: remoteUrl(allowHttp).optional(),
    auth: z
      .discriminatedUnion('type', [
        z.object({ type: z.literal('none') }),
        z.object({
          type: z.literal('static_token'),
          token: z.string().min(1).max(8192).optional(),
          ...tokenSettings,
        }),
      ])
      .optional(),
  });
}

export const toolNameList = z.array(z.string().min(1).max(200)).min(1).max(1000);

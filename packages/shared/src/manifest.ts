import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { z } from 'zod';

// 커넥터 매니페스트: 관리자가 YAML로 가져오고 내보내는 커넥터 정의 (F-CON-07)

const envKey = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, '영문·숫자·_ 만 사용');

// 패키지는 고정 버전으로만 설치한다 (F-RUN-05). 범위 지정(^, ~, *)은 받지 않는다.
const pinnedVersion = z
  .string()
  .regex(/^\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$/, '정확한 버전만 허용 (예: 1.2.3)');

export const credentialScopeSchema = z.enum(['global', 'user']);
export type CredentialScope = z.infer<typeof credentialScopeSchema>;

export const credentialFieldSchema = z.object({
  key: envKey,
  label: z.string().min(1),
  secret: z.boolean().default(true),
  scope: credentialScopeSchema,
});
export type CredentialField = z.infer<typeof credentialFieldSchema>;

export const upstreamAuthSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('none') }),
  z.object({
    type: z.literal('static_token'),
    credential: envKey,
    header: z.string().default('Authorization'),
    prefix: z.string().default('Bearer '),
  }),
  // stdio: 자격증명 필드를 키 이름 그대로 환경변수로 넘긴다
  z.object({ type: z.literal('env') }),
  z.object({
    type: z.literal('oauth2'),
    authorizationUrl: z.url(),
    tokenUrl: z.url(),
    scopes: z.array(z.string()).min(1),
    clientIdCredential: envKey,
    clientSecretCredential: envKey,
  }),
  z.object({ type: z.literal('service_account'), credential: envKey }),
]);
export type UpstreamAuth = z.infer<typeof upstreamAuthSchema>;

const baseFields = {
  manifestVersion: z.literal(1),
  name: z.string().min(1),
  description: z.string().optional(),
  // 비어 있으면 로그인 허용된 모든 사용자에게 공개
  visibleGroups: z.array(z.string()).default([]),
  credentials: z.array(credentialFieldSchema).default([]),
  auth: upstreamAuthSchema,
};

export const connectorManifestSchema = z
  .discriminatedUnion('runtime', [
    z.object({ ...baseFields, runtime: z.literal('remote'), url: z.url() }),
    z.object({ ...baseFields, runtime: z.literal('builtin'), builtin: z.string().min(1) }),
    z.object({
      ...baseFields,
      runtime: z.literal('stdio'),
      package: z.object({
        registry: z.enum(['npm', 'pypi']),
        name: z.string().min(1),
        version: pinnedVersion,
      }),
      // 생략하면 패키지의 기본 실행 파일을 쓴다
      command: z.string().optional(),
      args: z.array(z.string()).default([]),
    }),
  ])
  .superRefine((manifest, ctx) => {
    const keys = new Set<string>();
    for (const field of manifest.credentials) {
      if (keys.has(field.key)) {
        ctx.addIssue({ code: 'custom', path: ['credentials'], message: `중복 키: ${field.key}` });
      }
      keys.add(field.key);
    }

    for (const key of referencedCredentials(manifest.auth)) {
      if (!keys.has(key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['auth'],
          message: `credentials에 없는 키를 참조: ${key}`,
        });
      }
    }

    const isStdio = manifest.runtime === 'stdio';
    if (isStdio && manifest.auth.type !== 'env' && manifest.auth.type !== 'none') {
      ctx.addIssue({ code: 'custom', path: ['auth'], message: 'stdio는 env 또는 none만 허용' });
    }
    if (!isStdio && manifest.auth.type === 'env') {
      ctx.addIssue({ code: 'custom', path: ['auth'], message: 'env 인증은 stdio 전용' });
    }
  });
export type ConnectorManifest = z.infer<typeof connectorManifestSchema>;

function referencedCredentials(auth: UpstreamAuth): string[] {
  switch (auth.type) {
    case 'static_token':
    case 'service_account':
      return [auth.credential];
    case 'oauth2':
      return [auth.clientIdCredential, auth.clientSecretCredential];
    default:
      return [];
  }
}

export function parseConnectorManifest(yamlText: string): ConnectorManifest {
  return connectorManifestSchema.parse(parseYaml(yamlText));
}

export function stringifyConnectorManifest(manifest: ConnectorManifest): string {
  return stringifyYaml(manifest);
}

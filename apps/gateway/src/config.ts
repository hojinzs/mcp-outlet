import { z } from 'zod';

const csv = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  );

// AES-256-GCM 키: base64로 인코딩한 32바이트
const aesKey = z
  .string()
  .refine((value) => Buffer.from(value, 'base64').length === 32, 'base64 인코딩된 32바이트 키');

const configSchema = z
  .object({
    HOST: z.string().default('0.0.0.0'),
    PORT: z.coerce.number().int().positive().default(3000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    // 리버스 프록시 뒤에서 외부에 보이는 주소. 보호 리소스 메타데이터에 쓴다
    PUBLIC_BASE_URL: z.url(),
    DATABASE_URL: z.string().startsWith('postgres'),

    OIDC_DISCOVERY_URL: z.url(),
    OIDC_CLIENT_ID: z.string().min(1),
    // Public client(PKCE)로 붙을 수 있으면 비워 둔다
    OIDC_CLIENT_SECRET: z.string().optional(),
    OIDC_GROUPS_CLAIM: z.string().default('groups'),
    // 비어 있으면 IdP 로그인에 성공한 모든 사용자를 허용
    OIDC_LOGIN_GROUPS: csv,
    OIDC_ADMIN_GROUPS: csv.pipe(z.array(z.string()).min(1, '관리자 그룹을 하나 이상 지정')),

    ENCRYPTION_KEY: aesKey,
    // 키 회전 중에만 지정. 복호화에만 쓰인다
    ENCRYPTION_KEY_PREVIOUS: aesKey.optional(),

    // stdio 런타임(v2)을 켤 때만 지정한다. 비우면 runner 없이 동작한다
    RUNNER_URL: z.url().optional(),
    RUNNER_TOKEN: z.string().min(32).optional(),

    // 관리 UI 빌드 결과. 지정하면 /admin 에서 서빙한다
    WEB_DIST_DIR: z.string().optional(),
  })
  .superRefine((config, ctx) => {
    if (config.RUNNER_URL && !config.RUNNER_TOKEN) {
      ctx.addIssue({
        code: 'custom',
        path: ['RUNNER_TOKEN'],
        message: 'RUNNER_URL을 지정하면 필요',
      });
    }
  });

export type Config = z.infer<typeof configSchema>;

// .env의 `KEY=` 처럼 빈 값은 지정하지 않은 것으로 본다
function withoutEmpty(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ''));
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = configSchema.safeParse(withoutEmpty(env));
  if (result.success) return result.data;

  // 값에 비밀이 섞여 있을 수 있으므로 키와 사유만 보여준다
  const lines = result.error.issues.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`);
  throw new Error(`환경변수 설정 오류\n${lines.join('\n')}`);
}

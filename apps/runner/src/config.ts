import { z } from 'zod';

// runner는 DB 주소와 암호화 키를 받지 않는다 (격리 요구사항)
const configSchema = z.object({
  RUNNER_HOST: z.string().default('0.0.0.0'),
  RUNNER_PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  RUNNER_TOKEN: z.string().min(32),
  // 커넥터 패키지 설치 볼륨
  RUNNER_DATA_DIR: z.string().default('/data'),
  RUNNER_IDLE_TIMEOUT_SEC: z.coerce.number().int().positive().default(600),
  RUNNER_MAX_PROCESSES: z.coerce.number().int().positive().default(20),
});

export type RunnerConfig = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RunnerConfig {
  // .env의 `KEY=` 처럼 빈 값은 지정하지 않은 것으로 본다
  const present = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ''));
  const result = configSchema.safeParse(present);
  if (result.success) return result.data;

  const lines = result.error.issues.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`);
  throw new Error(`환경변수 설정 오류\n${lines.join('\n')}`);
}

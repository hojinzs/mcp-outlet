import { z } from 'zod';

// gateway → runner 내부 API. runner는 DB·암호화 키를 모르므로
// 실행에 필요한 값(복호화된 환경변수 포함)은 모두 요청에 실려 온다.

export const RUNNER_TOKEN_HEADER = 'x-runner-token';

export const installRequestSchema = z.object({
  connectorId: z.uuid(),
  registry: z.enum(['npm', 'pypi']),
  name: z.string().min(1),
  version: z.string().min(1),
});
export type InstallRequest = z.infer<typeof installRequestSchema>;

export const spawnRequestSchema = z.object({
  connectorId: z.uuid(),
  // 자격증명 소유자. 전역 자격증명이면 null (F-RUN-03의 프로세스 키)
  ownerId: z.uuid().nullable(),
  command: z.string().optional(),
  args: z.array(z.string()),
  env: z.record(z.string(), z.string()),
});
export type SpawnRequest = z.infer<typeof spawnRequestSchema>;

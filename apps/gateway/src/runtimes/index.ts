import type { ConnectorManifest } from '@mcp-outlet/shared';
import { type BuiltinRuntimeDeps, createBuiltinRuntime } from './builtin.ts';
import { createRemoteRuntime, type RemoteRuntimeDeps } from './remote.ts';
import type { ConnectorRuntime } from './types.ts';

// v1 개인 커넥터의 런타임 (remote·builtin)
export type Runtimes = Partial<Record<ConnectorManifest['runtime'], ConnectorRuntime>>;

// 원격 커넥터만 다루는 테스트는 builtin을 생략한다
export function createRuntimes(deps: {
  remote: RemoteRuntimeDeps;
  builtin?: BuiltinRuntimeDeps;
}): Runtimes {
  return {
    remote: createRemoteRuntime(deps.remote),
    ...(deps.builtin ? { builtin: createBuiltinRuntime(deps.builtin) } : {}),
  };
}

export function runtimeFor(runtimes: Runtimes, manifest: ConnectorManifest): ConnectorRuntime {
  const runtime = runtimes[manifest.runtime];
  if (!runtime) throw new Error(`runtime not available: ${manifest.runtime}`);
  return runtime;
}

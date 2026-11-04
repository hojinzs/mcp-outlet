import type { ConnectorManifest } from '@mcp-outlet/shared';
import { createRemoteRuntime, type RemoteRuntimeDeps } from './remote.ts';
import type { ConnectorRuntime } from './types.ts';

// v1 개인 커넥터의 런타임. builtin은 같은 인터페이스로 여기에 더한다
export type Runtimes = Partial<Record<ConnectorManifest['runtime'], ConnectorRuntime>>;

export function createRuntimes(deps: RemoteRuntimeDeps): Runtimes {
  return { remote: createRemoteRuntime(deps) };
}

export function runtimeFor(runtimes: Runtimes, manifest: ConnectorManifest): ConnectorRuntime {
  const runtime = runtimes[manifest.runtime];
  if (!runtime) throw new Error(`runtime not available: ${manifest.runtime}`);
  return runtime;
}

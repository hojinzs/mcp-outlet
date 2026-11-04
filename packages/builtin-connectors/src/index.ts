import type { BuiltinConnector } from './types.ts';

export type { BuiltinCallContext, BuiltinConnector } from './types.ts';

// 구현이 추가되면 여기에 등록한다 (ga4, channeltalk 예정)
const connectors: BuiltinConnector[] = [];

export const builtinConnectors: ReadonlyMap<string, BuiltinConnector> = new Map(
  connectors.map((connector) => [connector.key, connector]),
);

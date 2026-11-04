import { googleAnalytics } from './google/index.ts';
import type { BuiltinConnector } from './types.ts';

export { BuiltinApiError, type BuiltinErrorKind } from './errors.ts';
export type {
  BuiltinAuthMethod,
  BuiltinCallContext,
  BuiltinConnector,
  BuiltinOAuth2,
  BuiltinServiceAccount,
  ServiceAccountKey,
} from './types.ts';

// 구현이 추가되면 여기에 등록한다 (channeltalk 예정)
const connectors: BuiltinConnector[] = [googleAnalytics];

export const builtinConnectors: ReadonlyMap<string, BuiltinConnector> = new Map(
  connectors.map((connector) => [connector.key, connector]),
);

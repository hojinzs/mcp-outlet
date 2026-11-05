import {
  errorResponse,
  idKey,
  isRequest,
  isResponse,
  type JsonRpcResponse,
  RPC_ERROR,
} from './jsonrpc.ts';
import { MAX_TOOL_NAME_LENGTH } from './limits.ts';

// 엔드포인트 허용목록 적용 (F-EP-02): 목록 밖 tools/call은 업스트림에 보내지 않고,
// tools/list 응답에서는 목록 밖 툴을 뺀다. 런타임과 상관없이 메시지 단위로 동작한다.
// tools/list 응답은 요청 id가 아니라 결과 모양(result.tools 배열)으로 알아본다. GET 스트림 재개
// (Last-Event-ID)로 다시 오는 응답은 이 요청에서 보낸 id와 짝지을 수 없어서다.
// 리소스·프롬프트는 툴만 고른 엔드포인트의 허용목록을 우회하므로 막는다: 요청은 거부하고,
// initialize 응답 capabilities와 업스트림 알림에서도 뺀다 (F-EP-02 리소스·프롬프트 차단)

// completion/complete는 프롬프트 인자·리소스 템플릿 자동완성이라 함께 막는다
const BLOCKED_METHOD = /^(resources|prompts)\/|^completion\/complete$/;
const BLOCKED_NOTIFICATION = /^notifications\/(resources|prompts)\//;
const BLOCKED_CAPABILITIES = ['resources', 'prompts', 'completions'];

function methodOf(message: unknown): unknown {
  return (message as { method?: unknown } | null)?.method;
}

// id가 없는 것(알림)도 막는다
function isBlockedMethod(message: unknown): boolean {
  const method = methodOf(message);
  return typeof method === 'string' && BLOCKED_METHOD.test(method);
}

export type ToolCallOutcome = 'ok' | 'error';

export type InboundPlan =
  | {
      kind: 'deny';
      deniedTools: string[];
      // 배치면 배열. 응답할 요청이 없으면 null
      response: JsonRpcResponse | JsonRpcResponse[] | null;
    }
  | {
      kind: 'forward';
      // tools/call 요청 id → 툴 이름
      toolCalls: Map<string, string>;
      // 커서 없이 보낸(첫 페이지부터의) tools/list 요청 id. 툴 캐시 갱신에 쓴다
      toolLists: Set<string>;
    };

function toolNameOf(message: Record<string, unknown>): string {
  const params = message.params as Record<string, unknown> | undefined;
  return typeof params?.name === 'string' ? params.name : '';
}

// id가 없는 tools/call(알림)도 허용목록을 거친다
function isToolCall(message: unknown): message is Record<string, unknown> {
  return (message as { method?: unknown } | null)?.method === 'tools/call';
}

// 요청에 담긴 tools/call의 툴 이름. 배치면 모두
export function toolCallNames(body: unknown): string[] {
  return (Array.isArray(body) ? body : [body]).filter(isToolCall).map(toolNameOf);
}

// 거부한 요청 하나에서 감사 로그로 남기는 툴 호출 수 상한. 배치에 툴 호출을 잔뜩 넣어
// 감사 로그를 부풀리지 못하게 한다. 업스트림에 가지 않은 호출이라 일부만 남겨도 추적에 충분하다
export const MAX_DENIED_AUDIT_ROWS = 20;

// 감사 로그에 남길 거부된 툴 이름. 클라이언트가 보낸 값이라 개수와 길이를 자른다 (F-UI-03)
export function deniedAuditNames(names: readonly string[]): string[] {
  return names.slice(0, MAX_DENIED_AUDIT_ROWS).map(auditToolName);
}

// 허용목록 판정에는 쓰지 않는다. 자른 이름이 허용한 툴과 겹칠 수 있어서다
export function auditToolName(name: string): string {
  const cut = name.slice(0, MAX_TOOL_NAME_LENGTH);
  // 서로게이트 쌍 가운데서 잘리면 깨진 글자가 남는다
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
}

// 메시지 하나를 거부하는 이유. 거부하지 않으면 null
function denialOf(
  message: unknown,
  allowed: ReadonlySet<string>,
): { code: number; message: string } | null {
  if (isToolCall(message) && !allowed.has(toolNameOf(message))) {
    return {
      code: RPC_ERROR.invalidParams,
      // 클라이언트가 보낸 이름을 되돌려 주므로 감사 로그와 같은 길이로 자른다
      message: `허용되지 않은 툴입니다: ${auditToolName(toolNameOf(message))}`,
    };
  }
  if (isBlockedMethod(message)) {
    return {
      code: RPC_ERROR.methodNotFound,
      message: '이 엔드포인트는 리소스와 프롬프트를 제공하지 않습니다.',
    };
  }
  return null;
}

// 배치에 허용되지 않은 호출이 하나라도 있으면 배치 전체를 보내지 않는다.
// 일부만 보내면 업스트림 응답 스트림에 거부 응답을 끼워 넣어야 해서다
export function planInbound(body: unknown, allowedTools: readonly string[]): InboundPlan {
  const allowed = new Set(allowedTools);
  const messages = Array.isArray(body) ? body : [body];

  if (messages.some((message) => denialOf(message, allowed) !== null)) {
    const deniedTools = messages
      .filter(isToolCall)
      .map(toolNameOf)
      .filter((name) => !allowed.has(name));
    const responses = messages.filter(isRequest).map((message) => {
      const denial = denialOf(message, allowed);
      return denial
        ? errorResponse(message.id, denial.code, denial.message)
        : errorResponse(
            message.id,
            RPC_ERROR.invalidRequest,
            '같은 배치에 허용되지 않은 요청이 있어 처리하지 않았습니다.',
          );
    });
    const response = Array.isArray(body) ? responses : (responses[0] ?? null);
    return { kind: 'deny', deniedTools, response: responses.length > 0 ? response : null };
  }

  const toolCalls = new Map<string, string>();
  const toolLists = new Set<string>();
  for (const message of messages.filter(isRequest)) {
    if (message.method === 'tools/call') toolCalls.set(idKey(message.id), toolNameOf(message));
    if (message.method === 'tools/list' && message.params?.cursor === undefined) {
      toolLists.add(idKey(message.id));
    }
  }
  return { kind: 'forward', toolCalls, toolLists };
}

function filterToolsList(result: unknown, allowed: ReadonlySet<string>): unknown {
  const tools = (result as { tools?: unknown } | null | undefined)?.tools;
  if (!Array.isArray(tools)) return result;
  return {
    ...(result as object),
    tools: tools.filter((tool) => allowed.has((tool as { name?: unknown })?.name as string)),
  };
}

// initialize 응답은 결과 모양(protocolVersion과 capabilities)으로 알아본다. tools/list와 같은 이유다
function stripCapabilities(result: unknown): unknown {
  const { protocolVersion, capabilities } = (result ?? {}) as Record<string, unknown>;
  if (typeof protocolVersion !== 'string' || typeof capabilities !== 'object' || !capabilities) {
    return result;
  }
  const kept = Object.fromEntries(
    Object.entries(capabilities).filter(([key]) => !BLOCKED_CAPABILITIES.includes(key)),
  );
  return { ...(result as object), capabilities: kept };
}

function isBlockedNotification(message: unknown): boolean {
  const method = methodOf(message);
  return typeof method === 'string' && BLOCKED_NOTIFICATION.test(method);
}

// 업스트림 응답 메시지를 고쳐 쓰고 tools/call 결과와 거르기 전 tools/list 결과를 알린다. 클라이언트에 보내지 않을 메시지는
// undefined로 돌려준다(배치면 빼고, 남는 것이 없으면 undefined).
// 응답이 오기 전에 스트림이 끝나면 settle()이 남은 호출을 오류로 알린다
export function createResponseTap(
  plan: Extract<InboundPlan, { kind: 'forward' }>,
  allowedTools: readonly string[],
  onToolCall: (toolName: string, outcome: ToolCallOutcome) => void,
  onToolsList: (result: unknown) => void = () => {},
) {
  const allowed = new Set(allowedTools);
  const pending = new Map(plan.toolCalls);
  const pendingLists = new Set(plan.toolLists);

  function rewriteOne(message: unknown): unknown {
    if (isBlockedNotification(message)) return undefined;
    if (!isResponse(message)) return message;
    const key = idKey(message.id);
    const toolName = pending.get(key);
    if (toolName !== undefined) {
      pending.delete(key);
      const isError =
        message.error !== undefined || (message.result as { isError?: unknown })?.isError === true;
      onToolCall(toolName, isError ? 'error' : 'ok');
    }
    if (message.result === undefined) return message;
    // 커서 없이 요청한 이 요청의 tools/list 응답만 알린다. 커서로 받은 마지막 페이지는 nextCursor가
    // 없어도 목록 일부이고, 재개 스트림으로 온 응답은 어떤 요청의 응답인지 알 수 없다
    if (pendingLists.delete(key)) onToolsList(message.result);
    return { ...message, result: stripCapabilities(filterToolsList(message.result, allowed)) };
  }

  return {
    rewrite(message: unknown): unknown {
      if (!Array.isArray(message)) return rewriteOne(message);
      const kept = message.map(rewriteOne).filter((item) => item !== undefined);
      return kept.length > 0 ? kept : undefined;
    },
    settle(): void {
      for (const toolName of pending.values()) onToolCall(toolName, 'error');
      pending.clear();
    },
  };
}

export type ResponseTap = ReturnType<typeof createResponseTap>;

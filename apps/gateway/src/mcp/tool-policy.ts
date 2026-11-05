import {
  errorResponse,
  idKey,
  isRequest,
  isResponse,
  type JsonRpcResponse,
  RPC_ERROR,
} from './jsonrpc.ts';

// 엔드포인트 허용목록 적용 (F-EP-02): 목록 밖 tools/call은 업스트림에 보내지 않고,
// tools/list 응답에서는 목록 밖 툴을 뺀다. 런타임과 상관없이 메시지 단위로 동작한다

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
      // tools/list 요청 id와 tools/call 요청 id → 툴 이름
      toolLists: Set<string>;
      toolCalls: Map<string, string>;
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

// 배치에 허용되지 않은 호출이 하나라도 있으면 배치 전체를 보내지 않는다.
// 일부만 보내면 업스트림 응답 스트림에 거부 응답을 끼워 넣어야 해서다
export function planInbound(body: unknown, allowedTools: readonly string[]): InboundPlan {
  const allowed = new Set(allowedTools);
  const messages = Array.isArray(body) ? body : [body];
  const deniedTools = messages
    .filter(isToolCall)
    .map(toolNameOf)
    .filter((name) => !allowed.has(name));

  if (deniedTools.length > 0) {
    const responses = messages.filter(isRequest).map((message) => {
      const denied = message.method === 'tools/call' && !allowed.has(toolNameOf(message));
      return denied
        ? errorResponse(
            message.id,
            RPC_ERROR.invalidParams,
            `허용되지 않은 툴입니다: ${toolNameOf(message)}`,
          )
        : errorResponse(
            message.id,
            RPC_ERROR.invalidRequest,
            '같은 배치에 허용되지 않은 툴 호출이 있어 처리하지 않았습니다.',
          );
    });
    const response = Array.isArray(body) ? responses : (responses[0] ?? null);
    return { kind: 'deny', deniedTools, response: responses.length > 0 ? response : null };
  }

  const toolLists = new Set<string>();
  const toolCalls = new Map<string, string>();
  for (const message of messages.filter(isRequest)) {
    if (message.method === 'tools/list') toolLists.add(idKey(message.id));
    if (message.method === 'tools/call') toolCalls.set(idKey(message.id), toolNameOf(message));
  }
  return { kind: 'forward', toolLists, toolCalls };
}

function filterToolsList(result: unknown, allowed: ReadonlySet<string>): unknown {
  const tools = (result as { tools?: unknown } | undefined)?.tools;
  if (!Array.isArray(tools)) return result;
  return {
    ...(result as object),
    tools: tools.filter((tool) => allowed.has((tool as { name?: unknown })?.name as string)),
  };
}

// 업스트림 응답 메시지를 고쳐 쓰고 tools/call 결과를 알린다.
// 응답이 오기 전에 스트림이 끝나면 settle()이 남은 호출을 오류로 알린다
export function createResponseTap(
  plan: Extract<InboundPlan, { kind: 'forward' }>,
  allowedTools: readonly string[],
  onToolCall: (toolName: string, outcome: ToolCallOutcome) => void,
) {
  const allowed = new Set(allowedTools);
  const pending = new Map(plan.toolCalls);

  function rewriteOne(message: unknown): unknown {
    if (!isResponse(message)) return message;
    const key = idKey(message.id);
    const toolName = pending.get(key);
    if (toolName !== undefined) {
      pending.delete(key);
      const isError =
        message.error !== undefined || (message.result as { isError?: unknown })?.isError === true;
      onToolCall(toolName, isError ? 'error' : 'ok');
    }
    if (plan.toolLists.has(key) && message.result !== undefined) {
      return { ...message, result: filterToolsList(message.result, allowed) };
    }
    return message;
  }

  return {
    rewrite(message: unknown): unknown {
      return Array.isArray(message) ? message.map(rewriteOne) : rewriteOne(message);
    },
    settle(): void {
      for (const toolName of pending.values()) onToolCall(toolName, 'error');
      pending.clear();
    },
  };
}

export type ResponseTap = ReturnType<typeof createResponseTap>;

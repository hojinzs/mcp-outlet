import { BuiltinApiError, type BuiltinErrorKind } from '../errors.ts';
import type { BuiltinCallContext } from '../types.ts';

// Google REST API 호출. SDK(googleapis) 없이 fetch로 직접 부르고, 실패는 분류값으로 바꾼다

// 인자 오류 설명은 모델이 읽을 만큼만 넘긴다
const HINT_MAX_LENGTH = 300;

function kindOfStatus(status: number): BuiltinErrorKind {
  if (status === 400) return 'invalid_argument';
  if (status === 401) return 'auth_failed';
  if (status === 403) return 'permission_denied';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  return 'upstream_error';
}

// Google 오류 본문 { error: { message } }에서 인자 오류 설명만 꺼낸다
async function invalidArgumentHint(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.json()) as { error?: { message?: unknown } };
    const message = body.error?.message;
    return typeof message === 'string' ? message.slice(0, HINT_MAX_LENGTH) : undefined;
  } catch {
    return undefined;
  }
}

function transportError(error: unknown): BuiltinApiError {
  const name = (error as Error)?.name;
  return new BuiltinApiError(name === 'TimeoutError' ? 'timeout' : 'unreachable');
}

export async function googleApi<T>(
  ctx: BuiltinCallContext,
  url: string,
  body?: unknown,
): Promise<T> {
  let response: Response;
  try {
    response = await ctx.fetch(url, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        authorization: `Bearer ${ctx.accessToken}`,
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'error',
      signal: ctx.signal,
    });
  } catch (error) {
    throw transportError(error);
  }
  if (!response.ok) {
    const kind = kindOfStatus(response.status);
    if (kind === 'invalid_argument') {
      throw new BuiltinApiError(kind, await invalidArgumentHint(response));
    }
    await response.body?.cancel().catch(() => {});
    throw new BuiltinApiError(kind);
  }
  try {
    return (await response.json()) as T;
  } catch (error) {
    if ((error as Error)?.name === 'TimeoutError') throw transportError(error);
    throw new BuiltinApiError('upstream_error');
  }
}

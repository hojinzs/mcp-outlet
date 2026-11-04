// gateway 관리 API 호출. 오류는 { error: { code, message, details? }, requestId } 모양이다 (SCR-COM-04)

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | undefined;
  readonly details: Record<string, unknown> | undefined;

  constructor(
    status: number,
    body: { code?: string; message?: string; details?: Record<string, unknown> },
    requestId?: string,
  ) {
    super(body.message ?? '요청을 처리하지 못했습니다.');
    this.name = 'ApiError';
    this.status = status;
    this.code = body.code ?? 'internal_error';
    this.requestId = requestId;
    this.details = body.details;
  }
}

// gateway에 닿지 않음 (네트워크 오류, 응답 없음)
export class NetworkError extends Error {
  constructor() {
    super('서버에 연결할 수 없습니다.');
    this.name = 'NetworkError';
  }
}

type RequestOptions = { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown };

async function errorFrom(response: Response): Promise<ApiError> {
  try {
    const body = (await response.json()) as {
      error?: { code?: string; message?: string; details?: Record<string, unknown> };
      requestId?: string;
    };
    return new ApiError(response.status, body.error ?? {}, body.requestId);
  } catch {
    return new ApiError(response.status, {});
  }
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body } = options;
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new NetworkError();
  }
  if (!response.ok) throw await errorFrom(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function isApiError(error: unknown, status?: number): error is ApiError {
  return error instanceof ApiError && (status === undefined || error.status === status);
}

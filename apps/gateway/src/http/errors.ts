import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { ServiceError } from '../services/errors.ts';

// 모든 API 오류 응답은 { error: { code, message }, requestId } 모양이다 (SCR-COM-04).
// message에는 사용자에게 보여줘도 되는 고정 문구만 담는다.
// details는 화면이 분류별 문구를 고를 때만 쓴다(예: 연결 테스트 실패 분류)
export type ErrorBody = {
  error: { code: string; message: string; details?: Record<string, unknown> };
  requestId: string;
};

const messages = {
  invalid_request: '요청 값이 올바르지 않습니다.',
  unauthorized: '로그인이 필요합니다.',
  forbidden: '권한이 없습니다.',
  not_found: '찾을 수 없습니다.',
  limit_exceeded: '만들 수 있는 개수의 상한에 도달했습니다.',
  tools_changed: '커넥터의 툴 목록이 바뀌었습니다. 툴 목록을 다시 불러오세요.',
  connection_test_failed: '연결 테스트에 실패했습니다.',
  connector_disabled: '관리자가 사용 중지한 커넥터입니다.',
  connector_not_ready:
    '연결 테스트를 통과하지 않은 커넥터입니다. 다시 연결하거나 연결 테스트를 하세요.',
  internal_error: '요청을 처리하지 못했습니다.',
} as const;

export type ErrorCode = keyof typeof messages;

const statusOf: Record<ErrorCode, number> = {
  invalid_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  limit_exceeded: 409,
  tools_changed: 409,
  connection_test_failed: 422,
  connector_disabled: 409,
  connector_not_ready: 409,
  internal_error: 500,
};

export class HttpError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;

  constructor(code: ErrorCode) {
    super(messages[code]);
    this.name = 'HttpError';
    this.code = code;
    this.statusCode = statusOf[code];
  }
}

export function sendError(
  reply: FastifyReply,
  code: ErrorCode,
  details?: Record<string, unknown>,
): FastifyReply {
  const body: ErrorBody = {
    error: { code, message: messages[code], ...(details ? { details } : {}) },
    requestId: reply.request.id,
  };
  return reply.code(statusOf[code]).send(body);
}

function classify(error: FastifyError | Error): ErrorCode {
  if (error instanceof HttpError) return error.code;
  if (error instanceof ServiceError) return error.code;
  if (error instanceof ZodError) return 'invalid_request';
  // Fastify가 만든 4xx (본문 파싱 실패, 스키마 검증 실패 등)
  const status = (error as FastifyError).statusCode;
  if (status === 404) return 'not_found';
  if (status !== undefined && status >= 400 && status < 500) return 'invalid_request';
  return 'internal_error';
}

export function registerErrorHandlers(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    const code = classify(error);
    // 원문 메시지·스택에는 토큰이나 요청 본문이 섞일 수 있어 종류만 남긴다
    if (code === 'internal_error') {
      request.log.error({ errName: error.name, errCode: error.code }, 'unhandled error');
    }
    return sendError(reply, code, error instanceof ServiceError ? error.details : undefined);
  });
}

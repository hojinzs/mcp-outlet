import { describe, expect, it } from 'vitest';
import { ApiError } from '../../api/client.ts';
import type { Builtin, Connector } from '../../api/types.ts';
import {
  builtinErrorText,
  builtinGuide,
  builtinNameOf,
  checkServiceAccountKey,
  connectOutcome,
  connectorTestMessage,
  endpointReturnTo,
  isPickable,
  newEndpointReturnTo,
  oauthMethodOf,
  unpickableGuide,
  withoutConnectOutcome,
} from './builtin.ts';

const privateKey = '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n';
const keyJson = JSON.stringify({
  type: 'service_account',
  client_email: 'outlet@project.iam.gserviceaccount.com',
  private_key: privateKey,
});

const ga: Builtin = {
  key: 'google-analytics',
  name: 'Google Analytics 4 + Search Console',
  description: '',
  toolCount: 5,
  authMethods: [
    { type: 'service_account' },
    {
      type: 'oauth2',
      provider: 'Google',
      redirectUri: 'https://outlet.test/auth/upstream/callback',
    },
  ],
};

describe('서비스 계정 키', () => {
  it('client_email만 꺼내고 private key는 돌려주지 않는다', () => {
    const result = checkServiceAccountKey(keyJson);
    expect(result).toEqual({ status: 'ok', clientEmail: 'outlet@project.iam.gserviceaccount.com' });
    expect(JSON.stringify(result)).not.toContain('PRIVATE KEY');
  });

  it('비었거나 JSON이 아니거나 서비스 계정 키가 아니면 문제를 알려준다', () => {
    expect(checkServiceAccountKey('  ').status).toBe('empty');
    expect(checkServiceAccountKey('{').status).toBe('invalid');
    expect(checkServiceAccountKey('"text"').status).toBe('invalid');
    // OAuth 클라이언트 JSON을 잘못 넣은 경우
    expect(checkServiceAccountKey(JSON.stringify({ web: { client_id: 'x' } })).status).toBe(
      'invalid',
    );
    const noKey = JSON.stringify({ type: 'service_account', client_email: 'a@b.test' });
    expect(checkServiceAccountKey(noKey)).toEqual({
      status: 'invalid',
      problem: '키에 private_key가 없습니다',
    });
  });

  it('문제 문구에 키 내용을 담지 않는다', () => {
    const result = checkServiceAccountKey(
      JSON.stringify({ type: 'service_account', private_key: privateKey }),
    );
    expect(JSON.stringify(result)).not.toContain('PRIVATE KEY');
  });
});

describe('연결 테스트 문구', () => {
  it('내장 서비스는 인증 실패·권한 없음 문구를 바꾼다', () => {
    expect(connectorTestMessage('builtin', 'auth_failed')).toContain('Google이 자격증명을 거부');
    expect(connectorTestMessage('builtin', 'permission_denied')).toContain('권한');
    expect(connectorTestMessage('remote', 'auth_failed')).toBe(
      '서버가 토큰을 거부했습니다. 토큰과 헤더 설정을 확인하세요',
    );
  });

  it('내장 전용 표에 없는 분류는 공통 문구, 모르는 분류는 기본 문구', () => {
    expect(connectorTestMessage('builtin', 'timeout')).toBe(
      '커넥터 응답이 너무 늦습니다. 잠시 후 다시 시도하세요',
    );
    expect(connectorTestMessage('builtin', 'upstream_error')).toContain('잠시 후');
    expect(connectorTestMessage('builtin', 'weird')).toContain('연결 테스트에 실패');
  });
});

describe('계정 연결 복귀', () => {
  it('connected·connect_error를 해석한다', () => {
    expect(connectOutcome(new URLSearchParams('connector=c1&connected=1'))).toBe('connected');
    expect(connectOutcome(new URLSearchParams('connect_error=cancelled'))).toBe('cancelled');
    expect(connectOutcome(new URLSearchParams('connect_error=failed'))).toBe('failed');
    expect(connectOutcome(new URLSearchParams('connect_error=test_failed'))).toBe('test_failed');
    expect(connectOutcome(new URLSearchParams('connect_error=other'))).toBe('failed');
    expect(connectOutcome(new URLSearchParams('connector=c1'))).toBeNull();
  });

  it('결과 쿼리만 지우고 connector는 남긴다', () => {
    const next = withoutConnectOutcome(new URLSearchParams('connector=c1&connected=1'));
    expect(next.toString()).toBe('connector=c1');
    expect(withoutConnectOutcome(new URLSearchParams('connect_error=failed')).toString()).toBe('');
  });

  it('돌아올 경로는 /admin/ 으로 시작한다', () => {
    expect(newEndpointReturnTo('c1')).toBe('/admin/endpoints/new?connector=c1');
    expect(endpointReturnTo('e1')).toBe('/admin/endpoints/e1');
  });
});

describe('내장 서비스 목록', () => {
  it('key로 서비스 이름과 OAuth 방식을 찾는다', () => {
    expect(builtinNameOf([ga], 'google-analytics')).toBe('Google Analytics 4 + Search Console');
    expect(builtinNameOf([ga], null)).toBeNull();
    expect(builtinNameOf(undefined, 'google-analytics')).toBeNull();
    expect(oauthMethodOf(ga)?.provider).toBe('Google');
    expect(oauthMethodOf({ ...ga, authMethods: [{ type: 'service_account' }] })).toBeUndefined();
  });

  it('모르는 서비스는 일반 안내를 쓴다', () => {
    expect(builtinGuide('google-analytics').serviceAccount).toContain('GA4 속성');
    expect(builtinGuide('unknown').serviceAccount).not.toContain('GA4');
  });

  it('정상 커넥터만 고를 수 있다', () => {
    const connector = { disabledAt: null, status: 'ok' } as Connector;
    expect(isPickable(connector)).toBe(true);
    expect(isPickable({ ...connector, status: 'pending' })).toBe(false);
    expect(isPickable({ ...connector, status: 'error' })).toBe(false);
    expect(isPickable({ ...connector, status: 'reauth_required' })).toBe(false);
    expect(isPickable({ ...connector, disabledAt: '2026-11-01T00:00:00Z' })).toBe(false);
  });

  it('고를 수 없는 커넥터는 사유와 고칠 곳을 준다', () => {
    const connector = { id: 'c1', disabledAt: null, status: 'ok' } as Connector;
    const endpointIds = new Map([['c1', 'e1']]);
    expect(unpickableGuide(connector, endpointIds)).toBeNull();
    expect(unpickableGuide({ ...connector, status: 'error' }, endpointIds)?.link).toEqual({
      to: '/endpoints/e1',
      label: '상세에서 다시 테스트',
    });
    expect(unpickableGuide({ ...connector, status: 'reauth_required' }, endpointIds)?.link).toEqual(
      {
        to: '/endpoints/e1',
        label: '상세에서 다시 연결',
      },
    );
    // 엔드포인트가 없으면 목록의 "엔드포인트 없는 커넥터"로
    expect(
      unpickableGuide({ ...connector, id: 'c2', status: 'pending' }, endpointIds)?.link?.to,
    ).toBe('/');
    // 엔드포인트 목록을 받기 전에는 링크를 그리지 않는다
    expect(unpickableGuide({ ...connector, status: 'error' }, undefined)).toEqual({
      reason: expect.any(String),
      link: null,
    });
    // 관리자 사용 중지는 사용자가 고칠 수 없다
    expect(
      unpickableGuide({ ...connector, disabledAt: '2026-11-01T00:00:00Z' }, endpointIds)?.link,
    ).toBeNull();
  });
});

describe('저장·계정 연결 실패 문구', () => {
  it('분류값과 필드로만 문구를 고른다', () => {
    const failed = new ApiError(422, {
      code: 'connection_test_failed',
      details: { result: 'auth_failed' },
    });
    expect(builtinErrorText(failed)).toContain('Google이 자격증명을 거부');
    expect(
      builtinErrorText(new ApiError(400, { code: 'invalid_request', details: { field: 'key' } })),
    ).toBe('서비스 계정 JSON 키 형식이 맞지 않습니다');
    expect(
      builtinErrorText(
        new ApiError(400, { code: 'invalid_request', details: { field: 'clientId' } }),
      ),
    ).toBe('Client ID와 Client Secret을 넣으세요');
  });
});

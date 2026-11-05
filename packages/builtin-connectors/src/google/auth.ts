import { z } from 'zod';
import type { BuiltinOAuth2, BuiltinServiceAccount, ServiceAccountKey } from '../types.ts';

// Google 계정 연결: 사용자 OAuth 앱과 서비스 계정 키. GA4·Search Console 툴이 함께 쓴다

const TOKEN_URL = 'https://oauth2.googleapis.com/token';

export function googleOAuth2(scopes: readonly string[]): BuiltinOAuth2 {
  return {
    type: 'oauth2',
    provider: 'Google',
    authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: TOKEN_URL,
    // 연결된 계정 이메일을 화면에 보여주려고 openid email을 함께 받는다
    scopes: ['openid', 'email', ...scopes],
    // offline + consent: 다시 연결할 때도 refresh token을 새로 받는다.
    // select_account: 브라우저의 Google 세션과 상관없이 계정을 고르게 한다 (SCR-EP-03 다른 계정으로 바꾸기)
    authorizationParams: { access_type: 'offline', prompt: 'consent select_account' },
  };
}

const serviceAccountKeySchema = z.object({
  type: z.literal('service_account'),
  client_email: z.email(),
  private_key: z.string().includes('PRIVATE KEY'),
});

function parseServiceAccountKey(json: string): ServiceAccountKey | null {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return null;
  }
  const parsed = serviceAccountKeySchema.safeParse(value);
  if (!parsed.success) return null;
  return { clientEmail: parsed.data.client_email, privateKey: parsed.data.private_key };
}

export function googleServiceAccount(scopes: readonly string[]): BuiltinServiceAccount {
  return { type: 'service_account', tokenUrl: TOKEN_URL, scopes, parseKey: parseServiceAccountKey };
}

import { describe, expect, it } from 'vitest';
import { parseConnectorManifest } from './manifest.ts';

describe('parseConnectorManifest', () => {
  it('remote + static_token 매니페스트를 기본값과 함께 읽는다', () => {
    const manifest = parseConnectorManifest(`
manifestVersion: 1
name: CMS
runtime: remote
url: https://cms.example.com/mcp
credentials:
  - { key: CMS_TOKEN, label: CMS 토큰, scope: global }
auth: { type: static_token, credential: CMS_TOKEN }
`);
    expect(manifest.runtime).toBe('remote');
    expect(manifest.auth).toMatchObject({ header: 'Authorization', prefix: 'Bearer ' });
    expect(manifest.credentials[0]?.secret).toBe(true);
  });

  it('없는 자격증명 키를 참조하면 거부한다', () => {
    expect(() =>
      parseConnectorManifest(`
manifestVersion: 1
name: CMS
runtime: remote
url: https://cms.example.com/mcp
auth: { type: static_token, credential: MISSING }
`),
    ).toThrow(/MISSING/);
  });

  it('stdio 패키지는 고정 버전만 받는다', () => {
    expect(() =>
      parseConnectorManifest(`
manifestVersion: 1
name: Everything
runtime: stdio
package: { registry: npm, name: "@modelcontextprotocol/server-everything", version: "^2.1.0" }
auth: { type: none }
`),
    ).toThrow(/정확한 버전/);
  });

  it('remote에 env 인증을 쓰면 거부한다', () => {
    expect(() =>
      parseConnectorManifest(`
manifestVersion: 1
name: CMS
runtime: remote
url: https://cms.example.com/mcp
auth: { type: env }
`),
    ).toThrow(/stdio 전용/);
  });
});

import { describe, expect, it } from 'vitest';
import { suggestEndpointName } from './naming.ts';

describe('엔드포인트 이름 제안', () => {
  it('겹치지 않으면 그대로, 겹치면 다음 숫자', () => {
    expect(suggestEndpointName('Home CMS', [])).toBe('Home CMS');
    expect(suggestEndpointName('Home CMS', ['Home CMS'])).toBe('Home CMS 2');
    expect(suggestEndpointName('Home CMS', ['Home CMS', 'Home CMS 2'])).toBe('Home CMS 3');
  });

  it('60자를 넘지 않는다', () => {
    const long = 'a'.repeat(60);
    const suggested = suggestEndpointName(long, [long]);
    expect(suggested).toHaveLength(60);
    expect(suggested.endsWith(' 2')).toBe(true);
  });
});

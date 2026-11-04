import { describe, expect, it } from 'vitest';
import { createAddressPolicy } from './address-policy.ts';

describe('createAddressPolicy', () => {
  const policy = createAddressPolicy([]);

  it.each([
    ['10.1.2.3', '사설 10/8'],
    ['172.20.0.1', '사설 172.16/12'],
    ['192.168.0.10', '사설 192.168/16'],
    ['127.0.0.1', 'loopback'],
    ['169.254.169.254', '클라우드 메타데이터'],
    ['169.254.10.1', 'link-local'],
    ['100.64.0.1', 'CGNAT'],
    ['0.0.0.0', '미지정'],
    ['224.0.0.1', '멀티캐스트'],
    ['255.255.255.255', '브로드캐스트'],
    ['::1', 'IPv6 loopback'],
    ['::', 'IPv6 미지정'],
    ['fd00::1', 'ULA fd00::/8'],
    ['fc00::1', 'ULA fc00::/7'],
    ['fe80::1', 'IPv6 link-local'],
    ['::ffff:127.0.0.1', 'IPv4-mapped loopback'],
    ['::ffff:a9fe:a9fe', 'IPv4-mapped 메타데이터(hex)'],
    ['64:ff9b::a00:1', 'NAT64'],
    ['2002:a00:1::', '6to4'],
  ])('%s(%s)는 막는다', (address) => {
    expect(policy.check(address)).toBe('blocked');
  });

  it.each(['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '::ffff:8.8.8.8'])(
    '%s는 공인 주소다',
    (address) => {
      expect(policy.check(address)).toBe('public');
    },
  );

  it('UPSTREAM_ALLOW_CIDRS 대역은 차단 대역보다 먼저 허용한다', () => {
    const allowing = createAddressPolicy(['127.0.0.1/32', 'fd00::/8']);
    expect(allowing.check('127.0.0.1')).toBe('allowlisted');
    expect(allowing.check('::ffff:127.0.0.1')).toBe('allowlisted');
    expect(allowing.check('fd00::5')).toBe('allowlisted');
    expect(allowing.check('127.0.0.2')).toBe('blocked');
    expect(allowing.check('8.8.8.8')).toBe('public');
  });
});

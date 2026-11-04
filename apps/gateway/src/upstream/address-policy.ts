import { BlockList, isIP } from 'node:net';

// 사용자 입력 URL로 내부망에 닿지 못하게 막는 주소 판정 (F-CON-06).
// BlockList는 IPv4-mapped IPv6(::ffff:a.b.c.d)를 IPv4 규칙으로도 비교한다

const blockedV4: [string, number][] = [
  ['0.0.0.0', 8], // "이 네트워크"
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // link-local, 클라우드 메타데이터 169.254.169.254
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4], // 멀티캐스트
  ['240.0.0.0', 4], // 예약, 브로드캐스트 포함
];

const blockedV6: [string, number][] = [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96], // NAT64: 안에 사설 IPv4를 담을 수 있다
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 32], // Teredo
  ['2001:db8::', 32],
  ['2002::', 16], // 6to4
  ['fc00::', 7], // ULA (fd00::/8 포함)
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
];

export type AddressVerdict = 'public' | 'allowlisted' | 'blocked';

export function createAddressPolicy(allowCidrs: readonly string[]) {
  const blocked = new BlockList();
  for (const [net, prefix] of blockedV4) blocked.addSubnet(net, prefix, 'ipv4');
  for (const [net, prefix] of blockedV6) blocked.addSubnet(net, prefix, 'ipv6');

  const allowed = new BlockList();
  for (const cidr of allowCidrs) {
    const [net = '', prefix = ''] = cidr.split('/');
    allowed.addSubnet(net, Number(prefix), isIP(net) === 6 ? 'ipv6' : 'ipv4');
  }

  // UPSTREAM_ALLOW_CIDRS 대역은 차단 대역보다 먼저 본다
  function check(address: string): AddressVerdict {
    const family = isIP(address) === 6 ? 'ipv6' : 'ipv4';
    if (allowed.check(address, family)) return 'allowlisted';
    if (blocked.check(address, family)) return 'blocked';
    return 'public';
  }

  return { check };
}

export type AddressPolicy = ReturnType<typeof createAddressPolicy>;

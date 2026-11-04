// 같은 이름의 엔드포인트가 있으면 뒤에 숫자를 붙여 제안한다(Home CMS 2).
// 저장은 같은 이름도 된다 (SCR-EP-02 3단계)
export function suggestEndpointName(base: string, existing: readonly string[]): string {
  const name = base.trim().slice(0, 60);
  const taken = new Set(existing.map((value) => value.trim()));
  if (!taken.has(name)) return name;
  for (let n = 2; ; n++) {
    const suffix = ` ${n}`;
    const candidate = `${name.slice(0, 60 - suffix.length)}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

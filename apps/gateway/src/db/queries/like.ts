// ILIKE 검색어의 와일드카드를 글자 그대로 찾게 한다. Postgres 기본 이스케이프 문자는 \
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

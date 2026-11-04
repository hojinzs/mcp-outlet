import type { EndpointDetail, RecentCall } from '../../api/types.ts';

// 엔드포인트 상세의 노출 툴 계산 (SCR-EP-03). 새 툴 = 현재 커넥터 툴 − knownTools이고 gateway가 isNew로 준다

export function newToolNames(detail: EndpointDetail): Set<string> {
  return new Set(detail.tools.filter((tool) => tool.isNew).map((tool) => tool.name));
}

// 저장된 허용목록. 커넥터에서 사라진 툴도 허용목록에 있으면 체크된 상태로 둔다(저장할 때 자동으로 빼지 않는다)
export function savedSelection(detail: EndpointDetail): Set<string> {
  return new Set(detail.allowedTools);
}

// 허용목록 밖이라 거부된 호출이고, 커넥터에 아직 있는 툴이면 "허용목록에 추가"를 보여준다
export function canAllowFromCall(
  call: RecentCall,
  detail: EndpointDetail,
  selected: ReadonlySet<string>,
): boolean {
  if (call.result !== 'denied' || selected.has(call.toolName)) return false;
  return detail.tools.some((tool) => tool.name === call.toolName);
}

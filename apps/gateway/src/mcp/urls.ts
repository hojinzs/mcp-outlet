// 엔드포인트 URL. PUBLIC_BASE_URL 기준 전체 주소다 (F-EP-01)
export function endpointUrl(publicBaseUrl: string, endpointId: string): string {
  return new URL(`/c/${endpointId}/mcp`, publicBaseUrl).toString();
}

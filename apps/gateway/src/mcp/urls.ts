// 엔드포인트 URL. PUBLIC_BASE_URL 기준 전체 주소다 (F-EP-01)
export function endpointUrl(publicBaseUrl: string, endpointId: string): string {
  return new URL(`/c/${endpointId}/mcp`, publicBaseUrl).toString();
}

// RFC 9728: 리소스 경로를 /.well-known/oauth-protected-resource 뒤에 붙인다 (F-AUTH-04)
export function resourceMetadataUrl(publicBaseUrl: string, endpointId: string): string {
  const path = `/.well-known/oauth-protected-resource/c/${endpointId}/mcp`;
  return new URL(path, publicBaseUrl).toString();
}

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys, requests } from '../../api/queries.ts';
import type { EndpointPatch } from '../../api/types.ts';

// PATCH /api/endpoints/:id. 응답(상세)으로 캐시를 바꾸고 목록은 다시 받는다
export function useEndpointUpdate(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: EndpointPatch) => requests.updateEndpoint(id, patch),
    onSuccess: (detail) => {
      queryClient.setQueryData(queryKeys.endpoint(id), detail);
      void queryClient.invalidateQueries({ queryKey: queryKeys.endpoints, exact: true });
    },
  });
}

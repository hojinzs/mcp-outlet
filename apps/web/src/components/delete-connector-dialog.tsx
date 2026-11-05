import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { queryKeys, requests } from '../api/queries.ts';
import { Button } from './ui/button.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from './ui/dialog.tsx';

// 커넥터 삭제 확인 (F-CON-04). 커넥터를 지우면 자격증명과 그 커넥터의 엔드포인트도 함께 지워진다
export function DeleteConnectorDialog({
  connector,
  endpoints,
  open,
  onOpenChange,
  onDeleted,
}: {
  connector: { id: string; name: string };
  endpoints: readonly { id: string; name: string }[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
}) {
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: () => requests.deleteConnector(connector.id),
    onSuccess: () => {
      onDeleted?.();
      for (const endpoint of endpoints) {
        queryClient.removeQueries({ queryKey: queryKeys.endpoint(endpoint.id) });
      }
      queryClient.removeQueries({ queryKey: queryKeys.connector(connector.id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.endpoints });
      void queryClient.invalidateQueries({ queryKey: queryKeys.connectors });
      onOpenChange(false);
      toast.success('커넥터를 삭제했습니다');
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>커넥터 "{connector.name}"를 삭제할까요?</DialogTitle>
        <DialogDescription>
          커넥터와 자격증명을 지웁니다. 되돌릴 수 없습니다. 감사 로그의 기록은 남습니다.
        </DialogDescription>
        {endpoints.length > 0 ? (
          <div className="text-sm">
            <p>이 커넥터를 쓰는 엔드포인트 {endpoints.length}개도 함께 지워집니다.</p>
            <ul className="mt-2 list-disc pl-5">
              {endpoints.map((endpoint) => (
                <li key={endpoint.id}>{endpoint.name}</li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-sm">이 커넥터를 쓰는 엔드포인트는 없습니다.</p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button variant="destructive" onClick={() => remove.mutate()} disabled={remove.isPending}>
            삭제
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { queryKeys, requests } from '../../api/queries.ts';
import { Button } from '../../components/ui/button.tsx';
import { Card, CardDescription, CardTitle } from '../../components/ui/card.tsx';
import { Checkbox } from '../../components/ui/checkbox.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '../../components/ui/dialog.tsx';

// SCR-EP-03 삭제. 이 커넥터를 쓰는 마지막 엔드포인트면 커넥터·자격증명도 함께 지우기를 기본으로 켠다
export function DeleteEndpoint({
  id,
  isLastOfConnector,
  onDeleting,
}: {
  id: string;
  isLastOfConnector: boolean;
  onDeleting: () => void;
}) {
  const checkboxId = useId();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [deleteConnector, setDeleteConnector] = useState(true);

  const remove = useMutation({
    mutationFn: () => requests.deleteEndpoint(id, isLastOfConnector && deleteConnector),
    onSuccess: () => {
      onDeleting();
      queryClient.removeQueries({ queryKey: queryKeys.endpoint(id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.endpoints });
      void queryClient.invalidateQueries({ queryKey: queryKeys.connectors });
      toast.success('엔드포인트를 삭제했습니다');
      navigate('/');
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <Card className="border-destructive/40">
      <CardTitle>엔드포인트 삭제</CardTitle>
      <CardDescription>
        삭제하면 이 주소로 다시 연결할 수 없습니다. 감사 로그의 기록은 남습니다.
      </CardDescription>
      <Button variant="destructive" className="self-start" onClick={() => setOpen(true)}>
        삭제
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle>엔드포인트를 삭제할까요?</DialogTitle>
          <DialogDescription>
            삭제하면 이 주소로 다시 연결할 수 없습니다. 같은 설정이 필요하면 새로 만들어야 하고
            주소도 바뀝니다.
          </DialogDescription>
          {isLastOfConnector && (
            <div className="flex items-start gap-2 text-sm">
              <Checkbox
                id={checkboxId}
                checked={deleteConnector}
                onCheckedChange={(state) => setDeleteConnector(state === true)}
                className="mt-0.5"
              />
              <label htmlFor={checkboxId}>
                커넥터와 자격증명도 함께 지우기
                <span className="block text-muted-foreground">
                  풀면 커넥터를 남겨 두고 다음 엔드포인트 추가 때 다시 쓸 수 있습니다.
                </span>
              </label>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              취소
            </Button>
            <Button
              variant="destructive"
              onClick={() => remove.mutate()}
              disabled={remove.isPending}
            >
              삭제
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

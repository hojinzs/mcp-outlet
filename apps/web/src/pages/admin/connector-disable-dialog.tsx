import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { toast } from 'sonner';
import { queryKeys, requests } from '../../api/queries.ts';
import type { AdminConnector } from '../../api/types.ts';
import { Button } from '../../components/ui/button.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '../../components/ui/dialog.tsx';
import { Label } from '../../components/ui/label.tsx';
import { DISABLE_REASON_MAX, disableReasonProblem } from '../../features/admin/users.ts';

// SCR-ADM-04 사용 중지·다시 사용 확인 창. 사용 중지에는 사유(필수, 200자 이내)를 받는다
export function ConnectorDisableDialog({
  connector,
  open,
  onOpenChange,
}: {
  connector: AdminConnector;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const id = useId();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const disabling = connector.disabled === null;
  const problem = disabling ? disableReasonProblem(reason) : null;

  const save = useMutation({
    mutationFn: () =>
      requests.setConnectorDisabled(
        connector.id,
        disabling ? { disabled: true, reason: reason.trim() } : { disabled: false },
      ),
    onSuccess: () => {
      // 사용자 행의 "중지 N"과 커넥터 행을 함께 갱신한다
      void queryClient.invalidateQueries({ queryKey: queryKeys.adminUsers });
      toast.success(disabling ? '커넥터를 사용 중지했습니다' : '커넥터를 다시 사용합니다');
      setReason('');
      onOpenChange(false);
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>
          {disabling ? `${connector.name} 커넥터를 사용 중지할까요?` : '다시 사용할까요?'}
        </DialogTitle>
        <DialogDescription>
          {disabling
            ? `이 커넥터의 엔드포인트 ${connector.endpointCount}개가 바로 호출을 거부합니다. 사용자는 엔드포인트 목록에서 사유를 볼 수 있습니다.`
            : `이 커넥터의 엔드포인트 ${connector.endpointCount}개가 다음 요청부터 다시 호출을 받습니다.`}
        </DialogDescription>
        {disabling && (
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${id}-reason`}>사유</Label>
            <textarea
              id={`${id}-reason`}
              rows={3}
              maxLength={DISABLE_REASON_MAX + 20}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              aria-invalid={reason !== '' && problem !== null}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive"
            />
            <p className="text-xs text-muted-foreground">
              {reason !== '' && problem
                ? problem
                : `사용자에게 보입니다. ${DISABLE_REASON_MAX}자 이내`}
            </p>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button
            variant={disabling ? 'destructive' : 'default'}
            onClick={() => save.mutate()}
            disabled={problem !== null || save.isPending}
          >
            {disabling ? '사용 중지' : '다시 사용'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

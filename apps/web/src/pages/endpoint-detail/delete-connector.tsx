import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { endpointsQuery } from '../../api/queries.ts';
import { DeleteConnectorDialog } from '../../components/delete-connector-dialog.tsx';
import { Button } from '../../components/ui/button.tsx';
import { endpointsOfConnector } from '../../features/connectors/deletion.ts';

// SCR-EP-03 커넥터 설정의 커넥터 삭제. 이 커넥터를 쓰는 엔드포인트도 모두 지워지므로 목록을 보여준다
export function DeleteConnector({
  connector,
  onDeleting,
}: {
  connector: { id: string; name: string };
  onDeleting: () => void;
}) {
  const navigate = useNavigate();
  const endpoints = useQuery(endpointsQuery);
  const [open, setOpen] = useState(false);

  return (
    <div className="flex flex-wrap items-center gap-3 border-t pt-4 text-sm">
      <span className="flex-1 text-muted-foreground">
        커넥터를 지우면 자격증명과 이 커넥터를 쓰는 엔드포인트도 함께 지워집니다.
      </span>
      <Button
        variant="outline"
        className="text-destructive"
        onClick={() => setOpen(true)}
        disabled={endpoints.isPending}
      >
        커넥터 삭제
      </Button>
      <DeleteConnectorDialog
        connector={connector}
        endpoints={endpointsOfConnector(endpoints.data, connector.id)}
        open={open}
        onOpenChange={setOpen}
        onDeleted={() => {
          onDeleting();
          navigate('/');
        }}
      />
    </div>
  );
}

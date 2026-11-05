import { useMutation } from '@tanstack/react-query';
import { PencilIcon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { requests } from '../../api/queries.ts';
import type { Connector } from '../../api/types.ts';
import { Button } from '../../components/ui/button.tsx';
import { Input } from '../../components/ui/input.tsx';

// 커넥터 이름은 원격·내장 모두 바꿀 수 있다. 이름만 바꾸면 연결 테스트를 하지 않는다 (SCR-EP-03 커넥터 설정)
export function ConnectorName({
  connector,
  onSaved,
}: {
  connector: Connector;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (name: string) => requests.updateConnector(connector.id, { name }),
    onSuccess: () => {
      setDraft(null);
      toast.success('커넥터 이름을 저장했습니다');
      onSaved();
    },
    onError: (error) => toast.error(error.message),
  });

  if (draft === null) {
    return (
      <div className="flex min-w-0 items-center gap-2 text-sm">
        <span className="w-32 shrink-0 text-muted-foreground">커넥터 이름</span>
        <span className="truncate">{connector.name}</span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="커넥터 이름 바꾸기"
          onClick={() => setDraft(connector.name)}
        >
          <PencilIcon />
        </Button>
      </div>
    );
  }

  const trimmed = draft.trim();
  const valid = trimmed.length >= 1 && trimmed.length <= 60;
  return (
    <form
      className="flex flex-wrap items-center gap-2 text-sm"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid) return;
        if (trimmed === connector.name) setDraft(null);
        else save.mutate(trimmed);
      }}
    >
      <span className="w-32 shrink-0 text-muted-foreground">커넥터 이름</span>
      <Input
        aria-label="커넥터 이름"
        autoFocus
        maxLength={60}
        value={draft}
        aria-invalid={!valid}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setDraft(null);
        }}
        className="w-64"
      />
      <Button type="submit" size="sm" disabled={!valid || save.isPending}>
        저장
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setDraft(null)}>
        취소
      </Button>
    </form>
  );
}

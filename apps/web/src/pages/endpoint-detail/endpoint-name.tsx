import { PencilIcon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button.tsx';
import { Input } from '../../components/ui/input.tsx';
import { useEndpointUpdate } from './use-endpoint-update.ts';

// 이름은 연필 버튼으로 그 자리에서 편집하고 Enter로 저장한다 (SCR-EP-03 머리)
export function EndpointName({ id, name }: { id: string; name: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const update = useEndpointUpdate(id);

  if (draft === null) {
    return (
      <div className="flex min-w-0 items-center gap-2">
        <h1 className="truncate text-2xl font-semibold">{name}</h1>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="이름 바꾸기"
          onClick={() => setDraft(name)}
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
      className="flex items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid) return;
        if (trimmed === name) {
          setDraft(null);
          return;
        }
        update.mutate(
          { name: trimmed },
          {
            onSuccess: () => {
              setDraft(null);
              toast.success('이름을 저장했습니다');
            },
            onError: (error) => toast.error(error.message),
          },
        );
      }}
    >
      <Input
        aria-label="엔드포인트 이름"
        // biome-ignore lint/a11y/noAutofocus: 연필 버튼을 누른 직후 편집을 시작한다
        autoFocus
        maxLength={60}
        value={draft}
        aria-invalid={!valid}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setDraft(null);
        }}
        className="h-10 w-72 text-lg"
      />
      <Button type="submit" size="sm" disabled={!valid || update.isPending}>
        저장
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setDraft(null)}>
        취소
      </Button>
    </form>
  );
}

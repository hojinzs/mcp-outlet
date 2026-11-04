import { useId } from 'react';
import type { Tool } from '../../api/types.ts';
import { Button } from '../../components/ui/button.tsx';
import { Card } from '../../components/ui/card.tsx';
import { Input } from '../../components/ui/input.tsx';
import { Label } from '../../components/ui/label.tsx';
import { countNotReadOnly } from '../../features/tools/selection.ts';

// SCR-EP-02 3단계: 이름과 요약. 이름은 1~60자, 앞뒤 공백 제거
export function NameStep({
  name,
  onNameChange,
  connectorName,
  tools,
  selected,
  error,
  creating,
  onBack,
  onCreate,
}: {
  name: string;
  onNameChange: (name: string) => void;
  connectorName: string;
  tools: readonly Tool[];
  selected: ReadonlySet<string>;
  error: string | null;
  creating: boolean;
  onBack: () => void;
  onCreate: () => void;
}) {
  const id = useId();
  const trimmed = name.trim();
  const valid = trimmed.length >= 1 && trimmed.length <= 60;
  const notReadOnly = countNotReadOnly(tools, selected);

  return (
    <Card>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid && !creating) onCreate();
        }}
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor={id}>엔드포인트 이름</Label>
          <Input
            id={id}
            maxLength={60}
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
            aria-invalid={!valid}
          />
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 rounded-md bg-muted/60 p-4 text-sm">
          <dt className="text-muted-foreground">커넥터</dt>
          <dd>{connectorName}</dd>
          <dt className="text-muted-foreground">노출 툴</dt>
          <dd>
            {selected.size}개
            {notReadOnly > 0 && (
              <span className="ml-2 text-warning">읽기 전용이 아닌 툴 {notReadOnly}개</span>
            )}
          </dd>
        </dl>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex justify-between border-t pt-4">
          <Button variant="outline" onClick={onBack}>
            이전
          </Button>
          <Button type="submit" disabled={!valid || creating}>
            {creating ? '만드는 중' : '만들기'}
          </Button>
        </div>
      </form>
    </Card>
  );
}

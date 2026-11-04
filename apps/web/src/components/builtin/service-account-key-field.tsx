import { CircleCheckIcon } from 'lucide-react';
import { type ChangeEvent, useId, useState } from 'react';
import { builtinGuide, checkServiceAccountKey } from '../../features/connectors/builtin.ts';
import { Button } from '../ui/button.tsx';
import { Label } from '../ui/label.tsx';

// 서비스 계정 JSON 키 입력 (SCR-EP-02 내장 서비스, SCR-EP-03 키 파일 교체).
// 키를 읽으면 입력란을 숨기고 client_email만 보여준다. private key는 화면에 남기지 않는다
export function ServiceAccountKeyField({
  builtinKey,
  value,
  onChange,
}: {
  builtinKey: string | null;
  value: string;
  onChange: (key: string) => void;
}) {
  const id = useId();
  const [fileProblem, setFileProblem] = useState<string | null>(null);
  const check = checkServiceAccountKey(value);

  function readFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      // 형식이 틀린 파일 내용은 입력란에 옮기지 않는다
      if (checkServiceAccountKey(text).status !== 'ok') {
        setFileProblem('서비스 계정 JSON 키 파일이 아닙니다');
        return;
      }
      setFileProblem(null);
      onChange(text);
    };
    reader.onerror = () => setFileProblem('파일을 읽지 못했습니다');
    reader.readAsText(file);
  }

  if (check.status === 'ok') {
    return (
      <div className="flex flex-col gap-2 rounded-md border p-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <CircleCheckIcon className="size-4 text-success" />
          <span className="text-muted-foreground">서비스 계정</span>
          <code className="font-mono">{check.clientEmail}</code>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => onChange('')}>
            다른 키 넣기
          </Button>
        </div>
        <p className="text-muted-foreground">{builtinGuide(builtinKey).serviceAccount}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-file`}>서비스 계정 JSON 키 파일</Label>
        <input
          id={`${id}-file`}
          type="file"
          accept="application/json,.json"
          onChange={readFile}
          className="text-sm file:mr-3 file:rounded-md file:border file:bg-background file:px-3 file:py-1 file:text-sm"
        />
        {fileProblem && (
          <p role="alert" className="text-sm text-destructive">
            {fileProblem}
          </p>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-paste`}>또는 키 내용 붙여넣기</Label>
        <textarea
          id={`${id}-paste`}
          rows={4}
          spellCheck={false}
          autoComplete="off"
          placeholder='{ "type": "service_account", ... }'
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
        {check.status === 'invalid' && <p className="text-sm text-destructive">{check.problem}</p>}
      </div>
    </div>
  );
}

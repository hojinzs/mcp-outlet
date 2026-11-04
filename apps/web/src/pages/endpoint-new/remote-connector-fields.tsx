import { useId } from 'react';
import { Input } from '../../components/ui/input.tsx';
import { Label } from '../../components/ui/label.tsx';
import { type RemoteFormState, withUrl } from '../../features/connectors/remote-form.ts';
import { cn } from '../../lib/utils.ts';

// 원격 MCP 서버 필드 (SCR-EP-02 1단계). 토큰은 비밀번호 입력란이고 저장 후 다시 보여주지 않는다
export function RemoteConnectorFields({
  value,
  onChange,
}: {
  value: RemoteFormState;
  onChange: (next: RemoteFormState) => void;
}) {
  const id = useId();
  const set = (patch: Partial<RemoteFormState>) => onChange({ ...value, ...patch });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-url`}>커넥터 주소</Label>
        <Input
          id={`${id}-url`}
          type="url"
          inputMode="url"
          placeholder="https://mcp.example.com/mcp"
          autoComplete="off"
          value={value.url}
          onChange={(event) => onChange(withUrl(value, event.target.value))}
        />
        <p className="text-xs text-muted-foreground">
          원격 MCP 서버의 Streamable HTTP 주소. https 주소만 받습니다.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-name`}>커넥터 이름</Label>
        <Input
          id={`${id}-name`}
          maxLength={60}
          value={value.name}
          onChange={(event) => set({ name: event.target.value, nameEdited: true })}
        />
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">인증</legend>
        <div className="flex gap-4">
          {(
            [
              ['static_token', '토큰'],
              ['none', '없음'],
            ] as const
          ).map(([type, label]) => (
            <label key={type} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name={`${id}-auth`}
                checked={value.authType === type}
                onChange={() => set({ authType: type })}
                className="accent-primary"
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      <div className={cn('flex flex-col gap-4', value.authType === 'none' && 'hidden')}>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${id}-token`}>토큰</Label>
          <Input
            id={`${id}-token`}
            type="password"
            autoComplete="off"
            value={value.token}
            onChange={(event) => set({ token: event.target.value })}
          />
        </div>
        <details className="rounded-md border px-3 py-2">
          <summary className="cursor-pointer text-sm font-medium">고급</summary>
          <div className="flex flex-col gap-4 pt-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor={`${id}-header`}>헤더 이름</Label>
              <Input
                id={`${id}-header`}
                placeholder="Authorization"
                value={value.header}
                onChange={(event) => set({ header: event.target.value })}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor={`${id}-prefix`}>접두어</Label>
              <Input
                id={`${id}-prefix`}
                placeholder="Bearer "
                value={value.prefix}
                onChange={(event) => set({ prefix: event.target.value })}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              둘 다 비우면 Authorization 헤더에 토큰 값만 그대로 보냅니다.
            </p>
          </div>
        </details>
      </div>
    </div>
  );
}

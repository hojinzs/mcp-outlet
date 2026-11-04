import { useId } from 'react';
import type { OAuthClient } from '../../api/types.ts';
import { Input } from '../ui/input.tsx';
import { Label } from '../ui/label.tsx';

// 내 OAuth 앱의 Client ID·Client Secret 입력 (SCR-EP-02 계정 연결 ②). Secret은 비밀번호 입력란이다
export function OAuthClientFields({
  value,
  onChange,
}: {
  value: OAuthClient;
  onChange: (next: OAuthClient) => void;
}) {
  const id = useId();
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-client-id`}>Client ID</Label>
        <Input
          id={`${id}-client-id`}
          autoComplete="off"
          value={value.clientId}
          onChange={(event) => onChange({ ...value, clientId: event.target.value })}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-client-secret`}>Client Secret</Label>
        <Input
          id={`${id}-client-secret`}
          type="password"
          autoComplete="off"
          value={value.clientSecret}
          onChange={(event) => onChange({ ...value, clientSecret: event.target.value })}
        />
      </div>
    </div>
  );
}

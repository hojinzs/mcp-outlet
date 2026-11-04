import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { ApiError } from '../../api/client.ts';
import { connectorQuery, queryKeys, requests } from '../../api/queries.ts';
import type { Connector, RemoteConnectorPatch } from '../../api/types.ts';
import { Loading } from '../../components/loading.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Card, CardTitle } from '../../components/ui/card.tsx';
import { Input } from '../../components/ui/input.tsx';
import { Label } from '../../components/ui/label.tsx';
import { connectionTestMessage } from '../../features/connectors/remote-form.ts';
import { formatDateTime } from '../../lib/format.ts';

// SCR-EP-03 커넥터 설정. 주소·토큰을 바꾸면 gateway가 연결 테스트를 통과해야 저장한다

type Draft = {
  url: string;
  authType: 'none' | 'static_token';
  header: string;
  prefix: string;
  // 비우면 저장된 토큰을 그대로 쓴다
  token: string;
};

function draftOf(connector: Connector): Draft {
  const auth = connector.auth;
  return {
    url: connector.url ?? '',
    authType: auth.type === 'static_token' ? 'static_token' : 'none',
    header: auth.type === 'static_token' ? auth.header : 'Authorization',
    prefix: auth.type === 'static_token' ? auth.prefix : 'Bearer ',
    token: '',
  };
}

// 바뀐 것만 보낸다. 바뀐 게 없으면 undefined
function patchOf(connector: Connector, draft: Draft): RemoteConnectorPatch | undefined {
  const saved = draftOf(connector);
  const patch: RemoteConnectorPatch = {};
  if (draft.url.trim() !== saved.url) patch.url = draft.url.trim();
  const authChanged =
    draft.authType !== saved.authType ||
    draft.token !== '' ||
    (draft.authType === 'static_token' &&
      (draft.header !== saved.header || draft.prefix !== saved.prefix));
  if (authChanged) {
    patch.auth =
      draft.authType === 'none'
        ? { type: 'none' }
        : {
            type: 'static_token',
            header: draft.header.trim(),
            prefix: draft.prefix,
            ...(draft.token ? { token: draft.token } : {}),
          };
  }
  return Object.keys(patch).length > 0 ? patch : undefined;
}

function failureText(error: Error): string {
  if (error instanceof ApiError && error.code === 'connection_test_failed') {
    return connectionTestMessage(String(error.details?.result ?? ''));
  }
  if (error instanceof ApiError && error.status === 400) {
    return '주소와 입력값을 확인하세요. https 주소만 등록할 수 있습니다';
  }
  return error.message;
}

function RemoteForm({ connector, onSaved }: { connector: Connector; onSaved: () => void }) {
  const id = useId();
  const [draft, setDraft] = useState<Draft>(() => draftOf(connector));
  const [replacing, setReplacing] = useState(false);
  const patch = patchOf(connector, draft);
  // 토큰이 없던 커넥터를 토큰 방식으로 바꾸려면 새 토큰이 필요하다
  const needsToken =
    draft.authType === 'static_token' && !connector.credential.configured && !draft.token;

  const save = useMutation({
    mutationFn: (value: RemoteConnectorPatch) => requests.updateConnector(connector.id, value),
    onSuccess: (saved) => {
      setDraft(draftOf(saved));
      setReplacing(false);
      toast.success('커넥터 설정을 저장했습니다');
      onSaved();
    },
  });
  const set = (value: Partial<Draft>) => setDraft((current) => ({ ...current, ...value }));

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (patch && !needsToken) save.mutate(patch);
      }}
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-url`}>커넥터 주소</Label>
        <Input
          id={`${id}-url`}
          type="url"
          value={draft.url}
          onChange={(event) => set({ url: event.target.value })}
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
                checked={draft.authType === type}
                onChange={() => set({ authType: type })}
                className="accent-primary"
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      {draft.authType === 'static_token' && (
        <div className="flex flex-col gap-3 rounded-md border p-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">토큰</span>
            {/* 비밀값은 다시 보여주지 않고 설정 여부와 변경 시각만 표시한다 */}
            <span>
              {connector.credential.configured
                ? `설정됨 · ${formatDateTime(connector.credential.updatedAt)}`
                : '설정되지 않음'}
            </span>
            {!replacing && connector.credential.configured && (
              <Button size="sm" variant="outline" onClick={() => setReplacing(true)}>
                교체
              </Button>
            )}
          </div>
          {(replacing || !connector.credential.configured) && (
            <div className="flex flex-col gap-2">
              <Label htmlFor={`${id}-token`}>새 토큰</Label>
              <Input
                id={`${id}-token`}
                type="password"
                autoComplete="off"
                value={draft.token}
                onChange={(event) => set({ token: event.target.value })}
              />
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor={`${id}-header`}>헤더 이름</Label>
              <Input
                id={`${id}-header`}
                value={draft.header}
                onChange={(event) => set({ header: event.target.value })}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor={`${id}-prefix`}>접두어</Label>
              <Input
                id={`${id}-prefix`}
                value={draft.prefix}
                onChange={(event) => set({ prefix: event.target.value })}
              />
            </div>
          </div>
        </div>
      )}
      {save.isError && (
        <p role="alert" className="text-sm text-destructive">
          저장하지 않았습니다. {failureText(save.error)}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={!patch || needsToken || save.isPending}>
          {save.isPending ? '연결 테스트 중' : '연결 테스트 후 저장'}
        </Button>
        {patch && (
          <Button
            variant="ghost"
            onClick={() => {
              setDraft(draftOf(connector));
              setReplacing(false);
              save.reset();
            }}
          >
            되돌리기
          </Button>
        )}
      </div>
    </form>
  );
}

export function ConnectorSettings({
  connectorId,
  endpointCount,
}: {
  connectorId: string;
  endpointCount: number;
}) {
  const queryClient = useQueryClient();
  const connector = useQuery(connectorQuery(connectorId));

  // 커넥터가 바뀌면 이 커넥터를 쓰는 엔드포인트의 툴·상태도 바뀐다
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.connectors });
    void queryClient.invalidateQueries({ queryKey: queryKeys.endpoints });
  };

  const retest = useMutation({
    mutationFn: () => requests.retestConnector(connectorId),
    onSuccess: (result) => {
      if (result.result === 'ok') toast.success(`연결됐습니다. 툴 ${result.tools.length}개`);
      refresh();
    },
    onError: (error) => toast.error(error.message),
  });

  if (connector.isPending) return <Loading />;
  if (connector.isError) {
    return (
      <Card>
        <CardTitle>커넥터 설정</CardTitle>
        <p className="text-sm text-destructive">커넥터 설정을 불러오지 못했습니다.</p>
      </Card>
    );
  }

  const data = connector.data;
  const lastResult = data.lastTestResult;
  return (
    <Card>
      <CardTitle>커넥터 설정</CardTitle>
      {endpointCount > 1 && (
        <p className="rounded-md bg-muted p-3 text-sm">
          이 커넥터를 쓰는 엔드포인트 {endpointCount}개에 함께 적용됩니다.
        </p>
      )}
      {data.runtime === 'remote' ? (
        <RemoteForm key={data.updatedAt} connector={data} onSaved={refresh} />
      ) : (
        // 내장 서비스의 계정 연결·다시 연결은 마일스톤 4에서 붙인다
        <p className="text-sm">
          서비스 <span className="font-medium">{data.name}</span>
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3 border-t pt-4 text-sm">
        <Button variant="outline" onClick={() => retest.mutate()} disabled={retest.isPending}>
          {retest.isPending ? '테스트 중' : '연결 테스트'}
        </Button>
        <span className="text-muted-foreground">
          마지막 결과:{' '}
          {lastResult === null
            ? '없음'
            : lastResult === 'ok'
              ? `성공 · ${formatDateTime(data.lastTestedAt)}`
              : `${connectionTestMessage(lastResult)} · ${formatDateTime(data.lastTestedAt)}`}
        </span>
        <Button variant="link" asChild className="ml-auto px-0">
          <Link to={`/endpoints/new?connector=${connectorId}`}>이 커넥터로 엔드포인트 하나 더</Link>
        </Button>
      </div>
    </Card>
  );
}

import { useState } from 'react';
import type { BuiltinAuthMethod, Connector, OAuthClient } from '../../api/types.ts';
import { OAuthAppGuide } from '../../components/builtin/oauth-app-guide.tsx';
import { OAuthClientFields } from '../../components/builtin/oauth-client-fields.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Card, CardDescription, CardTitle } from '../../components/ui/card.tsx';
import { connectorKindLabel } from '../../features/endpoints/connector-kind.ts';
import { formatDateTime } from '../../lib/format.ts';
import { TestBar, type TestState } from './connector-step.tsx';

type OAuthMethod = Extract<BuiltinAuthMethod, { type: 'oauth2' }>;

// SCR-EP-02 이어하기: 업스트림 동의에서 돌아온 커넥터나 정상이 아닌(연결 중·오류·재연결 필요) 커넥터를
// 1단계의 연결 테스트부터 이어간다. 테스트에 성공하면 2단계로 간다.
// 계정 연결 커넥터는 같은 커넥터로 다시 연결하거나 OAuth 앱 정보를 다시 넣을 수 있다
export function ConnectorResume({
  connector,
  serviceName,
  oauthMethod,
  notice,
  reason,
  test,
  testing,
  onTest,
  onNext,
  onReconnect,
  reconnecting,
  reconnectError,
  onStartOver,
}: {
  connector: Connector;
  serviceName: string | null;
  oauthMethod: OAuthMethod | undefined;
  notice: string | null;
  // 고를 수 없는 사유. 테스트에 성공했으면 null (resumeReason)
  reason: string | null;
  test: TestState;
  testing: boolean;
  onTest: () => void;
  onNext: () => void;
  onReconnect: (client?: OAuthClient) => void;
  reconnecting: boolean;
  reconnectError: string | null;
  onStartOver: () => void;
}) {
  const [editingClient, setEditingClient] = useState(false);
  const [client, setClient] = useState<OAuthClient>({ clientId: '', clientSecret: '' });
  const canReconnect = connector.auth.type === 'oauth2' && oauthMethod !== undefined;
  const provider = oauthMethod?.provider ?? '';
  const account = connector.credential.account;

  return (
    <Card>
      <div className="flex flex-col gap-1">
        <CardTitle>{connector.name}</CardTitle>
        <CardDescription>
          {connectorKindLabel(connector.runtime, serviceName)}
          {connector.url && (
            <>
              {' '}
              · <span className="font-mono text-xs">{connector.url}</span>
            </>
          )}
          {account && (
            <>
              {' '}
              · 연결된 계정 <span className="text-foreground">{account}</span> ·{' '}
              {formatDateTime(connector.credential.updatedAt)}
            </>
          )}
        </CardDescription>
      </div>
      {notice ? (
        <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {notice}
        </p>
      ) : (
        reason && (
          <p className="rounded-md bg-muted p-3 text-sm">
            {reason}. {canReconnect ? '다시 연결하거나 ' : ''}연결 테스트를 다시 하세요.
          </p>
        )
      )}
      {canReconnect && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <Button
              variant={notice || connector.status === 'reauth_required' ? 'default' : 'outline'}
              onClick={() => onReconnect()}
              disabled={reconnecting}
            >
              {reconnecting ? '이동하는 중' : `${provider}로 다시 연결`}
            </Button>
            {!editingClient && (
              <Button variant="ghost" onClick={() => setEditingClient(true)}>
                Client ID·Secret 다시 넣기
              </Button>
            )}
          </div>
          {editingClient && oauthMethod && (
            <div className="flex flex-col gap-3 rounded-md border p-3">
              <OAuthAppGuide builtinKey={connector.builtin ?? ''} method={oauthMethod} />
              <OAuthClientFields value={client} onChange={setClient} />
              <div className="flex gap-2">
                <Button
                  onClick={() => onReconnect(client)}
                  disabled={reconnecting || !client.clientId.trim() || !client.clientSecret.trim()}
                >
                  이 OAuth 앱으로 {provider}에 연결
                </Button>
                <Button variant="ghost" onClick={() => setEditingClient(false)}>
                  취소
                </Button>
              </div>
            </div>
          )}
          {reconnectError && (
            <p role="alert" className="text-sm text-destructive">
              {reconnectError}
            </p>
          )}
        </div>
      )}
      <TestBar test={test} testing={testing} onTest={onTest} onNext={onNext} />
      <Button variant="link" className="self-start px-0" onClick={onStartOver}>
        다른 커넥터로 시작
      </Button>
    </Card>
  );
}

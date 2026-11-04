import { useMutation } from '@tanstack/react-query';
import { TriangleAlertIcon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { requests } from '../../api/queries.ts';
import type { Builtin, Connector, OAuthClient } from '../../api/types.ts';
import { OAuthAppGuide, OAuthExpiryWarning } from '../../components/builtin/oauth-app-guide.tsx';
import { OAuthClientFields } from '../../components/builtin/oauth-client-fields.tsx';
import { ServiceAccountKeyField } from '../../components/builtin/service-account-key-field.tsx';
import { useOAuthStart } from '../../components/builtin/use-oauth-start.ts';
import { Button } from '../../components/ui/button.tsx';
import {
  builtinErrorText,
  checkServiceAccountKey,
  endpointReturnTo,
  oauthMethodOf,
  supportsServiceAccount,
} from '../../features/connectors/builtin.ts';
import { formatDateTime } from '../../lib/format.ts';

// SCR-EP-03 커넥터 설정의 내장 서비스 열: 서비스 이름(바꿀 수 없음), 인증 방식, 연결된 계정·연결 시각.
// OAuth는 다시 연결·다른 OAuth 앱으로 바꾸기, 서비스 계정은 키 파일 교체. 방식 전환도 같은 두 동작으로 한다

type Panel = 'oauth_client' | 'service_account_key' | null;

function OAuthClientPanel({
  connector,
  builtin,
  endpointId,
  title,
  onClose,
}: {
  connector: Connector;
  builtin: Builtin;
  endpointId: string;
  title: string;
  onClose: () => void;
}) {
  const method = oauthMethodOf(builtin);
  const { start, redirecting } = useOAuthStart();
  const [client, setClient] = useState<OAuthClient>({ clientId: '', clientSecret: '' });
  if (!method) return null;
  const ready = client.clientId.trim() !== '' && client.clientSecret.trim() !== '';

  return (
    <div className="flex flex-col gap-3 rounded-md border p-3">
      <p className="text-sm font-medium">{title}</p>
      <OAuthAppGuide builtinKey={builtin.key} method={method} />
      <OAuthClientFields value={client} onChange={setClient} />
      <p className="text-xs text-muted-foreground">
        동의가 끝나야 새 OAuth 앱으로 바뀝니다. 그 전까지는 지금 설정을 그대로 씁니다.
      </p>
      {start.isError && (
        <p role="alert" className="text-sm text-destructive">
          {builtinErrorText(start.error)}
        </p>
      )}
      <div className="flex gap-2">
        <Button
          disabled={!ready || start.isPending || redirecting}
          onClick={() =>
            start.mutate({
              connectorId: connector.id,
              input: {
                returnTo: endpointReturnTo(endpointId),
                client: {
                  clientId: client.clientId.trim(),
                  clientSecret: client.clientSecret.trim(),
                },
              },
            })
          }
        >
          {start.isPending || redirecting ? '이동하는 중' : `${method.provider}로 연결`}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          취소
        </Button>
      </div>
    </div>
  );
}

function ServiceAccountKeyPanel({
  connector,
  title,
  onSaved,
  onClose,
}: {
  connector: Connector;
  title: string;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [key, setKey] = useState('');
  // 새 키가 연결 테스트를 통과해야 gateway가 저장한다
  const save = useMutation({
    mutationFn: () =>
      requests.updateConnector(connector.id, { auth: { type: 'service_account', key } }),
    onSuccess: () => {
      toast.success('서비스 계정 키를 저장했습니다');
      onSaved();
    },
  });

  return (
    <div className="flex flex-col gap-3 rounded-md border p-3">
      <p className="text-sm font-medium">{title}</p>
      <ServiceAccountKeyField builtinKey={connector.builtin} value={key} onChange={setKey} />
      {save.isError && (
        <p role="alert" className="text-sm text-destructive">
          저장하지 않았습니다. {builtinErrorText(save.error)}
        </p>
      )}
      <div className="flex gap-2">
        <Button
          disabled={checkServiceAccountKey(key).status !== 'ok' || save.isPending}
          onClick={() => save.mutate()}
        >
          {save.isPending ? '연결 테스트 중' : '연결 테스트 후 저장'}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          취소
        </Button>
      </div>
    </div>
  );
}

export function BuiltinSettings({
  connector,
  builtin,
  endpointId,
  connectNotice,
  onSaved,
}: {
  connector: Connector;
  builtin: Builtin | undefined;
  endpointId: string;
  // 업스트림 동의에서 돌아왔을 때 실패·취소 문구
  connectNotice: string | null;
  onSaved: () => void;
}) {
  const [panel, setPanel] = useState<Panel>(null);
  const reconnect = useOAuthStart();
  const isOAuth = connector.auth.type === 'oauth2';
  const oauthMethod = oauthMethodOf(builtin);
  const provider = oauthMethod?.provider;
  const canUseServiceAccount = supportsServiceAccount(builtin);

  function startReconnect() {
    reconnect.start.mutate({
      connectorId: connector.id,
      input: { returnTo: endpointReturnTo(endpointId) },
    });
  }
  const reconnectButton = (
    <Button
      variant={connector.status === 'reauth_required' ? 'default' : 'outline'}
      onClick={startReconnect}
      disabled={reconnect.start.isPending || reconnect.redirecting}
    >
      {reconnect.start.isPending || reconnect.redirecting ? '이동하는 중' : '다시 연결'}
    </Button>
  );

  return (
    <div className="flex flex-col gap-4">
      {connector.status === 'reauth_required' && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm"
        >
          <TriangleAlertIcon className="size-4 text-warning" />
          <p className="flex-1">
            {provider ? `${provider} ` : ''}계정 연결이 만료되었거나 취소되었습니다. 다시
            연결하세요.
          </p>
          {isOAuth && oauthMethod && reconnectButton}
        </div>
      )}
      {connectNotice && (
        <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {connectNotice}
        </p>
      )}
      <dl className="grid gap-3 text-sm sm:grid-cols-[8rem_1fr]">
        <dt className="text-muted-foreground">서비스</dt>
        <dd>{builtin?.name ?? connector.builtin ?? '내장 서비스'}</dd>
        <dt className="text-muted-foreground">인증 방식</dt>
        <dd>{isOAuth ? `${provider ?? ''} 계정 연결 (OAuth)`.trim() : '서비스 계정'}</dd>
        <dt className="text-muted-foreground">{isOAuth ? '연결된 계정' : '서비스 계정 이메일'}</dt>
        <dd className="break-all">{connector.credential.account ?? '-'}</dd>
        <dt className="text-muted-foreground">연결 시각</dt>
        <dd>{formatDateTime(connector.credential.updatedAt)}</dd>
      </dl>

      {panel === null && (
        <div className="flex flex-wrap gap-2">
          {isOAuth && oauthMethod && (
            <>
              {connector.status !== 'reauth_required' && reconnectButton}
              <Button variant="outline" onClick={() => setPanel('oauth_client')}>
                다른 OAuth 앱으로 바꾸기
              </Button>
              {canUseServiceAccount && (
                <Button variant="ghost" onClick={() => setPanel('service_account_key')}>
                  서비스 계정으로 바꾸기
                </Button>
              )}
            </>
          )}
          {!isOAuth && (
            <>
              <Button variant="outline" onClick={() => setPanel('service_account_key')}>
                키 파일 교체
              </Button>
              {oauthMethod && (
                <Button variant="ghost" onClick={() => setPanel('oauth_client')}>
                  {oauthMethod.provider} 계정 연결로 바꾸기
                </Button>
              )}
            </>
          )}
        </div>
      )}
      {reconnect.start.isError && (
        <p role="alert" className="text-sm text-destructive">
          {builtinErrorText(reconnect.start.error)}
        </p>
      )}
      {isOAuth && panel === null && <OAuthExpiryWarning />}

      {panel === 'oauth_client' && builtin && (
        <OAuthClientPanel
          connector={connector}
          builtin={builtin}
          endpointId={endpointId}
          title={isOAuth ? '다른 OAuth 앱으로 바꾸기' : `${provider ?? ''} 계정 연결로 바꾸기`}
          onClose={() => setPanel(null)}
        />
      )}
      {panel === 'service_account_key' && (
        <ServiceAccountKeyPanel
          connector={connector}
          title={isOAuth ? '서비스 계정으로 바꾸기' : '키 파일 교체'}
          onSaved={onSaved}
          onClose={() => setPanel(null)}
        />
      )}
    </div>
  );
}

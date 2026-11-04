import { CircleCheckIcon, CircleXIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Connector } from '../../api/types.ts';
import { Badge } from '../../components/ui/badge.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Card, CardDescription, CardTitle } from '../../components/ui/card.tsx';
import { type RemoteFormState, remoteFormProblem } from '../../features/connectors/remote-form.ts';
import { connectorKindLabel } from '../../features/endpoints/connector-kind.ts';
import { cn } from '../../lib/utils.ts';
import { RemoteConnectorFields } from './remote-connector-fields.tsx';

// SCR-EP-02 1단계: 내 커넥터에서 고르기 / 새 커넥터 등록

export type ConnectorMode = 'existing' | 'new';

// 연결 테스트 결과. 성공해야 다음으로 넘어간다 (F-CON-05)
export type TestState =
  | { status: 'idle' }
  | { status: 'ok'; toolCount: number }
  | { status: 'failed'; message: string };

function ChoiceButton({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex flex-1 flex-col items-start gap-1 rounded-lg border bg-background p-4 text-left text-sm hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60',
        active && 'border-primary ring-1 ring-primary',
      )}
    >
      {children}
    </button>
  );
}

function ExistingConnectors({
  connectors,
  picking,
  onPick,
}: {
  connectors: readonly Connector[];
  picking: string | null;
  onPick: (connector: Connector) => void;
}) {
  return (
    <ul className="divide-y overflow-hidden rounded-lg border bg-background">
      {connectors.map((connector) => {
        const disabled = connector.disabledAt !== null;
        return (
          <li key={connector.id} className="flex items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="font-medium">{connector.name}</div>
              <div className="text-xs text-muted-foreground">
                {connectorKindLabel(connector.runtime)} · 툴 {connector.toolCount}개
              </div>
            </div>
            {disabled ? (
              <Badge variant="destructive">사용 중지됨</Badge>
            ) : connector.status === 'error' ? (
              <Badge variant="destructive">커넥터 오류</Badge>
            ) : connector.status === 'reauth_required' ? (
              <Badge variant="warning">재연결 필요</Badge>
            ) : null}
            <Button
              size="sm"
              variant="outline"
              disabled={disabled || picking !== null}
              onClick={() => onPick(connector)}
            >
              {picking === connector.id ? '불러오는 중' : '고르기'}
            </Button>
          </li>
        );
      })}
    </ul>
  );
}

export function ConnectorStep({
  connectors,
  mode,
  onModeChange,
  form,
  onFormChange,
  test,
  testing,
  onTest,
  onNext,
  picking,
  onPick,
}: {
  connectors: readonly Connector[];
  mode: ConnectorMode;
  onModeChange: (mode: ConnectorMode) => void;
  form: RemoteFormState;
  onFormChange: (next: RemoteFormState) => void;
  test: TestState;
  testing: boolean;
  onTest: () => void;
  onNext: () => void;
  picking: string | null;
  onPick: (connector: Connector) => void;
}) {
  const problem = remoteFormProblem(form);
  return (
    <div className="flex flex-col gap-6">
      {/* 내 커넥터가 하나도 없으면 "새 커넥터 등록"만 보인다 */}
      {connectors.length > 0 && (
        <div className="flex flex-col gap-3 sm:flex-row">
          <ChoiceButton active={mode === 'existing'} onClick={() => onModeChange('existing')}>
            <span className="font-medium">내 커넥터에서 고르기</span>
            <span className="text-muted-foreground">이미 등록한 커넥터 {connectors.length}개</span>
          </ChoiceButton>
          <ChoiceButton active={mode === 'new'} onClick={() => onModeChange('new')}>
            <span className="font-medium">새 커넥터 등록</span>
            <span className="text-muted-foreground">원격 MCP 서버나 내장 서비스</span>
          </ChoiceButton>
        </div>
      )}

      {mode === 'existing' ? (
        <ExistingConnectors connectors={connectors} picking={picking} onPick={onPick} />
      ) : (
        <Card>
          <div className="flex flex-col gap-3 sm:flex-row">
            <ChoiceButton active>
              <span className="font-medium">원격 MCP 서버</span>
              <span className="text-muted-foreground">Streamable HTTP 주소와 토큰</span>
            </ChoiceButton>
            {/* 내장 서비스(GA4·Search Console 등)는 마일스톤 4에서 /api/builtins로 채운다 */}
            <ChoiceButton active={false} disabled>
              <span className="flex items-center gap-2 font-medium">
                내장 서비스 <Badge variant="secondary">준비 중</Badge>
              </span>
              <span className="text-muted-foreground">Google Analytics 등</span>
            </ChoiceButton>
          </div>
          <div className="flex flex-col gap-1">
            <CardTitle>원격 MCP 서버</CardTitle>
            <CardDescription>
              연결 테스트로 툴 목록을 받아 와야 다음으로 넘어갑니다. 테스트에 쓴 토큰은 만들기
              전까지 저장하지 않습니다.
            </CardDescription>
          </div>
          <RemoteConnectorFields value={form} onChange={onFormChange} />
          <div className="flex flex-wrap items-center gap-3 border-t pt-4">
            <Button variant="outline" onClick={onTest} disabled={testing || problem !== undefined}>
              {testing ? '테스트 중' : '연결 테스트'}
            </Button>
            {test.status === 'ok' && (
              <p className="flex items-center gap-1 text-sm text-success">
                <CircleCheckIcon className="size-4" />툴 {test.toolCount}개를 찾았습니다
              </p>
            )}
            {test.status === 'failed' && (
              <p role="alert" className="flex items-center gap-1 text-sm text-destructive">
                <CircleXIcon className="size-4" />
                {test.message}
              </p>
            )}
            {test.status === 'idle' && problem && (
              <p className="text-sm text-muted-foreground">{problem}</p>
            )}
            <Button className="ml-auto" onClick={onNext} disabled={test.status !== 'ok'}>
              다음
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

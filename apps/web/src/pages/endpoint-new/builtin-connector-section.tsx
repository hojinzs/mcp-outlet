import { useId } from 'react';
import type { Builtin } from '../../api/types.ts';
import { OAuthAppGuide } from '../../components/builtin/oauth-app-guide.tsx';
import { OAuthClientFields } from '../../components/builtin/oauth-client-fields.tsx';
import { ServiceAccountKeyField } from '../../components/builtin/service-account-key-field.tsx';
import { Button } from '../../components/ui/button.tsx';
import { CardDescription, CardTitle } from '../../components/ui/card.tsx';
import { Input } from '../../components/ui/input.tsx';
import { Label } from '../../components/ui/label.tsx';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs.tsx';
import { authMethodLabel } from '../../features/connectors/builtin.ts';
import {
  type BuiltinAuthType,
  type BuiltinFormState,
  oauthProblem,
  serviceAccountProblem,
  withBuiltin,
} from '../../features/connectors/builtin-form.ts';
import { cn } from '../../lib/utils.ts';
import { TestBar, type TestState } from './connector-step.tsx';

// SCR-EP-02 1단계 "새 커넥터 등록 → 내장 서비스": 서비스 카드 → 접속 방식 탭(authMethods 순서).
// 서비스 계정은 원격처럼 연결 테스트 후 만들기에서 저장하고, OAuth는 커넥터를 먼저 저장한 뒤 동의로 보낸다

function BuiltinCards({
  builtins,
  selected,
  onSelect,
}: {
  builtins: readonly Builtin[];
  selected: string | null;
  onSelect: (builtin: Builtin) => void;
}) {
  if (builtins.length === 0) {
    return <p className="text-sm text-muted-foreground">등록할 수 있는 내장 서비스가 없습니다.</p>;
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {builtins.map((builtin) => (
        <button
          key={builtin.key}
          type="button"
          aria-pressed={selected === builtin.key}
          onClick={() => onSelect(builtin)}
          className={cn(
            'flex flex-col items-start gap-1 rounded-lg border bg-background p-4 text-left text-sm hover:bg-accent',
            selected === builtin.key && 'border-primary ring-1 ring-primary',
          )}
        >
          <span className="font-medium">{builtin.name}</span>
          <span className="text-muted-foreground">{builtin.description}</span>
          <span className="text-xs text-muted-foreground">툴 {builtin.toolCount}개</span>
        </button>
      ))}
    </div>
  );
}

export function BuiltinConnectorSection({
  builtins,
  loadFailed,
  onRetry,
  form,
  onFormChange,
  test,
  testing,
  onTest,
  onNext,
  onConnect,
  connecting,
  connectError,
}: {
  builtins: readonly Builtin[] | undefined;
  loadFailed: boolean;
  onRetry: () => void;
  form: BuiltinFormState;
  onFormChange: (next: BuiltinFormState) => void;
  test: TestState;
  testing: boolean;
  onTest: () => void;
  onNext: () => void;
  onConnect: () => void;
  connecting: boolean;
  connectError: string | null;
}) {
  const id = useId();
  if (loadFailed) {
    return (
      <div className="flex items-center gap-3 text-sm">
        <p className="text-destructive">내장 서비스 목록을 불러오지 못했습니다.</p>
        <Button size="sm" variant="outline" onClick={onRetry}>
          다시 시도
        </Button>
      </div>
    );
  }
  if (!builtins) return <p className="text-sm text-muted-foreground">불러오는 중</p>;

  const builtin = builtins.find((item) => item.key === form.builtin);
  const set = (patch: Partial<BuiltinFormState>) => onFormChange({ ...form, ...patch });
  const oauthBlock = oauthProblem(form);

  return (
    <div className="flex flex-col gap-4">
      <BuiltinCards
        builtins={builtins}
        selected={form.builtin}
        onSelect={(next) => onFormChange(withBuiltin(form, next))}
      />
      {builtin && form.method && (
        <>
          <div className="flex flex-col gap-1">
            <CardTitle>{builtin.name}</CardTitle>
            <CardDescription>
              연결 테스트로 툴 목록을 받아 와야 다음으로 넘어갑니다.
            </CardDescription>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${id}-name`}>커넥터 이름</Label>
            <Input
              id={`${id}-name`}
              maxLength={60}
              value={form.name}
              onChange={(event) => set({ name: event.target.value, nameEdited: true })}
            />
          </div>
          <Tabs
            value={form.method}
            onValueChange={(value) => set({ method: value as BuiltinAuthType })}
            className="flex flex-col gap-4"
          >
            {/* 한 서비스에 방식이 여러 개면 탭으로 고른다. 순서는 gateway가 정한다 */}
            {builtin.authMethods.length > 1 && (
              <TabsList>
                {builtin.authMethods.map((method) => (
                  <TabsTrigger key={method.type} value={method.type}>
                    {authMethodLabel(method)}
                  </TabsTrigger>
                ))}
              </TabsList>
            )}
            {builtin.authMethods.map((method) =>
              method.type === 'service_account' ? (
                <TabsContent key={method.type} value={method.type} className="flex flex-col gap-4">
                  <CardDescription>
                    테스트에 쓴 키는 만들기 전까지 저장하지 않습니다.
                  </CardDescription>
                  <ServiceAccountKeyField
                    builtinKey={builtin.key}
                    value={form.key}
                    onChange={(key) => set({ key })}
                  />
                  <TestBar
                    test={test}
                    testing={testing}
                    problem={serviceAccountProblem(form)}
                    onTest={onTest}
                    onNext={onNext}
                  />
                </TabsContent>
              ) : (
                <TabsContent key={method.type} value={method.type} className="flex flex-col gap-4">
                  <OAuthAppGuide builtinKey={builtin.key} method={method} />
                  <OAuthClientFields
                    value={{ clientId: form.clientId, clientSecret: form.clientSecret }}
                    onChange={(client) => set(client)}
                  />
                  <CardDescription>
                    연결하면 이 커넥터를 "연결 중"으로 먼저 저장하고 {method.provider} 동의 화면으로
                    이동합니다. 돌아오면 연결 테스트로 이어갑니다.
                  </CardDescription>
                  <div className="flex flex-wrap items-center gap-3 border-t pt-4">
                    <Button onClick={onConnect} disabled={connecting || oauthBlock !== undefined}>
                      {connecting ? '이동하는 중' : `${method.provider}로 연결`}
                    </Button>
                    {connectError ? (
                      <p role="alert" className="text-sm text-destructive">
                        {connectError}
                      </p>
                    ) : (
                      oauthBlock && <p className="text-sm text-muted-foreground">{oauthBlock}</p>
                    )}
                  </div>
                </TabsContent>
              ),
            )}
          </Tabs>
        </>
      )}
    </div>
  );
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { ApiError, isApiError } from '../../api/client.ts';
import {
  builtinsQuery,
  connectorsQuery,
  connectorToolsQuery,
  endpointsQuery,
  queryKeys,
  requests,
} from '../../api/queries.ts';
import type {
  ConnectionTestResponse,
  Connector,
  ConnectorRuntime,
  CreateEndpointInput,
  NewConnectorInput,
  OAuthClient,
  Tool,
} from '../../api/types.ts';
import { useOAuthStart } from '../../components/builtin/use-oauth-start.ts';
import { LeaveGuard } from '../../components/leave-guard.tsx';
import { Loading } from '../../components/loading.tsx';
import { PageError } from '../../components/page-error.tsx';
import { ToolSelector } from '../../components/tool-selector.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Card } from '../../components/ui/card.tsx';
import {
  builtinErrorText,
  type ConnectOutcome,
  connectErrorMessages,
  connectOutcome,
  connectorTestMessage,
  isPickable,
  newEndpointReturnTo,
  oauthMethodOf,
  resumeReason,
  withoutConnectOutcome,
} from '../../features/connectors/builtin.ts';
import {
  type BuiltinFormState,
  initialBuiltinForm,
  toOAuthConnectorInput,
  toServiceAccountInput,
} from '../../features/connectors/builtin-form.ts';
import {
  initialRemoteForm,
  type RemoteFormState,
  toRemoteInput,
} from '../../features/connectors/remote-form.ts';
import { serviceNamesByConnector } from '../../features/endpoints/connector-kind.ts';
import { limitExceededText } from '../../features/endpoints/limit.ts';
import { suggestEndpointName } from '../../features/endpoints/naming.ts';
import { keepAvailable } from '../../features/tools/selection.ts';
import { cn } from '../../lib/utils.ts';
import { BuiltinConnectorSection } from './builtin-connector-section.tsx';
import { ConnectorResume } from './connector-resume.tsx';
import {
  type ConnectorMode,
  ConnectorStep,
  type NewConnectorKind,
  type TestState,
} from './connector-step.tsx';
import { NameStep } from './name-step.tsx';

// SCR-EP-02 엔드포인트 추가: 1 커넥터 → 2 툴 → 3 이름.
// 원격 MCP 서버와 서비스 계정 내장 서비스는 만들기를 누를 때 커넥터와 엔드포인트를 한 번에 저장한다.
// OAuth 내장 서비스는 계정 연결 전에 커넥터를 "연결 중"으로 먼저 저장하고, 돌아오면 연결 테스트부터 이어간다

type Step = 1 | 2 | 3;

// 1단계에서 고른 커넥터와 그 툴 목록
type Prepared =
  | { kind: 'existing'; connector: Connector; tools: Tool[] }
  | { kind: 'new'; input: NewConnectorInput; tools: Tool[] };

// 업스트림 동의에서 돌아왔거나 정상이 아닌 커넥터로 들어온 경우 (?connector={id}).
// connector는 들어올 때의 값이다. 화면에는 테스트·저장 뒤 다시 받은 목록의 커넥터를 쓴다
type Resume = { connector: Connector; notice: string | null };

const steps: { step: Step; label: string }[] = [
  { step: 1, label: '커넥터' },
  { step: 2, label: '툴' },
  { step: 3, label: '이름' },
];

function StepIndicator({ current, onGo }: { current: Step; onGo: (step: Step) => void }) {
  return (
    <ol className="flex items-center gap-2 text-sm">
      {steps.map(({ step, label }) => (
        <li key={step} className="flex items-center gap-2">
          {step > 1 && <span className="text-muted-foreground">→</span>}
          {/* 지난 단계로는 언제든 돌아갈 수 있다 */}
          <button
            type="button"
            disabled={step >= current}
            onClick={() => onGo(step)}
            aria-current={step === current ? 'step' : undefined}
            className={cn(
              'flex items-center gap-2 rounded-md px-2 py-1 enabled:hover:bg-accent',
              step === current ? 'font-semibold' : 'text-muted-foreground',
            )}
          >
            <span
              className={cn(
                'flex size-6 items-center justify-center rounded-full border text-xs',
                step <= current && 'border-primary bg-primary text-primary-foreground',
              )}
            >
              {step}
            </span>
            {label}
          </button>
        </li>
      ))}
    </ol>
  );
}

const sameInput = (a: NewConnectorInput, b: NewConnectorInput) =>
  JSON.stringify(a) === JSON.stringify(b);

const runtimeOf = (input: NewConnectorInput): ConnectorRuntime =>
  'builtin' in input ? 'builtin' : 'remote';

function unsavedTestErrorText(error: Error, input: NewConnectorInput): string {
  if (!isApiError(error, 400)) return error.message;
  if ('builtin' in input) return builtinErrorText(error);
  return '주소와 입력값을 확인하세요. https 주소만 등록할 수 있습니다';
}

function resumeTestState(
  runtime: ConnectorRuntime,
  result: ConnectionTestResponse | undefined,
  error: Error | null,
): TestState {
  if (error) return { status: 'failed', message: error.message };
  if (!result) return { status: 'idle' };
  return result.result === 'ok'
    ? { status: 'ok', toolCount: result.tools.length }
    : { status: 'failed', message: connectorTestMessage(runtime, result.result) };
}

export function EndpointNewPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const connectors = useQuery(connectorsQuery);
  const endpoints = useQuery(endpointsQuery);
  const builtins = useQuery(builtinsQuery);

  const [step, setStep] = useState<Step>(1);
  const [mode, setMode] = useState<ConnectorMode | null>(null);
  const [newKind, setNewKind] = useState<NewConnectorKind>('remote');
  const [form, setForm] = useState<RemoteFormState>(initialRemoteForm);
  const [builtinForm, setBuiltinForm] = useState<BuiltinFormState>(initialBuiltinForm);
  const [tested, setTested] = useState<{ input: NewConnectorInput; tools: Tool[] } | null>(null);
  const [testFailure, setTestFailure] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [resume, setResume] = useState<Resume | null>(null);
  // "Google로 연결"로 먼저 저장한 커넥터. 동의로 가지 못했으면 다시 누를 때 새로 만들지 않고 이 커넥터를 쓴다
  const [draftConnector, setDraftConnector] = useState<{ id: string; name: string } | null>(null);
  const [picking, setPicking] = useState<string | null>(null);
  // 처음에는 아무것도 선택하지 않는다. 쓰기 툴이 실수로 노출되지 않게 하기 위해서다
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [name, setName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const oauth = useOAuthStart();

  const connectorList = connectors.data ?? [];
  const resumeConnector = resume
    ? (connectorList.find((connector) => connector.id === resume.connector.id) ?? resume.connector)
    : null;
  const serviceNames = serviceNamesByConnector(connectors.data, builtins.data);
  const endpointIds = endpoints.data
    ? new Map(endpoints.data.map((endpoint) => [endpoint.connector.id, endpoint.id]))
    : undefined;
  const currentMode: ConnectorMode = mode ?? (connectorList.length > 0 ? 'existing' : 'new');
  // OAuth 탭은 저장 전 테스트가 없다
  const formInput: NewConnectorInput | null =
    newKind === 'remote'
      ? toRemoteInput(form)
      : builtinForm.method === 'service_account'
        ? toServiceAccountInput(builtinForm)
        : null;
  // 테스트 뒤에 입력을 바꾸면 다시 테스트해야 한다
  const testValid = tested !== null && formInput !== null && sameInput(tested.input, formInput);
  const test: TestState = testValid
    ? { status: 'ok', toolCount: tested.tools.length }
    : testFailure
      ? { status: 'failed', message: testFailure }
      : { status: 'idle' };

  const runTest = useMutation({
    mutationFn: requests.testUnsavedConnector,
    onMutate: () => {
      setTested(null);
      setTestFailure(null);
    },
    onSuccess: (result, input) => {
      if (result.result === 'ok') setTested({ input, tools: result.tools });
      else setTestFailure(connectorTestMessage(runtimeOf(input), result.result));
    },
    onError: (error, input) => setTestFailure(unsavedTestErrorText(error, input)),
  });

  // 이어가는 커넥터는 저장된 설정으로 테스트한다. 성공하면 상태가 ok가 되고 툴 캐시가 생긴다
  const resumeTest = useMutation({
    mutationFn: requests.retestConnector,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.connectors }),
  });

  // 계정 연결 순서: 커넥터를 "연결 중"으로 먼저 저장하고 동의 화면으로 보낸다
  const oauthCreate = useMutation({
    mutationFn: async () => {
      const input = toOAuthConnectorInput(builtinForm);
      const client: OAuthClient = {
        clientId: input.auth.clientId,
        clientSecret: input.auth.clientSecret,
      };
      // 이미 저장한 커넥터는 지금 입력한 이름과 OAuth 앱으로 동의를 받는다
      if (draftConnector) {
        if (draftConnector.name !== input.name) {
          await requests.updateConnector(draftConnector.id, { name: input.name });
          setDraftConnector({ id: draftConnector.id, name: input.name });
          void queryClient.invalidateQueries({ queryKey: queryKeys.connectors });
        }
        return { connectorId: draftConnector.id, client };
      }
      const connector = await requests.createOAuthConnector(input);
      setDraftConnector({ id: connector.id, name: connector.name });
      void queryClient.invalidateQueries({ queryKey: queryKeys.connectors });
      return { connectorId: connector.id, client: undefined };
    },
    onSuccess: ({ connectorId, client }) =>
      oauth.start.mutate({
        connectorId,
        input: { returnTo: newEndpointReturnTo(connectorId), ...(client ? { client } : {}) },
      }),
  });

  function changeNewKind(kind: NewConnectorKind) {
    setNewKind(kind);
    setTestFailure(null);
  }

  function changeBuiltinForm(next: BuiltinFormState) {
    if (next.builtin !== builtinForm.builtin) {
      setTestFailure(null);
      setDraftConnector(null);
      oauthCreate.reset();
      oauth.start.reset();
    }
    setBuiltinForm(next);
  }

  function goToTools(next: Prepared) {
    setPrepared(next);
    setSelected((current) => keepAvailable(current, next.tools));
    setStep(2);
  }

  // 고르면 연결 테스트 없이 2단계로
  async function pickExisting(connector: Connector) {
    setPicking(connector.id);
    try {
      const tools = await queryClient.fetchQuery(connectorToolsQuery(connector.id));
      if (prepared?.kind !== 'existing' || prepared.connector.id !== connector.id) {
        setSelected(new Set());
      }
      goToTools({ kind: 'existing', connector, tools });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '툴 목록을 불러오지 못했습니다');
    } finally {
      setPicking(null);
    }
  }

  // ?connector={id}: 엔드포인트 상세의 "이 커넥터로 엔드포인트 하나 더", 정상이 아닌 커넥터의
  // "다시 연결·연결 테스트" 링크, 업스트림 동의 뒤 복귀. 같은 화면 안에서 id가 바뀌어도 다시 처리한다.
  // 복귀 결과(connected·connect_error)는 처음 들어온 커넥터에만 쓰고 쿼리에서 지운다
  const presetId = params.get('connector');
  const [outcome] = useState<ConnectOutcome | null>(() => connectOutcome(params));
  const handledPreset = useRef<string | null>(null);
  const outcomeRead = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 목록을 받은 뒤 커넥터 id마다 한 번만 처리한다
  useEffect(() => {
    if (!presetId || !connectors.data || handledPreset.current === presetId) return;
    handledPreset.current = presetId;
    const returned = outcomeRead.current ? null : outcome;
    outcomeRead.current = true;
    if (returned !== null) setParams(withoutConnectOutcome(params), { replace: true });
    const connector = connectors.data.find((item) => item.id === presetId);
    if (!connector || connector.disabledAt !== null) return;
    // 정상 커넥터는 연결 테스트 없이 2단계로
    if (isPickable(connector) && returned === null) {
      void pickExisting(connector);
      return;
    }
    // 연결 중·오류·재연결 필요는 이어하기 화면에서 다시 연결·연결 테스트한다 (SCR-EP-02 결정 사항)
    resumeTest.reset();
    oauth.start.reset();
    setResume({
      connector,
      notice: returned === null || returned === 'connected' ? null : connectErrorMessages[returned],
    });
    if (returned === 'connected') resumeTest.mutate(connector.id);
  }, [presetId, connectors.data]);

  function nextFromResume() {
    if (!resumeConnector || resumeTest.data?.result !== 'ok') return;
    if (prepared?.kind !== 'existing' || prepared.connector.id !== resumeConnector.id) {
      setSelected(new Set());
    }
    goToTools({ kind: 'existing', connector: resumeConnector, tools: resumeTest.data.tools });
  }

  function reconnect(client?: OAuthClient) {
    if (!resume) return;
    const connectorId = resume.connector.id;
    oauth.start.mutate({
      connectorId,
      input: {
        returnTo: newEndpointReturnTo(connectorId),
        ...(client
          ? {
              client: {
                clientId: client.clientId.trim(),
                clientSecret: client.clientSecret.trim(),
              },
            }
          : {}),
      },
    });
  }

  function startOver() {
    // 같은 커넥터의 링크를 다시 누르면 이어하기 화면을 다시 연다
    handledPreset.current = null;
    setParams(new URLSearchParams(), { replace: true });
    setResume(null);
    resumeTest.reset();
    oauth.start.reset();
    setMode('new');
  }

  function nextFromNewConnector() {
    if (!testValid) return;
    if (prepared?.kind !== 'new' || !sameInput(prepared.input, tested.input)) {
      setSelected(new Set());
    }
    goToTools({ kind: 'new', input: tested.input, tools: tested.tools });
  }

  function goToName() {
    if (!prepared) return;
    const base = prepared.kind === 'existing' ? prepared.connector.name : prepared.input.name;
    setName(
      suggestEndpointName(
        base,
        (endpoints.data ?? []).map((endpoint) => endpoint.name),
      ),
    );
    setCreateError(null);
    setStep(3);
  }

  // 저장 직전에 커넥터 툴 목록이 바뀌었으면 다시 불러와 2단계로 (SCR-EP-02 오류)
  async function reloadTools(current: Prepared) {
    const result =
      current.kind === 'existing'
        ? await requests.retestConnector(current.connector.id)
        : await requests.testUnsavedConnector(current.input);
    if (result.result !== 'ok') {
      setTestFailure(connectorTestMessage(preparedRuntime(current), result.result));
      setStep(1);
      return;
    }
    goToTools({ ...current, tools: result.tools });
    toast.warning('커넥터의 툴 목록이 바뀌었습니다. 노출할 툴을 다시 확인하세요');
  }

  const create = useMutation({
    mutationFn: requests.createEndpoint,
    onSuccess: async (endpoint) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.endpoints });
      await queryClient.invalidateQueries({ queryKey: queryKeys.connectors });
      // 이탈 확인을 끈 뒤에 이동한다
      flushSync(() => setDone(true));
      navigate(`/endpoints/${endpoint.id}/connect?created=1`);
    },
    onError: async (error) => {
      if (!prepared) return;
      if (isApiError(error, 409) && error.code === 'tools_changed') {
        await reloadTools(prepared).catch(() =>
          setCreateError('툴 목록을 다시 불러오지 못했습니다'),
        );
        return;
      }
      if (error instanceof ApiError && error.code === 'connection_test_failed') {
        setTestFailure(
          connectorTestMessage(preparedRuntime(prepared), String(error.details?.result ?? '')),
        );
        setStep(1);
        return;
      }
      setCreateError(limitExceededText(error) ?? error.message);
    },
  });

  function submit() {
    if (!prepared) return;
    const base = { name: name.trim(), allowedTools: [...selected] };
    const input: CreateEndpointInput =
      prepared.kind === 'existing'
        ? { ...base, connectorId: prepared.connector.id }
        : { ...base, connector: prepared.input };
    setCreateError(null);
    create.mutate(input);
  }

  if (connectors.isPending) return <Loading />;
  if (connectors.isError) {
    return <PageError error={connectors.error} onRetry={() => connectors.refetch()} />;
  }

  const dirty =
    step > 1 ||
    JSON.stringify(form) !== JSON.stringify(initialRemoteForm) ||
    JSON.stringify(builtinForm) !== JSON.stringify(initialBuiltinForm);
  const connectorName = prepared
    ? prepared.kind === 'existing'
      ? prepared.connector.name
      : prepared.input.name
    : '';
  const connectError = oauthCreate.error ?? oauth.start.error;
  const resumeBuiltin = builtins.data?.find((builtin) => builtin.key === resumeConnector?.builtin);

  return (
    <div className="flex flex-col gap-6">
      {/* 업스트림 동의 화면으로 보낼 때는 막지 않는다 */}
      <LeaveGuard when={dirty && !done && !oauth.redirecting} message="만들던 내용이 사라집니다." />
      <div className="flex flex-col gap-3">
        <Link to="/" className="text-sm text-muted-foreground hover:underline">
          ← 내 엔드포인트
        </Link>
        <h1 className="text-2xl font-semibold">엔드포인트 추가</h1>
        <StepIndicator current={step} onGo={setStep} />
      </div>

      {step === 1 && resume && resumeConnector && (
        <ConnectorResume
          connector={resumeConnector}
          serviceName={resumeBuiltin?.name ?? null}
          oauthMethod={oauthMethodOf(resumeBuiltin)}
          notice={resume.notice}
          reason={resumeReason(resumeConnector, resumeTest.data?.result)}
          test={resumeTestState(resumeConnector.runtime, resumeTest.data, resumeTest.error)}
          testing={resumeTest.isPending}
          onTest={() => resumeTest.mutate(resumeConnector.id)}
          onNext={nextFromResume}
          onReconnect={reconnect}
          reconnecting={oauth.start.isPending || oauth.redirecting}
          reconnectError={oauth.start.error ? builtinErrorText(oauth.start.error) : null}
          onStartOver={startOver}
          // 저장은 테스트를 통과해야 끝나지만 2단계에 쓸 툴 목록은 테스트 결과로 받는다
          onSaved={() => resumeTest.mutate(resumeConnector.id)}
        />
      )}

      {step === 1 && !resume && (
        <ConnectorStep
          connectors={connectorList}
          serviceNames={serviceNames}
          endpointIds={endpointIds}
          mode={currentMode}
          onModeChange={setMode}
          newKind={newKind}
          onNewKindChange={changeNewKind}
          form={form}
          onFormChange={setForm}
          builtinPanel={
            <BuiltinConnectorSection
              builtins={builtins.data}
              loadFailed={builtins.isError}
              onRetry={() => builtins.refetch()}
              form={builtinForm}
              onFormChange={changeBuiltinForm}
              test={test}
              testing={runTest.isPending}
              onTest={() => formInput && runTest.mutate(formInput)}
              onNext={nextFromNewConnector}
              onConnect={() => oauthCreate.mutate()}
              connecting={oauthCreate.isPending || oauth.start.isPending || oauth.redirecting}
              connectError={connectError ? builtinErrorText(connectError) : null}
            />
          }
          test={test}
          testing={runTest.isPending}
          onTest={() => formInput && runTest.mutate(formInput)}
          onNext={nextFromNewConnector}
          picking={picking}
          onPick={pickExisting}
        />
      )}

      {step === 2 && prepared && (
        <Card>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{connectorName}</span>에서 AI에 보여줄
            툴을 고르세요. 고르지 않은 툴은 보이지도, 호출되지도 않습니다.
          </p>
          <ToolSelector tools={prepared.tools} selected={selected} onChange={setSelected} />
          <div className="flex justify-between border-t pt-4">
            <Button variant="outline" onClick={() => setStep(1)}>
              이전
            </Button>
            <Button onClick={goToName} disabled={selected.size === 0}>
              다음
            </Button>
          </div>
        </Card>
      )}

      {step === 3 && prepared && (
        <NameStep
          name={name}
          onNameChange={setName}
          connectorName={connectorName}
          tools={prepared.tools}
          selected={selected}
          error={createError}
          creating={create.isPending}
          onBack={() => setStep(2)}
          onCreate={submit}
        />
      )}
    </div>
  );
}

function preparedRuntime(prepared: Prepared): ConnectorRuntime {
  return prepared.kind === 'existing' ? prepared.connector.runtime : runtimeOf(prepared.input);
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { ApiError, isApiError } from '../../api/client.ts';
import {
  connectorsQuery,
  connectorToolsQuery,
  endpointsQuery,
  queryKeys,
  requests,
} from '../../api/queries.ts';
import type {
  Connector,
  CreateEndpointInput,
  RemoteConnectorInput,
  Tool,
} from '../../api/types.ts';
import { LeaveGuard } from '../../components/leave-guard.tsx';
import { Loading } from '../../components/loading.tsx';
import { PageError } from '../../components/page-error.tsx';
import { ToolSelector } from '../../components/tool-selector.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Card } from '../../components/ui/card.tsx';
import {
  connectionTestMessage,
  initialRemoteForm,
  type RemoteFormState,
  toRemoteInput,
} from '../../features/connectors/remote-form.ts';
import { suggestEndpointName } from '../../features/endpoints/naming.ts';
import { keepAvailable } from '../../features/tools/selection.ts';
import { cn } from '../../lib/utils.ts';
import { type ConnectorMode, ConnectorStep, type TestState } from './connector-step.tsx';
import { NameStep } from './name-step.tsx';

// SCR-EP-02 엔드포인트 추가: 1 커넥터 → 2 툴 → 3 이름.
// 원격 MCP 서버는 만들기를 누를 때 커넥터와 엔드포인트를 한 번에 저장한다. 중간에 떠나면 아무것도 남지 않는다

type Step = 1 | 2 | 3;

// 1단계에서 고른 커넥터와 그 툴 목록
type Prepared =
  | { kind: 'existing'; connector: Connector; tools: Tool[] }
  | { kind: 'new'; input: RemoteConnectorInput; tools: Tool[] };

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

const sameInput = (a: RemoteConnectorInput, b: RemoteConnectorInput) =>
  JSON.stringify(a) === JSON.stringify(b);

export function EndpointNewPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const connectors = useQuery(connectorsQuery);
  const endpoints = useQuery(endpointsQuery);

  const [step, setStep] = useState<Step>(1);
  const [mode, setMode] = useState<ConnectorMode | null>(null);
  const [form, setForm] = useState<RemoteFormState>(initialRemoteForm);
  const [tested, setTested] = useState<{ input: RemoteConnectorInput; tools: Tool[] } | null>(null);
  const [testFailure, setTestFailure] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [picking, setPicking] = useState<string | null>(null);
  // 처음에는 아무것도 선택하지 않는다. 쓰기 툴이 실수로 노출되지 않게 하기 위해서다
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [name, setName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const connectorList = connectors.data ?? [];
  const currentMode: ConnectorMode = mode ?? (connectorList.length > 0 ? 'existing' : 'new');
  const formInput = toRemoteInput(form);
  // 테스트 뒤에 입력을 바꾸면 다시 테스트해야 한다
  const testValid = tested !== null && sameInput(tested.input, formInput);
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
      else setTestFailure(connectionTestMessage(result.result));
    },
    onError: (error) => {
      setTestFailure(
        isApiError(error, 400)
          ? '주소와 입력값을 확인하세요. https 주소만 등록할 수 있습니다'
          : error.message,
      );
    },
  });

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

  // 엔드포인트 상세의 "이 커넥터로 엔드포인트 하나 더" (?connector={id})
  const presetId = params.get('connector');
  // biome-ignore lint/correctness/useExhaustiveDependencies: 목록을 받은 뒤 한 번만 고른다
  useEffect(() => {
    if (!presetId || !connectors.data || prepared) return;
    const connector = connectors.data.find((item) => item.id === presetId);
    if (connector && connector.disabledAt === null) void pickExisting(connector);
  }, [presetId, connectors.data]);

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
      setTestFailure(connectionTestMessage(result.result));
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
        setTestFailure(connectionTestMessage(String(error.details?.result ?? '')));
        setStep(1);
        return;
      }
      setCreateError(error.message);
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

  const dirty = step > 1 || JSON.stringify(form) !== JSON.stringify(initialRemoteForm);
  const connectorName = prepared
    ? prepared.kind === 'existing'
      ? prepared.connector.name
      : prepared.input.name
    : '';

  return (
    <div className="flex flex-col gap-6">
      <LeaveGuard when={dirty && !done} message="만들던 내용이 사라집니다." />
      <div className="flex flex-col gap-3">
        <Link to="/" className="text-sm text-muted-foreground hover:underline">
          ← 내 엔드포인트
        </Link>
        <h1 className="text-2xl font-semibold">엔드포인트 추가</h1>
        <StepIndicator current={step} onGo={setStep} />
      </div>

      {step === 1 && (
        <ConnectorStep
          connectors={connectorList}
          mode={currentMode}
          onModeChange={setMode}
          form={form}
          onFormChange={setForm}
          test={test}
          testing={runTest.isPending}
          onTest={() => runTest.mutate(formInput)}
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

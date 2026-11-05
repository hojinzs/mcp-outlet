import { useQuery } from '@tanstack/react-query';
import { CircleCheckIcon, EyeIcon, EyeOffIcon } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { connectInfoQuery, endpointQuery, requests } from '../api/queries.ts';
import { CopyButton } from '../components/copy-button.tsx';
import { Loading } from '../components/loading.tsx';
import { PageError } from '../components/page-error.tsx';
import { Button } from '../components/ui/button.tsx';
import { Card, CardTitle } from '../components/ui/card.tsx';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs.tsx';
import { claudeCodeCommand } from '../features/endpoints/connect-guide.ts';

// SCR-EP-04 연결 안내. callback 주소는 사용자가 입력할 값이 아니라서 보여주지 않는다

function ValueRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[8rem_1fr] sm:items-center sm:gap-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 items-center gap-2">{children}</dd>
    </div>
  );
}

// 보기·복사를 누를 때마다 따로 요청한다. gateway가 그때마다 작업 기록을 남긴다
function ClientSecretValue() {
  const [secret, setSecret] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function fetchSecret() {
    return (await requests.connectSecret()).clientSecret;
  }

  async function toggle() {
    if (secret !== null) {
      setSecret(null);
      return;
    }
    setLoading(true);
    try {
      setSecret(await fetchSecret());
    } catch {
      toast.error('Client Secret을 불러오지 못했습니다');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-3 py-2 font-mono text-sm">
        {secret ?? '••••••••••••••••'}
      </code>
      <Button
        variant="outline"
        size="icon-sm"
        onClick={toggle}
        disabled={loading}
        aria-label={secret === null ? 'Client Secret 보기' : 'Client Secret 가리기'}
      >
        {secret === null ? <EyeIcon /> : <EyeOffIcon />}
      </Button>
      <CopyButton getValue={fetchSecret} label="Client Secret 복사" />
    </>
  );
}

function CodeValue({ value }: { value: string }) {
  return (
    <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-3 py-2 font-mono text-sm">
      {value}
    </code>
  );
}

function Steps({ items }: { items: ReactNode[] }) {
  return (
    <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm">
      {items.map((item, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 고정된 절차 목록이다
        <li key={index}>{item}</li>
      ))}
    </ol>
  );
}

export function EndpointConnectPage() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const info = useQuery(connectInfoQuery(id));
  const endpoint = useQuery(endpointQuery(id));

  if (info.isPending || endpoint.isPending) return <Loading />;
  if (info.isError || endpoint.isError) {
    return (
      <PageError
        error={info.error ?? endpoint.error}
        onRetry={() => {
          void info.refetch();
          void endpoint.refetch();
        }}
      />
    );
  }

  const { url, clientId, hasClientSecret } = info.data;
  const toolCount = endpoint.data.toolCounts.allowed;
  const secretStep = hasClientSecret ? 'Client ID와 Client Secret' : 'Client ID';
  const closing = `연결이 되면 이 엔드포인트에서 고른 툴 ${toolCount}개가 보입니다.`;
  const command = claudeCodeCommand({ name: endpoint.data.name, url, clientId, hasClientSecret });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Link to={`/endpoints/${id}`} className="text-sm text-muted-foreground hover:underline">
          ← {endpoint.data.name}
        </Link>
        <h1 className="text-2xl font-semibold">연결 안내</h1>
      </div>

      {params.get('created') === '1' && (
        <p className="flex items-center gap-2 rounded-lg border border-success/40 bg-success/10 p-4 text-sm">
          <CircleCheckIcon className="size-4 text-success" />
          엔드포인트를 만들었습니다. 아래 값으로 AI 클라이언트에 등록하세요.
        </p>
      )}

      <Card>
        <CardTitle>연결 값</CardTitle>
        <dl className="flex flex-col gap-3">
          <ValueRow label="엔드포인트 URL">
            <CodeValue value={url} />
            <CopyButton value={url} label="엔드포인트 URL 복사" />
          </ValueRow>
          <ValueRow label="Client ID">
            <CodeValue value={clientId} />
            <CopyButton value={clientId} label="Client ID 복사" />
          </ValueRow>
          {/* Public client 설치면 secret 줄을 숨긴다 */}
          {hasClientSecret && (
            <ValueRow label="Client Secret">
              <ClientSecretValue />
            </ValueRow>
          )}
        </dl>
      </Card>

      <Card>
        <CardTitle>등록 절차</CardTitle>
        <Tabs defaultValue="claude" className="flex flex-col gap-4">
          <TabsList>
            <TabsTrigger value="claude">Claude</TabsTrigger>
            <TabsTrigger value="chatgpt">ChatGPT</TabsTrigger>
            <TabsTrigger value="claude-code">Claude Code</TabsTrigger>
          </TabsList>
          <TabsContent value="claude" className="flex flex-col gap-3">
            <Steps
              items={[
                '사용자 지정 → 커넥터에서 커넥터 추가 → 커스텀 커넥터 추가를 엽니다.',
                '이름을 정하고 MCP 서버 URL에 엔드포인트 URL을 넣은 뒤 계속을 누릅니다.',
                `인증은 지금 로그인, OAuth 클라이언트는 자체 OAuth 클라이언트 사용을 고르고 ${secretStep}를 넣은 뒤 추가를 누릅니다.`,
                '연결을 누르고 로그인 화면에서 회사 계정으로 로그인합니다.',
              ]}
            />
            <p className="text-sm text-muted-foreground">{closing}</p>
          </TabsContent>
          <TabsContent value="chatgpt" className="flex flex-col gap-3">
            <Steps
              items={[
                '설정 → 앱 및 커넥터 → 고급 설정에서 개발자 모드(Developer mode)를 켭니다.',
                '커넥터 만들기를 누르고 MCP 서버 URL에 엔드포인트 URL을 넣습니다.',
                `인증은 OAuth로 고르고 ${secretStep}를 넣습니다.`,
                '만들기를 누르고 로그인 화면에서 회사 계정으로 로그인합니다.',
              ]}
            />
            <p className="text-sm text-muted-foreground">{closing}</p>
          </TabsContent>
          <TabsContent value="claude-code" className="flex flex-col gap-3">
            <p className="text-sm">터미널에서 아래 명령을 실행합니다.</p>
            <div className="flex items-start gap-2">
              <pre className="min-w-0 flex-1 rounded-md bg-muted p-3 font-mono text-xs break-all whitespace-pre-wrap">
                {command}
              </pre>
              <CopyButton value={command} label="명령 복사" />
            </div>
            {hasClientSecret && (
              <p className="text-sm text-muted-foreground">
                명령을 실행하면 Client Secret을 묻습니다. 위의 Client Secret을 붙여 넣으세요.
              </p>
            )}
            <p className="text-sm text-muted-foreground">
              Claude Code에서 /mcp로 이 서버를 골라 인증하면 브라우저에서 로그인합니다. {closing}
            </p>
          </TabsContent>
        </Tabs>
        <p className="text-xs text-muted-foreground">
          Claude 화면과 Claude Code 명령은 2026-11-05에 확인했습니다. 메뉴 이름은 바뀔 수 있습니다.
        </p>
      </Card>

      <Card className="gap-0 p-0">
        <details>
          <summary className="cursor-pointer px-5 py-4 font-semibold">문제 해결</summary>
          <dl className="flex flex-col gap-4 border-t px-5 py-4 text-sm">
            <div>
              <dt className="font-medium">로그인 후 "권한 없음"이 나옵니다</dt>
              <dd className="text-muted-foreground">
                MCP Outlet 사용 그룹에 속해 있는지 관리자에게 확인하세요.
              </dd>
            </div>
            <div>
              <dt className="font-medium">연결은 되는데 툴이 안 보입니다</dt>
              <dd className="text-muted-foreground">
                엔드포인트가 비활성인지, 노출 툴을 골랐는지{' '}
                <Link to={`/endpoints/${id}`} className="underline">
                  엔드포인트 상세
                </Link>
                에서 확인하세요.
              </dd>
            </div>
            <div>
              <dt className="font-medium">다른 사람에게 주소를 공유했습니다</dt>
              <dd className="text-muted-foreground">
                엔드포인트는 만든 사람 계정으로만 호출됩니다. 각자 엔드포인트를 만들어야 합니다.
              </dd>
            </div>
          </dl>
        </details>
      </Card>
    </div>
  );
}

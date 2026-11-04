import { useEffect } from 'react';
import { Link } from 'react-router';
import { ApiError } from '../api/client.ts';
import { pageErrorKind, pageErrorText } from '../lib/page-error.ts';
import { CopyButton } from './copy-button.tsx';
import { Loading } from './loading.tsx';
import { Button } from './ui/button.tsx';

// SCR-COM-04 오류 화면. 레이아웃 안 본문 자리에 그린다. 오류 원문·스택은 보여주지 않는다
export function PageError({
  error,
  onRetry,
  retrying = false,
}: {
  error: unknown;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  const kind = pageErrorKind(error);

  // 연결 끊김은 다시 온라인이 되면 한 번 자동으로 다시 시도한다
  useEffect(() => {
    if (kind !== 'offline' || !onRetry) return;
    window.addEventListener('online', onRetry, { once: true });
    return () => window.removeEventListener('online', onRetry);
  }, [kind, onRetry]);

  if (kind === 'redirecting') return <Loading />;
  const text = pageErrorText[kind];
  const requestId = kind === 'server' && error instanceof ApiError ? error.requestId : undefined;

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-16 text-center">
      <h1 className="text-xl font-semibold">{text.title}</h1>
      <p className="text-sm text-muted-foreground">{text.description}</p>
      {requestId && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>
            요청 번호 <code className="font-mono">{requestId}</code>
          </span>
          <CopyButton value={requestId} label="요청 번호 복사" />
        </div>
      )}
      <div className="flex gap-2 pt-2">
        {kind !== 'not_found' && onRetry && (
          <Button onClick={onRetry} disabled={retrying}>
            다시 시도
          </Button>
        )}
        {kind !== 'offline' && (
          <Button variant={kind === 'not_found' ? 'default' : 'outline'} asChild>
            <Link to="/">{kind === 'not_found' ? '엔드포인트 목록으로' : '홈으로'}</Link>
          </Button>
        )}
      </div>
    </div>
  );
}

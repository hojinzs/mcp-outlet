import { TriangleAlertIcon } from 'lucide-react';
import type { BuiltinAuthMethod } from '../../api/types.ts';
import { builtinGuide } from '../../features/connectors/builtin.ts';
import { CopyButton } from '../copy-button.tsx';

type OAuthMethod = Extract<BuiltinAuthMethod, { type: 'oauth2' }>;

// 외부(External) 앱을 테스트 상태로 두면 refresh token이 7일 뒤 만료된다 (SCR-EP-02 내장 서비스)
export function OAuthExpiryWarning() {
  return (
    <p className="flex items-start gap-2 rounded-md bg-warning/10 p-3 text-sm">
      <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-warning" />
      외부(External) 앱을 테스트 상태로 두면 refresh token이 7일 뒤 만료되어 다시 연결해야 합니다.
      Workspace 내부 앱으로 만들거나 앱을 게시하세요.
    </p>
  );
}

// 내 OAuth 앱 등록 안내와 리디렉션 URI (SCR-EP-02 계정 연결 ①)
export function OAuthAppGuide({ builtinKey, method }: { builtinKey: string; method: OAuthMethod }) {
  return (
    <div className="flex flex-col gap-3 text-sm">
      <ol className="flex list-decimal flex-col gap-1 pl-5 text-muted-foreground">
        <li>{method.provider} Cloud 콘솔에서 OAuth 동의 화면을 설정합니다.</li>
        <li>
          OAuth 클라이언트를 "웹 애플리케이션" 유형으로 만들고 아래 리디렉션 URI를 승인된 리디렉션
          URI에 넣습니다.
        </li>
        <li>{builtinGuide(builtinKey).oauthApis}를 사용 설정합니다.</li>
      </ol>
      <div className="flex flex-col gap-1">
        <span className="font-medium">리디렉션 URI</span>
        <div className="flex min-w-0 items-center gap-2">
          <code className="truncate rounded-md bg-muted px-2 py-1 font-mono text-xs">
            {method.redirectUri}
          </code>
          <CopyButton value={method.redirectUri} label="리디렉션 URI 복사" />
        </div>
      </div>
      <OAuthExpiryWarning />
    </div>
  );
}

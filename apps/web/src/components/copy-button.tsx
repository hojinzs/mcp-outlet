import { CopyIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from './ui/button.tsx';

// 값을 클립보드에 넣고 "복사했습니다" 토스트를 띄운다. 값을 늦게 받아야 하면 getValue를 넘긴다
export function CopyButton({
  value,
  getValue,
  label = '복사',
  disabled,
}: {
  value?: string;
  getValue?: () => Promise<string>;
  label?: string;
  disabled?: boolean;
}) {
  async function copy() {
    try {
      const text = getValue ? await getValue() : (value ?? '');
      await navigator.clipboard.writeText(text);
      toast.success('복사했습니다');
    } catch {
      toast.error('복사하지 못했습니다');
    }
  }
  return (
    <Button variant="outline" size="icon-sm" onClick={copy} disabled={disabled} aria-label={label}>
      <CopyIcon />
    </Button>
  );
}

import { LoaderCircleIcon } from 'lucide-react';

export function Loading({ label = '불러오는 중' }: { label?: string }) {
  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground"
    >
      <LoaderCircleIcon className="size-4 animate-spin" />
      {label}
    </div>
  );
}

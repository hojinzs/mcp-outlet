import { useEffect } from 'react';
import { useBlocker } from 'react-router';
import { Button } from './ui/button.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from './ui/dialog.tsx';

// 저장하지 않은 내용이 있을 때 다른 화면으로 가거나 창을 닫으면 확인을 띄운다 (SCR-EP-02·03)
export function LeaveGuard({ when, message }: { when: boolean; message: string }) {
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      when && currentLocation.pathname !== nextLocation.pathname,
  );

  useEffect(() => {
    if (!when) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [when]);

  return (
    <Dialog
      open={blocker.state === 'blocked'}
      onOpenChange={(open) => {
        if (!open) blocker.reset?.();
      }}
    >
      <DialogContent>
        <DialogTitle>이 화면을 떠날까요?</DialogTitle>
        <DialogDescription>{message}</DialogDescription>
        <DialogFooter>
          <Button variant="outline" onClick={() => blocker.reset?.()}>
            머무르기
          </Button>
          <Button variant="destructive" onClick={() => blocker.proceed?.()}>
            떠나기
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

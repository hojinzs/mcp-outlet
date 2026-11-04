import { Toaster as Sonner } from 'sonner';

// 저장·복사·삭제 결과를 3초간 표시한다 (SCR-COM-01 알림 영역)
export function Toaster() {
  return <Sonner position="bottom-right" duration={3000} richColors />;
}

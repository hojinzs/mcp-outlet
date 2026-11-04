// 날짜·시각 표시. 브라우저 시간대 기준
const dateTime = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' });
const dateTimeSeconds = new Intl.DateTimeFormat('ko-KR', {
  dateStyle: 'short',
  timeStyle: 'medium',
});

export function formatDateTime(value: string | null | undefined): string {
  return value ? dateTime.format(new Date(value)) : '-';
}

export function formatCallTime(value: string): string {
  return dateTimeSeconds.format(new Date(value));
}

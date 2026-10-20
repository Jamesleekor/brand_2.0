const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** datetime-local has no time zone; this field always represents Korean time. */
export function toKstDateTimeInput(date: Date | string | number = new Date()): string {
  const value = date instanceof Date ? date : new Date(date);
  return Number.isFinite(value.getTime())
    ? new Date(value.getTime() + KST_OFFSET_MS).toISOString().slice(0, 16)
    : '';
}

export function parseKstDateTimeInput(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const date = new Date(`${value}:00+09:00`);
  // Reject rolled-over dates such as February 31 instead of silently changing them.
  return Number.isFinite(date.getTime()) && toKstDateTimeInput(date) === value
    ? date.toISOString()
    : null;
}

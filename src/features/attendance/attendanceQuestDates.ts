// =====================================================================
// 출석·일일퀘스트 기록 창 — 날짜 계산 (명세 5장)
// 모든 날짜는 'YYYY-MM-DD' 문자열(한국 날짜)로 다룬다.
// new Date('YYYY-MM-DD')의 로컬 시간 변환을 쓰지 않고, UTC 기준 civil date로만 계산한다.
// =====================================================================

export interface Ymd {
  y: number;
  m: number;
  d: number;
}

export function parseYmd(value: string): Ymd {
  const [y, m, d] = value.split('-').map((part) => Number(part));
  return { y, m, d };
}

export function toYmd(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function addDays(value: string, days: number): string {
  const { y, m, d } = parseYmd(value);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return toYmd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

/** 0=일 … 6=토 */
export function weekdayIndex(value: string): number {
  const { y, m, d } = parseYmd(value);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** ISO 주의 월요일 */
export function mondayOf(value: string): string {
  const wd = weekdayIndex(value);
  return addDays(value, wd === 0 ? -6 : 1 - wd);
}

export function monthStartOf(value: string): string {
  const { y, m } = parseYmd(value);
  return toYmd(y, m, 1);
}

export function addMonths(monthStart: string, delta: number): string {
  const { y, m } = parseYmd(monthStart);
  const index = y * 12 + (m - 1) + delta;
  return toYmd(Math.floor(index / 12), (index % 12) + 1, 1);
}

export function clampDate(value: string, min: string, max: string): string {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

export function isWeekend(value: string): boolean {
  const wd = weekdayIndex(value);
  return wd === 0 || wd === 6;
}

const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'];

export function weekdayKo(value: string): string {
  return WEEKDAY_KO[weekdayIndex(value)];
}

/** 11.10 */
export function formatMd(value: string): string {
  const { m, d } = parseYmd(value);
  return `${m}.${d}`;
}

/** 주 제목: 11.9~11.13 / 11.30~12.4 / 2026.12.28~2027.1.1 */
export function formatWeekRange(start: string, end: string): string {
  const a = parseYmd(start);
  const b = parseYmd(end);
  if (a.y !== b.y) return `${a.y}.${a.m}.${a.d}~${b.y}.${b.m}.${b.d}`;
  return `${a.m}.${a.d}~${b.m}.${b.d}`;
}

export function formatMonthTitle(monthStart: string): string {
  const { y, m } = parseYmd(monthStart);
  return `${y}년 ${m}월`;
}

export interface NavBounds {
  rangeStart: string; // 조회 범위 첫날
  rangeEnd: string; // 조회 범위 마지막 날
  today: string; // 서버 한국 날짜
  earliestMonth: string;
  latestMonth: string;
}

/** 선택 가능한 마지막 날: min(오늘, 범위 끝) */
export function latestSelectable(bounds: NavBounds): string {
  return bounds.today < bounds.rangeEnd ? bounds.today : bounds.rangeEnd;
}

/** 오늘 버튼·첫 열기: 오늘을 범위 안으로 제한 */
export function defaultSelectedDate(bounds: NavBounds): string {
  return clampDate(bounds.today, bounds.rangeStart, bounds.rangeEnd);
}

/**
 * 월 이동(명세 5.2): preferredDay를 보존하며 대상 말일로 clamp.
 * 오늘 이후·범위 밖이면 제한하되 preferredDay 자체는 바꾸지 않는다.
 * 이동할 수 없으면 null.
 */
export function moveMonth(viewMonth: string, delta: number, preferredDay: number, bounds: NavBounds): string | null {
  const target = addMonths(viewMonth, delta);
  if (target < bounds.earliestMonth || target > bounds.latestMonth) return null;
  const { y, m } = parseYmd(target);
  const candidate = toYmd(y, m, Math.min(preferredDay, daysInMonth(y, m)));
  const lastInMonth = toYmd(y, m, daysInMonth(y, m));
  const upper = latestSelectable(bounds) < lastInMonth ? latestSelectable(bounds) : lastInMonth;
  const lower = bounds.rangeStart > target ? bounds.rangeStart : target;
  return clampDate(candidate, lower, upper);
}

/**
 * 주 이동(명세 5.2): 선택일을 ±7일 이동해 요일을 보존한다.
 * 미래 주로는 이동하지 않고, 현재 주에 들어오면 오늘 이후는 오늘로 제한한다.
 * 범위 밖 주로는 이동하지 않는다. 이동할 수 없으면 null.
 */
export function moveWeek(selected: string, delta: number, bounds: NavBounds): string | null {
  const moved = addDays(selected, delta * 7);
  const maxDate = latestSelectable(bounds);
  if (mondayOf(moved) > mondayOf(maxDate)) return null;
  if (addDays(mondayOf(moved), 6) < bounds.rangeStart) return null;
  return clampDate(moved, bounds.rangeStart, maxDate);
}

export function canMoveWeek(selected: string, delta: number, bounds: NavBounds): boolean {
  return moveWeek(selected, delta, bounds) !== null;
}

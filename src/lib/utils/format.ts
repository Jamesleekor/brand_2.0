// =====================================================================
// B.R.A.N.D 2.0 — 포맷 헬퍼
// Stage 6-A · 생성일 2026-05-20
// =====================================================================
// 숫자·날짜·금액 등 표시 형식 통일.
// =====================================================================

// =====================================================================
// 1. 숫자 포맷
// =====================================================================

/**
 * 천 단위 콤마 (한국 관습)
 * 
 * @example
 *   formatNumber(1480)    // "1,480"
 *   formatNumber(12500)   // "12,500"
 *   formatNumber(0)       // "0"
 */
export function formatNumber(n: number): string {
  return new Intl.NumberFormat('ko-KR').format(n);
}

/**
 * 화폐 단위 포함 (BV·골드·크리스탈)
 * 
 * @example
 *   formatCurrency(1480, 'BV')        // "1,480 BV"
 *   formatCurrency(2450, 'GOLD')      // "2,450 골드"
 */
export function formatCurrency(
  n: number,
  token: 'GOLD' | 'BV' | 'CRYSTAL'
): string {
  const unit = token === 'BV' ? 'BV' : token === 'GOLD' ? '골드' : '크리스탈';
  return `${formatNumber(n)} ${unit}`;
}

/**
 * 부호 포함 변화량 (+/-)
 * 
 * @example
 *   formatDelta(50)     // "+50"
 *   formatDelta(-30)    // "-30"
 *   formatDelta(0)      // "0"
 */
export function formatDelta(n: number): string {
  if (n > 0) return `+${formatNumber(n)}`;
  if (n < 0) return `-${formatNumber(Math.abs(n))}`;
  return '0';
}

/**
 * 백분율 표시
 * 
 * @example
 *   formatPercent(0.87)   // "87%"
 *   formatPercent(0.025)  // "3%" (반올림)
 *   formatPercent(0.025, 1) // "2.5%"
 */
export function formatPercent(ratio: number, decimals = 0): string {
  return `${(ratio * 100).toFixed(decimals)}%`;
}


// =====================================================================
// 2. 날짜·시간 포맷
// =====================================================================

/**
 * 상대 시간 표시 (한국어)
 * 
 * @example
 *   formatRelativeTime(new Date(Date.now() - 60000))      // "방금 전"
 *   formatRelativeTime(new Date(Date.now() - 5*60000))    // "5분 전"
 *   formatRelativeTime(new Date(Date.now() - 2*3600000))  // "2시간 전"
 */
export function formatRelativeTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const now = new Date();
  const diffSec = Math.floor((now.getTime() - d.getTime()) / 1000);
  
  if (diffSec < 60) return '방금 전';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}분 전`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}시간 전`;
  if (diffSec < 86400 * 7) return `${Math.floor(diffSec / 86400)}일 전`;
  
  // 7일 이상은 날짜로
  return formatDate(d);
}

/**
 * 날짜 표시 (한국어)
 * 
 * @example
 *   formatDate(new Date('2026-05-20'))   // "5월 20일"
 *   formatDate(new Date('2026-05-20'), { year: true })  // "2026년 5월 20일"
 */
export function formatDate(
  date: Date | string,
  options: { year?: boolean; weekday?: boolean } = {}
): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const formatter = new Intl.DateTimeFormat('ko-KR', {
    year: options.year ? 'numeric' : undefined,
    month: 'long',
    day: 'numeric',
    weekday: options.weekday ? 'short' : undefined,
  });
  return formatter.format(d);
}

/**
 * 시간 (시:분)
 * 
 * @example
 *   formatTime(new Date('2026-05-20T14:30'))  // "오후 2:30"
 */
export function formatTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat('ko-KR', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(d);
}



/** 한국시간 날짜+시각 표시 */
export function formatDateTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(d);
}

// =====================================================================
// 3. 학기 표시
// =====================================================================

/**
 * 학기 매핑
 * 
 * @example
 *   formatTerm('FIRST', 2026)  // "2026 1학기"
 */
export function formatTerm(termType: 'FIRST' | 'SECOND', year: number): string {
  return `${year} ${termType === 'FIRST' ? '1' : '2'}학기`;
}


// =====================================================================
// 4. 이름·표시명 포맷
// =====================================================================

/**
 * 학생 표시명 — 브랜드명 우선, 없으면 본명
 * 
 * @example
 *   formatStudentName({ name: '이태우', brandName: 'Seven' })  // "Seven"
 *   formatStudentName({ name: '이태우' })                      // "이태우"
 */
export function formatStudentName(student: {
  name: string;
  brandName?: string | null;
  brand_name?: string | null;
}): string {
  return student.brandName || student.brand_name || student.name;
}

/**
 * 학년·반 표시
 * 
 * @example
 *   formatGradeClass(5, '4반')  // "5학년 4반"
 */
export function formatGradeClass(grade: number, className: string): string {
  return `${grade}학년 ${className}`;
}


// =====================================================================
// 5. 큰 숫자 축약 (1000+ → 1k)
// =====================================================================

/**
 * 큰 숫자 축약 표시
 * 
 * @example
 *   formatCompact(1480)     // "1.5k"
 *   formatCompact(12500)    // "12.5k"
 *   formatCompact(1234567)  // "1.2M"
 */
export function formatCompact(n: number): string {
  return new Intl.NumberFormat('en', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(n);
}


// =====================================================================
// 6. 진행률 (n/max → 백분율)
// =====================================================================

/**
 * 진행률 계산 (0~1)
 * 
 * @example
 *   calculateProgress(1480, 1700)  // 0.87
 *   calculateProgress(0, 100)      // 0
 *   calculateProgress(150, 100)    // 1 (clamped)
 */
export function calculateProgress(current: number, max: number): number {
  if (max <= 0) return 0;
  return Math.min(Math.max(current / max, 0), 1);
}


// =====================================================================
// KST 날짜 문자열 — 서버의 CURRENT_DATE(UTC 가능)와 혼동하지 않도록
// Feature4 출석/통계처럼 '한국의 오늘'이 중요한 곳에서 사용합니다.
// =====================================================================
export function getKstDateString(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
}

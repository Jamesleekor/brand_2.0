// =====================================================================
// B.R.A.N.D 2.0 — cn() 헬퍼
// =====================================================================
// Tailwind 클래스 합치기 + 충돌 해결.
// shadcn/ui 표준 패턴.
// =====================================================================

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Tailwind 클래스 합치기 + 충돌 자동 해결
 * 
 * @example
 *   cn('px-2 py-1', isLarge && 'px-4 py-2', className)
 *   // → "px-4 py-2" (isLarge=true일 때, 뒤의 클래스가 앞을 덮어씀)
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

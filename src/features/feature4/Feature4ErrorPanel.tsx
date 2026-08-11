import type { Feature4Domain } from '@/lib/feature4_debug';

export function Feature4ErrorPanel({ domain, error, onRetry }: { domain: Feature4Domain; error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : String(error ?? '알 수 없는 오류');
  return (
    <div className="bg-danger-bg border border-danger/40 rounded-card-lg p-4">
      <div className="font-display text-danger mb-1">⚠️ {domain} 영역 오류</div>
      <p className="text-xs text-text-secondary break-words">{message}</p>
      <p className="text-2xs text-text-muted mt-2">이 코드와 문구를 그대로 알려주면 해당 모듈부터 추적할 수 있습니다.</p>
      {onRetry && <button onClick={onRetry} className="btn-secondary mt-3 text-xs">다시 시도</button>}
    </div>
  );
}

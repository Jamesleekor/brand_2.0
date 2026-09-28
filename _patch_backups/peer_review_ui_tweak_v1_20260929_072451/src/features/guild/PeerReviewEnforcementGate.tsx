import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase/client';
import { useAuthStore } from '@/stores/auth_store';

type EnforcementRound = {
  round_id: number;
  mission_title?: string | null;
  guild_name?: string | null;
  required_count?: number | null;
  submitted_required_count?: number | null;
};

type EnforcementPayload = {
  active: boolean;
  rounds: EnforcementRound[];
  required_count: number;
  submitted_count: number;
  missing_count: number;
  enforcement_started_at?: string | null;
  next_penalty_at?: string | null;
  current_penalty_count: number;
  penalty_cycle_hours: number;
  penalty_amount_bv: number;
  penalty_amount_gold: number;
  total_bv_penalty: number;
  total_gold_penalty: number;
  asset_freeze_active: boolean;
};

type GateState =
  | { kind: 'checking' }
  | { kind: 'clear' }
  | { kind: 'blocked'; payload: EnforcementPayload }
  | { kind: 'error'; message: string };

const PEER_REVIEW_PATH = '/guild/peer-review';
const RECHECK_INTERVAL_MS = 15_000;

function toInt(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function parsePayload(raw: any): EnforcementPayload {
  const rounds = Array.isArray(raw?.rounds)
    ? raw.rounds.map((item: any) => ({
        round_id: toInt(item?.round_id),
        mission_title: item?.mission_title ?? null,
        guild_name: item?.guild_name ?? null,
        required_count: toInt(item?.required_count),
        submitted_required_count: toInt(item?.submitted_required_count),
      }))
    : [];

  return {
    active: !!raw?.active,
    rounds,
    required_count: toInt(raw?.required_count),
    submitted_count: toInt(raw?.submitted_count),
    missing_count: toInt(raw?.missing_count),
    enforcement_started_at: raw?.enforcement_started_at ?? null,
    next_penalty_at: raw?.next_penalty_at ?? null,
    current_penalty_count: toInt(raw?.current_penalty_count),
    penalty_cycle_hours: Math.max(1, toInt(raw?.penalty_cycle_hours) || 12),
    penalty_amount_bv: Math.max(0, toInt(raw?.penalty_amount_bv) || 1000),
    penalty_amount_gold: Math.max(0, toInt(raw?.penalty_amount_gold) || 1000),
    total_bv_penalty: Math.max(0, toInt(raw?.total_bv_penalty)),
    total_gold_penalty: Math.max(0, toInt(raw?.total_gold_penalty)),
    asset_freeze_active: !!raw?.asset_freeze_active,
  };
}

function formatCountdown(targetIso: string | null | undefined, nowMs: number): string {
  if (!targetIso) return '계산 중';
  const target = new Date(targetIso).getTime();
  if (!Number.isFinite(target)) return '계산 중';
  const diff = Math.max(0, target - nowMs);
  const totalSeconds = Math.floor(diff / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((v) => String(v).padStart(2, '0')).join(':');
}

function formatDateTime(iso?: string | null): string {
  if (!iso) return '기록 없음';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '기록 없음';
  return date.toLocaleString('ko-KR');
}

export function PeerReviewEnforcementGate({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const logout = useAuthStore((s) => s.logout);
  const [state, setState] = useState<GateState>({ kind: 'checking' });
  const [nowMs, setNowMs] = useState(() => Date.now());

  const isPeerReviewPage = location.pathname === PEER_REVIEW_PATH;

  const check = useCallback(async (showLoader = false) => {
    if (showLoader) setState({ kind: 'checking' });

    const { data, error } = await supabase.rpc('student_get_peer_review_enforcement_status');
    if (error) {
      setState({ kind: 'error', message: error.message || '동료평가 운영 제한 상태를 확인하지 못했습니다.' });
      return;
    }

    const payload = parsePayload(data);
    setState(payload.active ? { kind: 'blocked', payload } : { kind: 'clear' });
  }, []);

  useEffect(() => {
    if (isPeerReviewPage) {
      setState({ kind: 'clear' });
      return;
    }

    void check(true);
    const intervalId = window.setInterval(() => void check(false), RECHECK_INTERVAL_MS);
    const onFocus = () => void check(false);
    window.addEventListener('focus', onFocus);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', onFocus);
    };
  }, [check, isPeerReviewPage]);

  useEffect(() => {
    if (state.kind !== 'blocked') return;
    const tick = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(tick);
  }, [state.kind]);

  const warning = useMemo(() => {
    if (state.kind !== 'blocked') return null;
    const payload = state.payload;
    const cycle = payload.penalty_cycle_hours;
    const bvEach = payload.penalty_amount_bv;
    const goldEach = payload.penalty_amount_gold;
    const countdown = formatCountdown(payload.next_penalty_at, nowMs);
    const startedAt = formatDateTime(payload.enforcement_started_at);
    const nextAt = formatDateTime(payload.next_penalty_at);
    return {
      cycle,
      bvEach,
      goldEach,
      countdown,
      startedAt,
      nextAt,
      hasPenaltyStarted: payload.current_penalty_count >= 1 || payload.asset_freeze_active,
    };
  }, [nowMs, state]);

  if (isPeerReviewPage || state.kind === 'clear') return <>{children}</>;

  if (state.kind === 'checking') {
    return (
      <div className="app-container min-h-screen flex items-center justify-center p-5">
        <div className="glass-card w-full max-w-md p-6 text-center border border-danger/40">
          <div className="text-5xl animate-pulse">🚨</div>
          <h1 className="font-display text-xl mt-3">운영 제한 상태 확인 중</h1>
          <p className="text-sm text-text-secondary mt-2">동료평가 미완료 여부와 누적 페널티 상태를 확인하고 있습니다.</p>
        </div>
      </div>
    );
  }

  if (state.kind === 'error') {
    return (
      <div className="app-container min-h-screen flex items-center justify-center p-5">
        <div className="glass-card w-full max-w-md p-6 text-center border border-danger/60 shadow-2xl">
          <div className="text-5xl">⚠️</div>
          <h1 className="font-display text-xl mt-3">운영 제한 확인 실패</h1>
          <p className="text-sm text-text-secondary mt-2 leading-6">
            필수 절차 확인이 완료될 때까지 B.R.A.N.D 이용이 제한됩니다.
            <br />
            이 상태에서는 우회 이용이 허용되지 않습니다.
          </p>
          <p className="text-xs text-danger mt-3 break-words">{state.message}</p>
          <button type="button" className="btn-primary w-full mt-5" onClick={() => void check(true)}>다시 확인</button>
          <button type="button" className="btn-secondary w-full mt-2" onClick={() => void logout()}>로그아웃</button>
        </div>
      </div>
    );
  }

  const payload = state.payload;

  return (
    <div className="app-container min-h-screen flex items-center justify-center p-4 sm:p-5">
      <div className="glass-card w-full max-w-3xl overflow-hidden border border-danger/60 shadow-2xl">
        <div className="bg-danger/10 border-b border-danger/40 px-5 py-5 sm:px-6 sm:py-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-pill border border-danger/50 bg-danger-bg px-3 py-1 text-[11px] font-black tracking-[0.18em] text-danger animate-pulse">
                <span>⚠</span>
                <span>최종 경고 · B.R.A.N.D ACCESS RESTRICTED</span>
              </div>
              <h1 className="font-display text-2xl sm:text-3xl mt-3 text-danger">동료평가 미완료로 인한 운영 제한</h1>
              <p className="text-sm text-text-secondary mt-3 leading-6">
                필수 동료평가가 완료되지 않아 현재 계정은 <b className="text-white">전 기능 차단</b> 상태입니다.
                <br />
                이 화면은 동료평가를 완료하기 전까지 해제되지 않습니다.
              </p>
            </div>
            <div className="rounded-card-md border border-danger/40 bg-bg-deep px-4 py-3 text-sm shrink-0">
              <div className="text-2xs font-black tracking-[0.12em] text-danger">ENFORCEMENT START</div>
              <div className="mt-1 font-black text-white">{warning?.startedAt}</div>
              <div className="mt-3 text-2xs font-black tracking-[0.12em] text-danger">NEXT PENALTY AT</div>
              <div className="mt-1 font-black text-white">{warning?.nextAt}</div>
            </div>
          </div>
        </div>

        <div className="p-5 sm:p-6 space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <DangerStat label="미완료 평가" value={`${payload.missing_count}건`} accent="danger" />
            <DangerStat label="누적 페널티 횟수" value={`${payload.current_penalty_count}회`} accent={payload.current_penalty_count > 0 ? 'danger' : 'warning'} />
            <DangerStat label="누적 BV 차감" value={`-${payload.total_bv_penalty.toLocaleString()} BV`} accent={payload.total_bv_penalty > 0 ? 'danger' : 'warning'} />
            <DangerStat label="누적 자산 차감" value={`-${payload.total_gold_penalty.toLocaleString()} GOLD`} accent={payload.total_gold_penalty > 0 ? 'danger' : 'warning'} />
          </div>

          <div className="rounded-card-lg border border-danger/50 bg-danger-bg p-4 sm:p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="text-xs font-black tracking-[0.16em] text-danger">PENALTY PROTOCOL</div>
                <h2 className="font-display text-xl mt-2 text-white">
                  {warning?.hasPenaltyStarted ? '자산 동결 발효 중 · 추가 페널티 진행 중' : '유예 시간 진행 중 · 첫 페널티 예정'}
                </h2>
                <div className="mt-3 space-y-2 text-sm leading-6 text-text-secondary">
                  <p>
                    <b className="text-white">현재 상태:</b> 동료평가 미완료로 인해 이미 B.R.A.N.D 전 기능이 차단되었습니다.
                  </p>
                  <p>
                    <b className="text-white">{warning?.cycle}시간 경과 시 즉시:</b> 자산 동결, <span className="text-danger font-black">BV -{warning?.bvEach.toLocaleString()}</span>, <span className="text-danger font-black">GOLD -{warning?.goldEach.toLocaleString()}</span>
                  </p>
                  <p>
                    <b className="text-white">이후:</b> 미완료 상태가 계속되면 <span className="text-danger font-black">{warning?.cycle}시간마다 동일 페널티가 무한 누적</span>됩니다.
                  </p>
                </div>
              </div>
              <div className="rounded-card-md border border-danger/60 bg-bg-deep px-4 py-4 min-w-[220px]">
                <div className="text-2xs font-black tracking-[0.16em] text-danger">COUNTDOWN</div>
                <div className="font-display text-3xl mt-2 text-danger">{warning?.countdown}</div>
                <div className="mt-2 text-xs font-bold text-text-secondary">
                  {warning?.hasPenaltyStarted ? '다음 추가 페널티까지 남은 시간' : '첫 페널티까지 남은 시간'}
                </div>
                <div className="mt-4 rounded-card-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs font-black text-danger">
                  {warning?.hasPenaltyStarted ? '자산 동결 상태 유지 중' : '유예 종료 즉시 자산 동결 시작'}
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-card-lg border border-line bg-bg-deep p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-black tracking-[0.14em] text-text-muted">INCOMPLETE ROUNDS</div>
                <h3 className="font-display text-lg mt-1">미완료 동료평가 대상</h3>
              </div>
              <div className="text-xs font-bold text-text-secondary">
                필수 {payload.required_count} · 완료 {payload.submitted_count} · 미완료 <span className="text-danger font-black">{payload.missing_count}</span>
              </div>
            </div>
            <div className="mt-4 space-y-2">
              {payload.rounds.map((round) => {
                const missing = Math.max(0, toInt(round.required_count) - toInt(round.submitted_required_count));
                return (
                  <div key={round.round_id} className="flex flex-col gap-2 rounded-card-md border border-line bg-bg-card px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="font-black text-white truncate">{round.mission_title || `동료평가 #${round.round_id}`}</div>
                      <div className="mt-1 text-xs text-text-muted">{round.guild_name || '길드 정보 없음'}</div>
                    </div>
                    <div className="shrink-0 text-sm font-black text-danger">미완료 {missing}건</div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <button type="button" className="btn-primary w-full !py-3 text-base" onClick={() => navigate(PEER_REVIEW_PATH)}>
              지금 동료평가 완료하기
            </button>
            <button type="button" className="btn-secondary w-full !py-3" onClick={() => void check(true)}>
              완료 여부 다시 확인
            </button>
          </div>

          <button type="button" className="w-full text-xs text-text-muted hover:text-text-secondary py-1" onClick={() => void logout()}>
            로그아웃
          </button>
        </div>
      </div>
    </div>
  );
}

function DangerStat({ label, value, accent = 'warning' }: { label: string; value: string; accent?: 'danger' | 'warning' | 'neutral' }) {
  const tone = accent === 'danger'
    ? 'border-danger/40 bg-danger-bg text-danger'
    : accent === 'warning'
      ? 'border-warning/40 bg-warning-bg text-warning'
      : 'border-line bg-bg-deep text-text-primary';

  return (
    <div className={`rounded-card-md border px-3 py-3 ${tone}`}>
      <div className="text-2xs font-black tracking-[0.12em] text-text-muted">{label}</div>
      <div className="font-display text-xl mt-1 break-words">{value}</div>
    </div>
  );
}

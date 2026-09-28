import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase/client';
import { useAuthStore } from '@/stores/auth_store';

type PeerReviewRound = {
  round_id: number;
  mission_title?: string | null;
  guild_name?: string | null;
  lifecycle_state?: string | null;
  required_count?: number | null;
  submitted_required_count?: number | null;
};

type GateState =
  | { kind: 'checking' }
  | { kind: 'clear' }
  | { kind: 'blocked'; rounds: PeerReviewRound[] }
  | { kind: 'error'; message: string };

const PEER_REVIEW_PATH = '/guild/peer-review';
const RECHECK_INTERVAL_MS = 15_000;

function getIncompleteOpenRounds(rounds: PeerReviewRound[]): PeerReviewRound[] {
  return rounds.filter((round) => {
    if (round.lifecycle_state !== 'OPEN') return false;
    const required = Number(round.required_count ?? 0);
    const submitted = Number(round.submitted_required_count ?? 0);
    return required > submitted;
  });
}

export function PeerReviewEnforcementGate({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const logout = useAuthStore((s) => s.logout);
  const [state, setState] = useState<GateState>({ kind: 'checking' });

  const isPeerReviewPage = location.pathname === PEER_REVIEW_PATH;

  const check = useCallback(async (showLoader = false) => {
    if (showLoader) setState({ kind: 'checking' });

    const { data, error } = await supabase.rpc('student_get_guild4_peer_review_rounds');
    if (error) {
      setState({ kind: 'error', message: error.message || '동료평가 이행 상태를 확인하지 못했습니다.' });
      return;
    }

    const rounds = Array.isArray(data) ? (data as PeerReviewRound[]) : [];
    const incomplete = getIncompleteOpenRounds(rounds);
    setState(incomplete.length > 0 ? { kind: 'blocked', rounds: incomplete } : { kind: 'clear' });
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

  const summary = useMemo(() => {
    if (state.kind !== 'blocked') return { required: 0, submitted: 0, missing: 0 };
    return state.rounds.reduce((acc, round) => {
      const required = Number(round.required_count ?? 0);
      const submitted = Number(round.submitted_required_count ?? 0);
      acc.required += required;
      acc.submitted += submitted;
      acc.missing += Math.max(0, required - submitted);
      return acc;
    }, { required: 0, submitted: 0, missing: 0 });
  }, [state]);

  if (isPeerReviewPage || state.kind === 'clear') return <>{children}</>;

  if (state.kind === 'checking') {
    return (
      <div className="app-container min-h-screen flex items-center justify-center p-5">
        <div className="glass-card w-full max-w-md p-6 text-center">
          <div className="text-4xl animate-pulse">🔒</div>
          <h1 className="font-display text-xl mt-3">필수 절차 확인 중</h1>
          <p className="text-sm text-text-secondary mt-2">동료평가 이행 상태를 확인하고 있습니다.</p>
        </div>
      </div>
    );
  }

  if (state.kind === 'error') {
    return (
      <div className="app-container min-h-screen flex items-center justify-center p-5">
        <div className="glass-card w-full max-w-md p-6 text-center border border-warning/50">
          <div className="text-4xl">⚠️</div>
          <h1 className="font-display text-xl mt-3">이용 상태 확인 실패</h1>
          <p className="text-sm text-text-secondary mt-2">필수 절차 확인이 완료될 때까지 B.R.A.N.D 이용이 제한됩니다.</p>
          <p className="text-xs text-warning mt-3 break-words">{state.message}</p>
          <button type="button" className="btn-primary w-full mt-5" onClick={() => void check(true)}>다시 확인</button>
          <button type="button" className="btn-secondary w-full mt-2" onClick={() => void logout()}>로그아웃</button>
        </div>
      </div>
    );
  }

  return (
    <div className="app-container min-h-screen flex items-center justify-center p-5">
      <div className="glass-card w-full max-w-lg overflow-hidden border border-danger/50 shadow-2xl">
        <div className="p-6 text-center border-b border-line bg-danger/5">
          <div className="mx-auto w-16 h-16 rounded-full border border-danger/40 bg-danger/10 flex items-center justify-center text-3xl">🔒</div>
          <div className="text-xs font-black tracking-[0.22em] text-danger mt-4">B.R.A.N.D ACCESS RESTRICTED</div>
          <h1 className="font-display text-2xl mt-2">동료평가 미완료</h1>
          <p className="text-sm text-text-secondary mt-2 leading-6">
            필수 동료평가가 완료되지 않았습니다.<br />
            완료할 때까지 B.R.A.N.D의 모든 기능 이용이 제한됩니다.
          </p>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-3 gap-2">
            <StatusBox label="필수 평가" value={summary.required} />
            <StatusBox label="제출 완료" value={summary.submitted} />
            <StatusBox label="미완료" value={summary.missing} danger />
          </div>

          <div className="rounded-card-md border border-line bg-bg-deep p-3 space-y-2">
            {state.rounds.map((round) => {
              const missing = Math.max(0, Number(round.required_count ?? 0) - Number(round.submitted_required_count ?? 0));
              return (
                <div key={round.round_id} className="flex items-center justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <div className="font-black truncate">{round.mission_title || `동료평가 #${round.round_id}`}</div>
                    {round.guild_name ? <div className="text-2xs text-text-muted mt-0.5">{round.guild_name}</div> : null}
                  </div>
                  <div className="shrink-0 font-black text-danger">미완료 {missing}건</div>
                </div>
              );
            })}
          </div>

          <button type="button" className="btn-primary w-full !py-3" onClick={() => navigate(PEER_REVIEW_PATH)}>
            동료평가 완료하기
          </button>
          <button type="button" className="btn-secondary w-full" onClick={() => void check(true)}>
            완료 여부 다시 확인
          </button>
          <button type="button" className="w-full text-xs text-text-muted hover:text-text-secondary py-1" onClick={() => void logout()}>
            로그아웃
          </button>
        </div>
      </div>
    </div>
  );
}

function StatusBox({ label, value, danger = false }: { label: string; value: number; danger?: boolean }) {
  return (
    <div className="rounded-card-md border border-line bg-bg-deep px-2 py-3 text-center">
      <div className="text-2xs font-black text-text-muted">{label}</div>
      <div className={`font-display text-xl mt-1 ${danger ? 'text-danger' : 'text-text-primary'}`}>{value}</div>
    </div>
  );
}

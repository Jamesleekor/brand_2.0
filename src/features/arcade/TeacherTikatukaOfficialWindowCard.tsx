import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { tikatukaRpcErrorMessage, tikatukaTeacherRpc } from '@/lib/rpc/tikatuka_rpc';

function formatKst(value: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
}

export function TeacherTikatukaOfficialWindowCard() {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['teacher-tikatuka-official-window'],
    queryFn: async () => {
      const result = await tikatukaTeacherRpc.getOfficialWindow(supabase);
      if (result.success === false) throw new Error(tikatukaRpcErrorMessage(result));
      return result.data;
    },
  });

  const setOpen = async (nextOpen: boolean) => {
    if (saving) return;
    const confirmed = window.confirm(nextOpen
      ? '라카루카 공인 도전을 지금 열까요? 학생은 이번 공인 기간에 1회(5판)만 시작할 수 있습니다.'
      : '라카루카 공인 도전을 닫을까요? 새 도전 시작만 막히며, 이미 시작한 학생은 남은 5판을 계속 진행할 수 있습니다.');
    if (!confirmed) return;

    setSaving(true);
    setActionError(null);
    const result = await tikatukaTeacherRpc.setOfficialWindow(supabase, { p_is_open: nextOpen });
    setSaving(false);

    if (result.success === false) {
      setActionError(tikatukaRpcErrorMessage(result));
      return;
    }

    queryClient.setQueryData(['teacher-tikatuka-official-window'], result.data);
  };

  return (
    <section className="glass-card overflow-hidden border-gold/35 p-0">
      <div className="border-b border-line p-5">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
          <div>
            <div className="text-xs font-black tracking-[0.18em] text-gold">OFFICIAL DAY · {query.data?.period_key ?? '현재 월'}</div>
            <h2 className="mt-1 font-display text-xl text-white">🏅 라카루카 공인 도전 운영</h2>
            <p className="mt-2 max-w-3xl text-sm font-bold leading-6 text-text-secondary">
              학생당 이번 공인 기간에 <b className="text-white">단 1회, 총 5판</b>만 도전할 수 있습니다. 선생님이 여기에서 열어둔 동안에만 새 공인 도전을 시작할 수 있습니다.
            </p>
          </div>
          {query.data && (
            <span className={`self-start rounded-pill border px-4 py-2 text-sm font-black ${query.data.is_open ? 'border-success/50 bg-success/10 text-success' : 'border-line bg-bg-deep text-text-muted'}`}>
              {query.data.is_open ? '● 공인 도전 OPEN' : '● 공인 도전 CLOSED'}
            </span>
          )}
        </div>
      </div>

      {query.isLoading && <div className="p-6 text-sm font-bold text-text-secondary">공인 도전 상태를 불러오는 중...</div>}
      {query.isError && (
        <div className="p-5">
          <div className="font-black text-danger">공인 도전 운영 상태를 불러오지 못했습니다.</div>
          <p className="mt-2 text-xs text-text-secondary">{query.error instanceof Error ? query.error.message : '알 수 없는 오류'}</p>
          <button className="btn-secondary mt-3 text-xs" onClick={() => void query.refetch()}>다시 시도</button>
        </div>
      )}

      {query.data && (
        <div className="p-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="도전 시작" value={`${query.data.started_count}명`} />
            <Stat label="5판 완료" value={`${query.data.completed_count}명`} />
            <Stat label="열린 시각" value={formatKst(query.data.opened_at)} small />
            <Stat label="닫힌 시각" value={formatKst(query.data.closed_at)} small />
          </div>

          <div className="mt-4 rounded-card-md border border-warning/30 bg-warning/10 p-4 text-xs font-bold leading-6 text-warning">
            한 학생이 공인 도전을 시작하는 순간 이번 기간의 1회 기회를 사용합니다. 5판 결과가 3점 미만으로 미인정되어도 재도전할 수 없습니다. 공인 도전을 닫아도 이미 시작한 학생의 남은 경기는 계속 집계됩니다.
          </div>

          {actionError && <div className="mt-4 rounded-card-md border border-danger/40 bg-danger/10 p-3 text-sm font-bold text-danger">{actionError}</div>}

          <div className="mt-5 flex flex-wrap gap-3">
            {query.data.is_open ? (
              <button className="btn-secondary border-danger/40 text-danger" disabled={saving} onClick={() => void setOpen(false)}>
                {saving ? '변경 중...' : '공인 도전 닫기'}
              </button>
            ) : (
              <button className="btn-primary" disabled={saving} onClick={() => void setOpen(true)}>
                {saving ? '변경 중...' : '공인 도전 열기'}
              </button>
            )}
            <button className="btn-secondary" disabled={saving} onClick={() => void query.refetch()}>상태 새로고침</button>
          </div>
        </div>
      )}
    </section>
  );
}

function Stat({ label, value, small = false }: { label: string; value: string; small?: boolean }) {
  return (
    <div className="rounded-card-md border border-line bg-bg-deep p-4">
      <div className="text-[11px] font-black text-text-muted">{label}</div>
      <div className={`mt-1 font-black text-white ${small ? 'text-xs leading-5' : 'text-xl'}`}>{value}</div>
    </div>
  );
}

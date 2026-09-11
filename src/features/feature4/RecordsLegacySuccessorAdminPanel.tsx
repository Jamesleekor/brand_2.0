import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LockKeyhole, LockKeyholeOpen, RotateCcw, ScrollText } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { useClassroomId } from '@/stores/auth_store';
import { RECORDS_LEGACY_PATHS, getRecordsLegacyPath } from '@/lib/records_legacy_paths';
import { recordsLegacySuccessorRpc } from '@/lib/rpc/records_legacy_successor_rpc';

export function RecordsLegacySuccessorAdminPanel() {
  const classroomId = useClassroomId();
  const queryClient = useQueryClient();
  const queryKey = ['records', 'legacy-successor', 'admin', classroomId] as const;

  const q = useQuery({
    queryKey,
    enabled: classroomId !== null,
    queryFn: () => recordsLegacySuccessorRpc.teacherBoard(supabase),
    refetchOnWindowFocus: true,
  });

  const refreshAll = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['records', 'legacy-successor'] }),
      queryClient.invalidateQueries({ queryKey }),
    ]);
  };

  const resetM = useMutation({
    mutationFn: (studentId: number) => recordsLegacySuccessorRpc.teacherReset(supabase, studentId),
    onSuccess: refreshAll,
  });
  const lockM = useMutation({
    mutationFn: () => recordsLegacySuccessorRpc.teacherLock(supabase),
    onSuccess: refreshAll,
  });
  const unlockM = useMutation({
    mutationFn: () => recordsLegacySuccessorRpc.teacherUnlock(supabase),
    onSuccess: refreshAll,
  });

  const rows = useMemo(() => {
    return [...(q.data?.rows ?? [])].sort((a, b) => {
      if (!!a.registered_at !== !!b.registered_at) return a.registered_at ? -1 : 1;
      if (!!a.seal_confirmed_at !== !!b.seal_confirmed_at) return a.seal_confirmed_at ? -1 : 1;
      return a.student_name.localeCompare(b.student_name, 'ko');
    });
  }, [q.data?.rows]);

  const busy = resetM.isPending || lockM.isPending || unlockM.isPending;
  const board = q.data;
  const canLock = !!board && board.registered_count >= board.minimum_successors && (board.event_status === 'OPEN' || board.event_status === 'UNSEALED');
  const canUnlock = board?.event_status === 'LOCKED';

  return (
    <section className="relative overflow-hidden rounded-card-lg border border-[#9a7940]/35 bg-[radial-gradient(circle_at_50%_0%,rgba(204,157,70,0.09),transparent_34%),linear-gradient(155deg,rgba(25,20,24,0.98),rgba(11,9,14,0.99))] p-4 sm:p-5">
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-[10%] top-0 h-px bg-gradient-to-r from-transparent via-[#dfbd72]/55 to-transparent" />
      <header className="relative flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-[10px] font-black tracking-[0.18em] text-[#b69454]">HIDDEN LEGACY · SUCCESSOR REGISTER</div>
          <h2 className="mt-1 font-display text-xl text-[#eee0c4]">숨겨진 봉인 · 후계자 등록</h2>
          <p className="mt-1 text-xs font-bold leading-relaxed text-text-muted">봉인을 발견한 학생과 선택한 계승의 길을 확인하고, 유산 계승식 직전에 최종 명부를 잠급니다.</p>
        </div>
        {board ? <StatusSeal status={board.event_status} /> : null}
      </header>

      {q.isLoading ? (
        <div className="py-8 text-center text-xs font-bold text-text-muted">후계자 명부를 펼치는 중…</div>
      ) : q.isError ? (
        <div className="mt-4 rounded-card-md border border-danger/30 bg-danger/5 p-3">
          <p className="text-xs font-bold text-danger">후계자 명부를 불러오지 못했습니다.</p>
          <button type="button" onClick={() => void q.refetch()} className="mt-2 text-xs font-black text-gold hover:underline">다시 불러오기</button>
        </div>
      ) : board ? (
        <>
          <div className="mt-5 grid grid-cols-2 gap-2 md:grid-cols-4">
            <Metric label="봉인 발견" value={`${board.discovered_count}명`} />
            <Metric label="봉인 확인" value={`${board.confirmed_count}명`} />
            <Metric label="후계자 등록" value={`${board.registered_count} / ${board.minimum_successors}명`} accent />
            <Metric label="최종 명부" value={board.locked_successor_count != null ? `${board.locked_successor_count}명` : '미확정'} />
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {canLock ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (!window.confirm(`현재 등록된 ${board.registered_count}명을 최종 계승자 명부로 확정할까요?\n확정 이후에는 학생이 추가 등록할 수 없습니다.`)) return;
                  lockM.mutate();
                }}
                className="inline-flex items-center gap-2 rounded-card-sm border border-[#c6a259]/48 bg-[#a77c31]/12 px-3 py-2 text-xs font-black text-[#e6ca8d] transition hover:bg-[#a77c31]/18 disabled:opacity-40"
              >
                <LockKeyhole className="h-4 w-4" /> 최종 명부 확정
              </button>
            ) : null}
            {canUnlock ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (!window.confirm('최종 명부 잠금을 해제하고 후계자 등록을 다시 받을까요?')) return;
                  unlockM.mutate();
                }}
                className="inline-flex items-center gap-2 rounded-card-sm border border-line bg-bg-deep px-3 py-2 text-xs font-black text-text-secondary transition hover:border-gold/35 disabled:opacity-40"
              >
                <LockKeyholeOpen className="h-4 w-4" /> 명부 다시 열기
              </button>
            ) : null}
            {board.event_status === 'OPEN' && board.registered_count < board.minimum_successors ? (
              <span className="text-xs font-bold text-text-muted">최소 {board.minimum_successors}명이 등록된 뒤 최종 명부를 확정할 수 있습니다.</span>
            ) : null}
            {board.unsealed_at ? <span className="text-[10px] font-bold text-[#a39378]">봉인 해제 {formatDateTime(board.unsealed_at)}</span> : null}
          </div>

          {(lockM.isError || unlockM.isError || resetM.isError) ? (
            <p className="mt-3 text-xs font-bold text-danger">작업을 저장하지 못했습니다. 상태를 새로고침한 뒤 다시 시도해 주세요.</p>
          ) : null}

          <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {RECORDS_LEGACY_PATHS.map((path) => (
              <div key={path.code} className="rounded-card-md border border-[#77623f]/30 bg-black/15 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-display text-sm text-[#d9c8a6]">{path.numeral}. {path.title}</div>
                  <div className="font-mono text-sm font-black text-[#d4af63]">{board.path_counts[path.code] ?? 0}명</div>
                </div>
                <div className="mt-1 text-[10px] font-bold leading-4 text-text-muted [word-break:keep-all]">{path.officialRecord}</div>
              </div>
            ))}
          </div>

          <div className="mt-6 border-t border-[#8e7449]/22 pt-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <ScrollText className="h-4 w-4 text-[#c6a45f]" />
                <h3 className="font-display text-base text-[#e4d5b8]">후계자 명부</h3>
              </div>
              <span className="text-[10px] font-black text-text-muted">등록 {board.registered_count}명 · 확인 {board.confirmed_count}명</span>
            </div>

            {!rows.length ? (
              <div className="rounded-card-md border border-dashed border-line p-6 text-center text-xs font-bold text-text-muted">아직 봉인을 발견한 학생이 없습니다.</div>
            ) : (
              <div className="grid gap-2 lg:grid-cols-2">
                {rows.map((row) => {
                  const path = getRecordsLegacyPath(row.legacy_path_code);
                  const status = row.registered_at ? '등록 완료' : row.seal_confirmed_at ? '봉인 확인' : '봉인 발견';
                  return (
                    <article key={row.student_id} className="rounded-card-md border border-line bg-bg-deep/75 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-black text-text-primary">{row.student_name}</span>
                            {row.brand_name ? <span className="text-[10px] font-bold text-text-muted">{row.brand_name}</span> : null}
                            <span className={`rounded-pill border px-2 py-0.5 text-[9px] font-black ${row.registered_at ? 'border-[#b9954e]/38 bg-[#b9954e]/10 text-[#d7b76d]' : 'border-line bg-bg-card text-text-muted'}`}>{status}</span>
                          </div>
                          {path ? (
                            <div className="mt-2">
                              <div className="font-display text-sm text-[#dfca9f]">「{path.title}」</div>
                              <div className="mt-0.5 text-[10px] font-bold text-[#a48e67]">{path.officialRecord}</div>
                            </div>
                          ) : null}
                          {row.legacy_statement ? <p className="mt-2 text-xs font-bold leading-5 text-text-secondary [word-break:keep-all]">“{row.legacy_statement}”</p> : null}
                          <div className="mt-2 text-[9px] font-bold text-text-muted">
                            {row.registered_at ? `등록 ${formatDateTime(row.registered_at)}` : row.seal_confirmed_at ? `확인 ${formatDateTime(row.seal_confirmed_at)}` : row.seal_discovered_at ? `발견 ${formatDateTime(row.seal_discovered_at)}` : ''}
                          </div>
                        </div>
                        {row.registered_at && (board.event_status === 'OPEN' || board.event_status === 'UNSEALED') ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              if (!window.confirm(`${row.student_name} 학생의 후계자 등록을 초기화할까요?\n봉인 발견/확인 상태는 유지되고 다시 등록할 수 있게 됩니다.`)) return;
                              resetM.mutate(row.student_id);
                            }}
                            className="inline-flex shrink-0 items-center gap-1 text-[10px] font-black text-danger/85 hover:text-danger disabled:opacity-40"
                          >
                            <RotateCcw className="h-3.5 w-3.5" /> 등록 초기화
                          </button>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </>
      ) : null}
    </section>
  );
}

function Metric({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-card-md border border-line bg-bg-deep/70 p-3">
      <div className="text-[10px] font-black text-text-muted">{label}</div>
      <div className={`mt-1 font-display text-lg ${accent ? 'text-[#d8b565]' : 'text-text-primary'}`}>{value}</div>
    </div>
  );
}

function StatusSeal({ status }: { status: string }) {
  const label = status === 'OPEN' ? '봉인 유지' : status === 'UNSEALED' ? '봉인 해제' : status === 'LOCKED' ? '명부 확정' : '계승 완료';
  return <div className="shrink-0 rounded-pill border border-[#a58448]/35 bg-black/20 px-3 py-1.5 text-[10px] font-black text-[#c8aa69]">{label}</div>;
}

function formatDateTime(value: string) {
  try {
    return new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

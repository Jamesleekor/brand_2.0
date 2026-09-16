import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { EmptyState, LoadingSpinner } from '@/components/shared/components';
import {
  dimensionalGateTeacherRpc,
  type DimensionalGateTeacherAction,
  type DimensionalGateTeacherRelationship,
} from '@/lib/rpc/dimensional_gate_teacher_rpc';
import { supabase } from '@/lib/supabase/client';
import { cn } from '@/lib/utils/cn';

interface Props {
  classroomId: number;
}

const STAGE_LABEL: Record<string, string> = {
  STRANGER: '낯섦', INTEREST: '관심', AFFECTION: '호감', TRUST: '신뢰',
};

export function DimensionalGateAdminPanel({ classroomId }: Props) {
  const queryClient = useQueryClient();
  const [studentId, setStudentId] = useState<number | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [draftAffinity, setDraftAffinity] = useState<Record<number, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['dimensional-gate-teacher-board', classroomId],
    queryFn: async () => {
      const result = await dimensionalGateTeacherRpc.board(supabase, classroomId);
      if (result.success === false) throw new Error(result.error);
      return result.data;
    },
    enabled: classroomId > 0,
    staleTime: 10_000,
    retry: 1,
  });

  const board = query.data;
  const selectedId = studentId ?? board?.students[0]?.id ?? null;
  const rows = useMemo(
    () => (board?.relationships ?? []).filter((row) => row.student_id === selectedId),
    [board?.relationships, selectedId],
  );

  const run = async (row: DimensionalGateTeacherRelationship, action: DimensionalGateTeacherAction, value: number | null = null) => {
    const key = `${row.student_id}:${row.character_id}:${action}`;
    if (busyKey) return;
    if (action === 'LOCK' && !confirm(`${row.student_name} 학생의 ${row.character_name} 관계를 잠글까요?`)) return;
    setBusyKey(key);
    setMessage(null);
    const result = await dimensionalGateTeacherRpc.manage(
      supabase,
      row.student_id,
      row.character_id,
      action,
      value,
      reason.trim() || null,
    );
    setBusyKey(null);
    if (result.success === false) {
      setMessage(result.error);
      return;
    }
    setMessage(`${row.student_name} · ${row.character_name} 처리 완료`);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['dimensional-gate-teacher-board', classroomId] }),
      queryClient.invalidateQueries({ queryKey: ['dimensional-gate-roster'] }),
    ]);
  };

  if (query.isLoading) return <div className="grid min-h-[360px] place-items-center"><LoadingSpinner size="lg" /></div>;
  if (query.isError || !board) {
    return <div className="rounded-card-lg border border-danger/30 bg-danger-bg p-5 text-center text-xs font-bold text-danger">차원관문 운영 데이터를 불러오지 못했습니다.</div>;
  }

  return (
    <section className="space-y-4">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <SettingCard label="정상 대화" value={`+${board.settings.normal_gain}`} />
        <SettingCard label="가벼운 무례" value={`-${board.settings.mild_penalty}`} />
        <SettingCard label="심각한 무례" value={`-${board.settings.severe_penalty}`} />
        <SettingCard label="최근 활동" value={`${board.settings.activity_lookback_days}일 · ${board.settings.activity_event_limit}건`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[250px_minmax(0,1fr)]">
        <aside className="overflow-hidden rounded-card-lg border border-line bg-bg-card">
          <div className="border-b border-line p-3">
            <div className="text-xs font-black text-white">학생 선택</div>
            <div className="mt-0.5 text-[10px] font-bold text-text-muted">차원관문 관계 상태를 관리합니다.</div>
          </div>
          <div className="max-h-[620px] overflow-y-auto p-2">
            {board.students.map((student) => {
              const count = board.relationships.filter((row) => row.student_id === student.id).length;
              return (
                <button
                  key={student.id}
                  type="button"
                  onClick={() => setStudentId(student.id)}
                  className={cn(
                    'mb-1 w-full rounded-card-md border px-3 py-2.5 text-left transition-all',
                    selectedId === student.id ? 'border-brand-primary/50 bg-brand-primary/15' : 'border-transparent hover:border-line hover:bg-bg-deep',
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-black text-white">{student.name}</div>
                      <div className="truncate text-[10px] font-bold text-text-secondary">{student.brand_name ?? '브랜드명 없음'}</div>
                    </div>
                    <span className="rounded-pill border border-line bg-bg-deep px-2 py-1 text-[9px] font-black text-text-muted">{count}종</span>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        <div className="space-y-3">
          <div className="rounded-card-lg border border-line bg-bg-card p-3">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-sm font-black text-white">관계 운영</div>
                <div className="text-[10px] font-bold text-text-muted">호감도 수정과 복구 작업은 모두 감사 로그에 기록됩니다.</div>
              </div>
              <input
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="조정 사유 (선택)"
                className="rounded-card-md border border-line bg-bg-deep px-3 py-2 text-xs font-bold text-text-primary outline-none md:w-64"
              />
            </div>
            {message && <div className="mt-2 rounded-card-md border border-brand-primary/25 bg-brand-primary/10 px-3 py-2 text-[10px] font-black text-brand-glow">{message}</div>}
          </div>

          {rows.length === 0 ? (
            <EmptyState emoji="🌀" title="차원관문이 열린 편린이 없습니다" description="학생이 영입했고 차원관문 프로필이 활성화된 편린만 표시됩니다." />
          ) : (
            <div className="grid gap-2 xl:grid-cols-2">
              {rows.map((row) => {
                const draft = draftAffinity[row.character_id] ?? String(row.affinity);
                const prefix = `${row.student_id}:${row.character_id}:`;
                return (
                  <div key={`${row.student_id}-${row.character_id}`} className={cn('rounded-card-lg border bg-bg-card p-3', row.status === 'LOCKED' ? 'border-danger/35' : 'border-line')}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-black text-white">{row.character_name}</div>
                        <div className="mt-0.5 font-mono text-[9px] font-bold text-text-muted">{row.character_uid}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs font-black text-violet-200">{STAGE_LABEL[row.relation_stage] ?? row.relation_stage} · {row.affinity}/100</div>
                        <div className={cn('text-[9px] font-black', row.status === 'LOCKED' ? 'text-danger' : 'text-text-muted')}>{row.status === 'LOCKED' ? '🔒 잠김' : `경고 ${row.warning_count}회`}</div>
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={draft}
                        onChange={(event) => setDraftAffinity((current) => ({ ...current, [row.character_id]: event.target.value }))}
                        className="rounded-card-md border border-line bg-bg-deep px-3 py-2 text-xs font-black text-white outline-none"
                      />
                      <button
                        type="button"
                        disabled={busyKey !== null}
                        onClick={() => {
                          const value = Number(draft);
                          if (!Number.isInteger(value) || value < 0 || value > 100) { setMessage('호감도는 0~100 정수로 입력해주세요.'); return; }
                          void run(row, 'SET_AFFINITY', value);
                        }}
                        className="rounded-card-md bg-brand-primary px-3 py-2 text-[10px] font-black text-white disabled:opacity-50"
                      >호감도 적용</button>
                    </div>

                    <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                      <ActionButton disabled={busyKey !== null} active={busyKey === `${prefix}UNLOCK`} label="잠금 해제" onClick={() => void run(row, 'UNLOCK')} />
                      <ActionButton disabled={busyKey !== null} active={busyKey === `${prefix}CLEAR_WARNINGS`} label="경고 초기화" onClick={() => void run(row, 'CLEAR_WARNINGS')} />
                      <ActionButton disabled={busyKey !== null} active={busyKey === `${prefix}RESET_DAILY`} label="대화횟수 초기화" onClick={() => void run(row, 'RESET_DAILY')} />
                      <ActionButton danger disabled={busyKey !== null} active={busyKey === `${prefix}LOCK`} label="관계 잠금" onClick={() => void run(row, 'LOCK')} />
                    </div>
                    <div className="mt-2 text-[9px] font-bold text-text-muted">오늘 대화 {row.chat_count}/{row.daily_chat_limit} · 남음 {row.remaining_chat_count}회</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function SettingCard({ label, value }: { label: string; value: string }) {
  return <div className="rounded-card-lg border border-line bg-bg-card px-3 py-3"><div className="text-[9px] font-black text-text-muted">{label}</div><div className="mt-1 text-sm font-black text-white">{value}</div></div>;
}

function ActionButton({ label, onClick, disabled, active, danger = false }: { label: string; onClick: () => void; disabled: boolean; active: boolean; danger?: boolean }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className={cn('rounded-card-md border px-2 py-2 text-[9px] font-black disabled:opacity-50', danger ? 'border-danger/30 bg-danger-bg text-danger' : 'border-line bg-bg-deep text-text-secondary hover:text-white')}>
      {active ? '처리 중…' : label}
    </button>
  );
}

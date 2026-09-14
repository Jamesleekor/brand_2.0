import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { guild3RpcError, guild3TeacherRpc } from '@/lib/rpc/guild3_rpc';
import type { Guild4TeacherRoundDetail } from '@/lib/rpc/guild4_rpc';
import { useToastStore } from '@/stores/ui_store';

type ReviewMode = 'received' | 'written';
type Grade = 'S' | 'A' | 'B' | 'C' | 'F';
type Obligation = Guild4TeacherRoundDetail['obligations'][number];

const GRADE_OPTIONS: Grade[] = ['S', 'A', 'B', 'C', 'F'];

function isGrade(value: unknown): value is Grade {
  return GRADE_OPTIONS.includes(String(value) as Grade);
}

function reviewStats(obligations: Obligation[], studentId: number, direction: ReviewMode) {
  const scoped = obligations.filter((o) =>
    direction === 'received'
      ? Number(o.target_student_id) === studentId
      : Number(o.reviewer_student_id) === studentId,
  );
  const required = scoped.filter((o) => o.obligation_status === 'REQUIRED');
  const submitted = required.filter((o) => Boolean(o.latest_review));
  const excused = scoped.filter((o) => o.obligation_status === 'EXCUSED');
  const scores = submitted
    .map((o) => Number(o.latest_review?.score))
    .filter((score) => Number.isFinite(score));

  const average = scores.length
    ? scores.reduce((sum, score) => sum + score, 0) / scores.length
    : null;
  const highest = scores.length ? Math.max(...scores) : null;
  const lowest = scores.length ? Math.min(...scores) : null;
  const range = highest !== null && lowest !== null ? highest - lowest : null;

  return {
    scoped,
    requiredCount: required.length,
    submittedCount: submitted.length,
    excusedCount: excused.length,
    average,
    highest,
    lowest,
    range,
  };
}

function scoreText(value: number | null, fixed = false) {
  if (value === null || !Number.isFinite(value)) return '-';
  return fixed ? value.toFixed(1) : String(value);
}

export function GuildPeerReviewStudentJudgement({
  detail,
  busy,
}: {
  detail: Guild4TeacherRoundDetail;
  busy: boolean;
}) {
  const qc = useQueryClient();
  const show = useToastStore((s) => s.show);
  const roundId = Number(detail.round.id);
  const missionId = Number(detail.round.mission_id ?? detail.mission?.id ?? 0);

  const [selectedStudentId, setSelectedStudentId] = useState<number | null>(
    detail.participants[0]?.student_id ?? null,
  );
  const [reviewMode, setReviewMode] = useState<ReviewMode>('received');
  const [draftGrade, setDraftGrade] = useState<Grade | ''>('');
  const [correctionReason, setCorrectionReason] = useState('');
  const [overrideReason, setOverrideReason] = useState('');

  useEffect(() => {
    setSelectedStudentId(detail.participants[0]?.student_id ?? null);
    setReviewMode('received');
  }, [roundId]);

  const sourceMissionQ = useQuery({
    queryKey: ['guild3-teacher-detail', missionId],
    enabled: Number.isFinite(missionId) && missionId > 0,
    queryFn: async () => {
      const r = await guild3TeacherRpc.detail(supabase, { p_mission_id: missionId });
      if (!r.success) throw new Error(guild3RpcError(r));
      return r.data;
    },
  });

  // Guild4 participant_id is the Guild4 snapshot row id, not the original Guild3 participant id.
  // Match the source Guild3 participant by student_id so current grades and corrections always use
  // the real Guild3 participant row.
  const sourceParticipantByStudentId = useMemo(() => {
    const map = new Map<number, any>();
    for (const instance of sourceMissionQ.data?.instances ?? []) {
      for (const item of instance.participants ?? []) {
        const studentId = Number(item.participant?.student_id);
        if (Number.isFinite(studentId)) map.set(studentId, item);
      }
    }
    return map;
  }, [sourceMissionQ.data]);

  const selectedIndex = detail.participants.findIndex(
    (p) => Number(p.student_id) === Number(selectedStudentId),
  );
  const selectedParticipant =
    selectedIndex >= 0 ? detail.participants[selectedIndex] : detail.participants[0] ?? null;

  const selectedStudent = selectedParticipant
    ? sourceParticipantByStudentId.get(Number(selectedParticipant.student_id)) ?? null
    : null;
  const currentGradeRaw = selectedStudent?.latest_grade_event?.grade;
  const currentGrade: Grade | '' = isGrade(currentGradeRaw) ? currentGradeRaw : '';

  useEffect(() => {
    setDraftGrade(currentGrade);
    setCorrectionReason('');
    setOverrideReason('');
  }, [roundId, selectedStudentId, currentGrade]);

  const received = selectedParticipant
    ? reviewStats(detail.obligations, Number(selectedParticipant.student_id), 'received')
    : null;
  const written = selectedParticipant
    ? reviewStats(detail.obligations, Number(selectedParticipant.student_id), 'written')
    : null;
  const activeStats = reviewMode === 'received' ? received : written;

  const gradeMutation = useMutation({
    mutationFn: async () => {
      if (!selectedParticipant || !selectedStudent) throw new Error('원본 Guild3 참가자 정보를 찾지 못했습니다.');
      if (!draftGrade) throw new Error('등급을 선택해주세요.');
      if (draftGrade === currentGrade) throw new Error('현재 등급과 동일합니다.');

      const reason = correctionReason.trim();
      if (reason.length < 2) throw new Error('등급 정정 사유를 2자 이상 입력해주세요.');

      const needsOverride = !selectedStudent.latest_activity_record && draftGrade !== 'F';
      const override = overrideReason.trim();
      if (needsOverride && !override) {
        throw new Error('활동 기록 없이 F보다 높은 등급을 주는 예외 사유가 필요합니다.');
      }

      const sourceParticipantId = Number(selectedStudent.participant?.id);
      if (!Number.isFinite(sourceParticipantId) || sourceParticipantId <= 0) {
        throw new Error('원본 Guild3 참가자 ID를 찾지 못했습니다.');
      }

      const r = await guild3TeacherRpc.correctGrade(supabase, {
        p_participant_id: sourceParticipantId,
        p_grade: draftGrade,
        p_override_reason: needsOverride ? override : null,
        p_correction_reason: reason,
      });
      if (!r.success) throw new Error(guild3RpcError(r));
      return r.data;
    },
    onSuccess: async () => {
      show({
        title: `${selectedParticipant?.student_name ?? '학생'}의 개인 등급을 정정했어요`,
        variant: 'success',
      });
      setCorrectionReason('');
      setOverrideReason('');
      await Promise.all([
        qc.refetchQueries({ queryKey: ['guild3-teacher-detail', missionId] }),
        qc.invalidateQueries({ queryKey: ['guild3-teacher-list'] }),
        qc.invalidateQueries({ queryKey: ['guild2-admin'] }),
      ]);
    },
    onError: (error) => {
      show({
        title: '개인 등급 정정 실패',
        description: (error as Error).message,
        variant: 'error',
        duration: 6000,
      });
    },
  });

  if (!selectedParticipant) {
    return (
      <section className="rounded-card-md border border-line bg-bg-deep p-5 text-sm text-text-secondary">
        이 Round의 참가자 snapshot이 비어 있습니다.
      </section>
    );
  }

  const moveStudent = (delta: number) => {
    const next = detail.participants[selectedIndex + delta];
    if (!next) return;
    setSelectedStudentId(Number(next.student_id));
    setReviewMode('received');
  };

  const needsOverride = Boolean(draftGrade && draftGrade !== 'F' && !selectedStudent?.latest_activity_record);
  const canSaveGrade =
    Boolean(selectedStudent) &&
    Boolean(draftGrade) &&
    draftGrade !== currentGrade &&
    correctionReason.trim().length >= 2 &&
    (!needsOverride || overrideReason.trim().length > 0);

  return (
    <section className="space-y-4">
      <div>
        <h3 className="font-display text-lg">학생별 판정</h3>
        <p className="mt-1 text-xs text-text-secondary">
          평가 대상을 기준으로 동료평가를 모아서 보고, 원본 Guild3 개인 등급을 감사 이력을 남기며 정정합니다.
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="h-fit rounded-card-md border border-line bg-bg-deep p-2">
          <div className="px-2 pb-2 text-2xs font-black text-text-muted">
            길드원 · snapshot 순서
          </div>
          <div className="space-y-1">
            {detail.participants.map((participant) => {
              const studentId = Number(participant.student_id);
              const stats = reviewStats(detail.obligations, studentId, 'received');
              const source = sourceParticipantByStudentId.get(studentId);
              const grade = isGrade(source?.latest_grade_event?.grade)
                ? (source.latest_grade_event.grade as Grade)
                : '';
              const selected = studentId === Number(selectedStudentId);
              const incomplete = stats.submittedCount < stats.requiredCount;
              const spreadWarning = stats.range !== null && stats.range >= 5;

              return (
                <button
                  key={participant.participant_id}
                  type="button"
                  onClick={() => {
                    setSelectedStudentId(studentId);
                    setReviewMode('received');
                  }}
                  className={`w-full rounded-card-sm border p-2.5 text-left transition ${
                    selected
                      ? 'border-bv bg-bv/10'
                      : 'border-transparent bg-bg-card hover:border-bv/40'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <b className="truncate text-sm">{participant.student_name}</b>
                    {grade ? (
                      <span className="shrink-0 rounded-full bg-gold/15 px-2 py-0.5 text-2xs font-black text-gold">
                        {grade}
                      </span>
                    ) : (
                      <span className="shrink-0 text-2xs font-black text-warning">등급 -</span>
                    )}
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2 text-2xs text-text-muted">
                    <span>
                      받은 평가 {stats.submittedCount}/{stats.requiredCount}
                    </span>
                    <span>
                      {stats.average === null ? '평균 -' : `평균 ${stats.average.toFixed(1)}`}
                    </span>
                  </div>
                  {(incomplete || spreadWarning) && (
                    <div className="mt-1 text-2xs font-black text-warning">
                      {incomplete ? '● 미제출 있음' : '⚠ 점수 편차 큼'}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </aside>

        <div className="min-w-0 space-y-4">
          <div className="rounded-card-md border border-line bg-bg-deep p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-2xs font-black text-text-muted">평가 대상</div>
                <h4 className="mt-1 font-display text-xl">{selectedParticipant.student_name}</h4>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="btn-secondary !px-3 !py-1.5 text-xs"
                  disabled={selectedIndex <= 0}
                  onClick={() => moveStudent(-1)}
                >
                  ← 이전
                </button>
                <button
                  type="button"
                  className="btn-secondary !px-3 !py-1.5 text-xs"
                  disabled={selectedIndex < 0 || selectedIndex >= detail.participants.length - 1}
                  onClick={() => moveStudent(1)}
                >
                  다음 →
                </button>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-5">
              <MiniMetric
                label="받은 평가"
                value={`${received?.submittedCount ?? 0}/${received?.requiredCount ?? 0}`}
              />
              <MiniMetric label="평균" value={scoreText(received?.average ?? null, true)} />
              <MiniMetric label="최고" value={scoreText(received?.highest ?? null)} />
              <MiniMetric label="최저" value={scoreText(received?.lowest ?? null)} />
              <MiniMetric label="점수 범위" value={scoreText(received?.range ?? null)} />
            </div>

            {(received?.submittedCount ?? 0) < (received?.requiredCount ?? 0) && (
              <div className="mt-3 rounded-card-sm border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
                ⚠ 아직 제출되지 않은 동료평가가{' '}
                {(received?.requiredCount ?? 0) - (received?.submittedCount ?? 0)}건 있습니다.
                판정은 가능하지만 남은 평가를 확인하세요.
              </div>
            )}

            {(received?.range ?? 0) >= 5 && (
              <div className="mt-3 rounded-card-sm border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
                ⚠ 평가 편차가 큽니다. 최고 {received?.highest}점 · 최저 {received?.lowest}점 · 차이{' '}
                {received?.range}점입니다. 의견을 함께 확인하세요.
              </div>
            )}
          </div>

          <div className="rounded-card-md border border-line bg-bg-deep">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line p-3">
              <div className="flex gap-1 rounded-card-sm bg-bg-card p-1">
                <ModeButton
                  active={reviewMode === 'received'}
                  onClick={() => setReviewMode('received')}
                >
                  받은 평가 {received?.submittedCount ?? 0}/{received?.requiredCount ?? 0}
                </ModeButton>
                <ModeButton
                  active={reviewMode === 'written'}
                  onClick={() => setReviewMode('written')}
                >
                  작성한 평가 {written?.submittedCount ?? 0}/{written?.requiredCount ?? 0}
                </ModeButton>
              </div>
              {(activeStats?.excusedCount ?? 0) > 0 && (
                <span className="text-2xs font-black text-text-muted">
                  EXCUSED {activeStats?.excusedCount}건
                </span>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[650px] text-xs">
                <thead className="bg-bg-card text-text-muted">
                  <tr>
                    <ReviewTh>{reviewMode === 'received' ? '평가자' : '대상'}</ReviewTh>
                    <ReviewTh>상태</ReviewTh>
                    <ReviewTh>점수</ReviewTh>
                    <ReviewTh>의견</ReviewTh>
                    <ReviewTh>Revision</ReviewTh>
                  </tr>
                </thead>
                <tbody>
                  {(activeStats?.scoped ?? []).map((o) => (
                    <tr key={o.obligation_id} className="border-t border-line align-top">
                      <ReviewTd>
                        <b>{reviewMode === 'received' ? o.reviewer_name : o.target_name}</b>
                      </ReviewTd>
                      <ReviewTd>
                        {o.obligation_status === 'EXCUSED' ? (
                          <span className="font-black text-text-muted">EXCUSED</span>
                        ) : o.latest_review ? (
                          <span className="font-black text-success">제출 ✓</span>
                        ) : (
                          <span className="font-black text-warning">미제출</span>
                        )}
                      </ReviewTd>
                      <ReviewTd>{o.latest_review?.score ?? '-'}</ReviewTd>
                      <ReviewTd>
                        <div className="max-w-[420px] whitespace-pre-wrap">
                          {o.latest_review?.comment ??
                            (o.current_exception_reason
                              ? `면제: ${o.current_exception_reason}`
                              : '의견 없음')}
                        </div>
                      </ReviewTd>
                      <ReviewTd>
                        {o.latest_revision_number
                          ? `${o.latest_revision_number}차`
                          : o.latest_review?.revision_number
                            ? `${o.latest_review.revision_number}차`
                            : '-'}
                      </ReviewTd>
                    </tr>
                  ))}
                  {(activeStats?.scoped ?? []).length === 0 && (
                    <tr>
                      <td colSpan={5} className="p-8 text-center text-text-muted">
                        표시할 평가가 없습니다.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-card-md border border-gold/25 bg-gold/5 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h4 className="font-display text-lg">개인 등급 판정</h4>
                <p className="mt-1 text-xs text-text-secondary">
                  이 Round는 Guild3 FINALIZED snapshot에서 생성되므로 등급 변경은 기존 정정 API를 사용해
                  감사 이력을 보존합니다.
                </p>
              </div>
              <div className="text-right">
                <div className="text-2xs font-black text-text-muted">현재 등급</div>
                <div className="mt-1 font-display text-2xl text-gold">
                  {sourceMissionQ.isLoading ? '…' : currentGrade || '-'}
                </div>
              </div>
            </div>

            {sourceMissionQ.isError ? (
              <div className="mt-3 rounded-card-sm border border-danger/40 bg-danger/10 p-3 text-xs text-danger">
                {(sourceMissionQ.error as Error).message}
              </div>
            ) : !sourceMissionQ.isLoading && !selectedStudent ? (
              <div className="mt-3 rounded-card-sm border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
                원본 Guild3 참가자 정보를 찾지 못해 이 화면에서는 등급을 수정할 수 없습니다.
              </div>
            ) : (
              <>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {GRADE_OPTIONS.map((grade) => (
                    <button
                      key={grade}
                      type="button"
                      aria-pressed={draftGrade === grade}
                      disabled={busy || gradeMutation.isPending || !selectedStudent}
                      onClick={() => setDraftGrade(grade)}
                      className={`min-w-11 rounded border px-3 py-2 text-sm font-black transition ${
                        draftGrade === grade
                          ? 'border-gold bg-gold text-bg-deep ring-2 ring-gold/30'
                          : 'border-line bg-bg-card hover:border-gold/50'
                      }`}
                    >
                      {draftGrade === grade ? `✓ ${grade}` : grade}
                    </button>
                  ))}
                </div>

                {draftGrade && draftGrade !== currentGrade && (
                  <div className="mt-3 grid gap-3 lg:grid-cols-2">
                    <label className="block">
                      <span className="mb-1 block text-xs font-black text-text-muted">
                        등급 정정 사유 *
                      </span>
                      <input
                        className="input-field w-full"
                        value={correctionReason}
                        onChange={(e) => setCorrectionReason(e.target.value)}
                        maxLength={500}
                        placeholder="예: 동료평가 내용을 반영한 개인 기여도 재판정"
                      />
                    </label>

                    {needsOverride && (
                      <label className="block">
                        <span className="mb-1 block text-xs font-black text-warning">
                          활동 기록 없음 예외 사유 *
                        </span>
                        <input
                          className="input-field w-full"
                          value={overrideReason}
                          onChange={(e) => setOverrideReason(e.target.value)}
                          maxLength={500}
                          placeholder="F보다 높은 등급을 부여하는 근거"
                        />
                      </label>
                    )}
                  </div>
                )}

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-2xs text-text-muted">
                    동일 등급은 저장하지 않습니다. 변경 시 Guild3 등급 정정 이력에 남습니다.
                  </span>
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={busy || gradeMutation.isPending || !canSaveGrade}
                    onClick={() => gradeMutation.mutate()}
                  >
                    {gradeMutation.isPending ? '저장 중...' : '등급 정정 저장'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded px-3 py-1.5 text-xs font-black transition ${
        active ? 'bg-bv text-white' : 'text-text-secondary hover:bg-bg-deep'
      }`}
    >
      {children}
    </button>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-card-sm border border-line bg-bg-card p-2.5">
      <div className="text-2xs font-black text-text-muted">{label}</div>
      <div className="mt-1 font-display text-lg">{value}</div>
    </div>
  );
}

function ReviewTh({ children }: { children: ReactNode }) {
  return <th className="px-3 py-2 text-left font-black">{children}</th>;
}

function ReviewTd({ children }: { children: ReactNode }) {
  return <td className="px-3 py-2.5">{children}</td>;
}

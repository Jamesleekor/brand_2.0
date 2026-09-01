import { useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { TeacherShell } from '@/components/teacher/TeacherShell';
import { EmptyState, LoadingSpinner, Modal, useRpcCall } from '@/components/shared/components';
import { supabase } from '@/lib/supabase/client';
import { useClassroomId } from '@/stores/auth_store';
import {
  achievementA1Rpc,
  type AchievementEvaluationType,
  type AchievementGrade,
  type AchievementMasterInput,
  type AchievementMasterRow,
} from '@/lib/rpc/achievement_a1_rpc';
import { achievementA3Rpc } from '@/lib/rpc/achievement_a3_rpc';
import { achievementA4Rpc, type AchievementGrantHolder, type AchievementGrantPanel } from '@/lib/rpc/achievement_a4_rpc';
import { formatRelativeTime } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';

const GRADES: AchievementGrade[] = ['희귀', '유니크', '에픽', '히든', '유일', '초월'];
const PREFIXES = ['ACH', 'ART', 'CHAL', 'CONS', 'ECO', 'GUILD', 'HID', 'LIFE', 'MVP', 'RANK', 'START', 'STORY', 'STU', 'TEAM', 'VAC', 'EVENT', 'ETC'];

type FormState = {
  achievementUid: string;
  prefix: string;
  name: string;
  conditionText: string;
  grade: AchievementGrade;
  evaluationType: AchievementEvaluationType;
  isSecret: boolean;
  hint: string;
  achievementScore: string;
  rewardBv: string;
  rewardGold: string;
  rewardCrystal: string;
  sortOrder: string;
  autoEvalEnabled: boolean;
  evaluationQuery: string;
  reason: string;
};

function blankForm(): FormState {
  return {
    achievementUid: '',
    prefix: 'ETC',
    name: '',
    conditionText: '',
    grade: '희귀',
    evaluationType: 'QUALITATIVE',
    isSecret: false,
    hint: '',
    achievementScore: '0',
    rewardBv: '0',
    rewardGold: '0',
    rewardCrystal: '0',
    sortOrder: '0',
    autoEvalEnabled: false,
    evaluationQuery: '',
    reason: '',
  };
}

function rowToForm(row: AchievementMasterRow): FormState {
  return {
    achievementUid: row.achievement_uid,
    prefix: row.achievement_uid.split('-')[0] || 'ETC',
    name: row.name,
    conditionText: row.condition_text,
    grade: row.grade,
    evaluationType: row.evaluation_type,
    isSecret: row.is_secret,
    hint: row.hint ?? '',
    achievementScore: String(row.achievement_score ?? 0),
    rewardBv: String(row.reward_bv ?? 0),
    rewardGold: String(row.reward_gold ?? 0),
    rewardCrystal: String(row.reward_crystal ?? 0),
    sortOrder: String(row.sort_order ?? 0),
    autoEvalEnabled: row.auto_eval_enabled,
    evaluationQuery: row.evaluation_query ? JSON.stringify(row.evaluation_query, null, 2) : '',
    reason: '',
  };
}

function asNonNegativeInt(value: string) {
  return Math.max(0, Math.trunc(Number(value) || 0));
}

export default function AchievementMasterAdmin() {
  const classroomId = useClassroomId();
  const queryClient = useQueryClient();
  const { call, isLoading: actionLoading } = useRpcCall();
  const [search, setSearch] = useState('');
  const [grade, setGrade] = useState<AchievementGrade | 'ALL'>('ALL');
  const [active, setActive] = useState<'ACTIVE' | 'INACTIVE' | 'ALL'>('ACTIVE');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<AchievementMasterRow | null>(null);
  const [form, setForm] = useState<FormState>(blankForm());
  const [historyOpen, setHistoryOpen] = useState(false);
  const [grantRow, setGrantRow] = useState<AchievementMasterRow | null>(null);

  const masterQuery = useQuery<AchievementMasterRow[]>({
    queryKey: ['achievement-master-a1', classroomId],
    queryFn: async () => {
      if (!classroomId) return [];
      const r = await achievementA1Rpc.teacherMaster(supabase, classroomId);
      if (r.success === false) throw new Error(r.error);
      return r.data ?? [];
    },
    enabled: classroomId !== null,
  });

  const historyQuery = useQuery({
    queryKey: ['achievement-master-events-a1', classroomId],
    queryFn: async () => {
      if (!classroomId) return [];
      const r = await achievementA1Rpc.teacherEvents(supabase, classroomId, 50);
      if (r.success === false) throw new Error(r.error);
      return r.data ?? [];
    },
    enabled: Boolean(classroomId && historyOpen),
  });

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (masterQuery.data ?? []).filter((row) => {
      if (grade !== 'ALL' && row.grade !== grade) return false;
      if (active === 'ACTIVE' && !row.is_active) return false;
      if (active === 'INACTIVE' && row.is_active) return false;
      if (q) {
        const hay = [row.achievement_uid, row.name, row.condition_text, row.hint ?? ''].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [masterQuery.data, search, grade, active]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['achievement-master-a1'] });
    queryClient.invalidateQueries({ queryKey: ['achievement-master-events-a1'] });
    queryClient.invalidateQueries({ queryKey: ['achievements-safe-catalog'] });
  };

  const openCreate = () => {
    setEditing(null);
    setForm(blankForm());
    setEditorOpen(true);
  };

  const openEdit = (row: AchievementMasterRow) => {
    setEditing(row);
    setForm(rowToForm(row));
    setEditorOpen(true);
  };

  const suggestUid = async () => {
    if (!classroomId) return;
    await call(
      () => achievementA1Rpc.teacherSuggestUid(supabase, classroomId, form.prefix),
      {
        silent: true,
        onSuccess: (uid) => setForm((f) => ({ ...f, achievementUid: uid })),
      },
    );
  };

  const buildInput = (): AchievementMasterInput | null => {
    let evaluationQuery: Record<string, unknown> | null = null;
    if (form.autoEvalEnabled) {
      try {
        const parsed = JSON.parse(form.evaluationQuery || '{}');
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
        evaluationQuery = parsed;
      } catch {
        alert('자동 판정 규칙 JSON 형식을 확인해주세요.');
        return null;
      }
    }

    if (!form.name.trim() || !form.conditionText.trim()) {
      alert('업적 이름과 달성 조건은 필수입니다.');
      return null;
    }
    if (form.autoEvalEnabled && form.evaluationType !== 'QUANTITATIVE') {
      alert('자동 판정은 정량형 업적에서만 활성화할 수 있습니다.');
      return null;
    }

    return {
      p_name: form.name.trim(),
      p_condition_text: form.conditionText.trim(),
      p_grade: form.grade,
      p_evaluation_type: form.evaluationType,
      p_is_secret: form.isSecret,
      p_hint: form.hint.trim() || null,
      p_achievement_score: asNonNegativeInt(form.achievementScore),
      p_reward_bv: asNonNegativeInt(form.rewardBv),
      p_reward_gold: asNonNegativeInt(form.rewardGold),
      p_reward_crystal: asNonNegativeInt(form.rewardCrystal),
      p_auto_eval_enabled: form.autoEvalEnabled,
      p_evaluation_query: evaluationQuery,
      p_sort_order: Math.trunc(Number(form.sortOrder) || 0),
      p_reason: form.reason.trim() || null,
    };
  };

  const save = async () => {
    if (!classroomId) return;
    const base = buildInput();
    if (!base) return;

    if (editing) {
      await call(
        () => achievementA1Rpc.teacherUpdate(supabase, { ...base, p_achievement_id: editing.id }),
        {
          successTitle: '업적 수정 완료',
          onSuccess: () => {
            setEditorOpen(false);
            refresh();
          },
        },
      );
      return;
    }

    if (!form.achievementUid.trim()) {
      alert('업적 ID를 입력하거나 추천 버튼을 사용해주세요.');
      return;
    }

    await call(
      () => achievementA1Rpc.teacherCreate(supabase, {
        ...base,
        p_classroom_id: classroomId,
        p_achievement_uid: form.achievementUid.trim().toUpperCase(),
      }),
      {
        successTitle: '새 업적 등록 완료',
        successDescription: `${form.achievementUid.toUpperCase()} · ${form.name}`,
        onSuccess: () => {
          setEditorOpen(false);
          refresh();
        },
      },
    );
  };

  const toggleHelperReview = async (row: AchievementMasterRow) => {
    await call(
      () => achievementA3Rpc.teacherSetHelperReviewEnabled(supabase, {
        p_achievement_id: row.id,
        p_enabled: !row.helper_review_enabled,
      }),
      {
        successTitle: row.helper_review_enabled ? '도우미 검토 제외' : '도우미 검토 허용',
        onSuccess: refresh,
      },
    );
  };

  const toggleActive = async (row: AchievementMasterRow) => {
    const next = !row.is_active;
    const reason = prompt(
      next ? '다시 활성화하는 이유를 입력하세요. (선택)' : '비활성화 이유를 입력하세요. (선택)',
      '',
    );
    if (reason === null) return;

    await call(
      () => achievementA1Rpc.teacherSetActive(supabase, {
        p_achievement_id: row.id,
        p_active: next,
        p_reason: reason.trim() || null,
      }),
      {
        successTitle: next ? '업적 다시 활성화' : '업적 비활성화',
        onSuccess: refresh,
      },
    );
  };

  return (
    <TeacherShell>
      <div className="space-y-4 pb-20">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="font-display text-2xl text-brand-gradient tracking-tight">🏆 업적 Master</h1>
            <p className="mt-1 text-sm font-bold text-text-secondary">
              업적은 삭제하지 않고 비활성화합니다. 정량형도 자동 판정을 켜지 않으면 교사 승인형으로 바로 운영할 수 있습니다.
            </p>
          </div>
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={() => setHistoryOpen((v) => !v)}>
              🕘 변경 이력
            </button>
            <button className="btn-primary" onClick={openCreate}>＋ 새 업적</button>
          </div>
        </div>

        <div className="grid gap-2 rounded-card-lg border border-line bg-bg-card p-3 md:grid-cols-[1fr_auto_auto]">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ID · 업적명 · 조건 · 힌트 검색"
            className="w-full rounded-card-md border border-line-strong bg-bg-deep px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-primary"
          />
          <select value={grade} onChange={(e) => setGrade(e.target.value as AchievementGrade | 'ALL')} className="input-field">
            <option value="ALL">모든 등급</option>
            {GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
          <select value={active} onChange={(e) => setActive(e.target.value as typeof active)} className="input-field">
            <option value="ACTIVE">활성</option>
            <option value="INACTIVE">비활성</option>
            <option value="ALL">전체</option>
          </select>
        </div>

        <div className="flex items-center justify-between text-xs font-bold text-text-muted">
          <span>표시 {rows.length}개 / 전체 {(masterQuery.data ?? []).length}개</span>
          <span>SECRET은 학생 브라우저로 이름·조건·힌트가 전달되지 않습니다.</span>
        </div>

        {historyOpen && (
          <div className="rounded-card-lg border border-line bg-bg-card p-4">
            <h2 className="mb-3 font-display text-lg text-white">최근 변경 이력</h2>
            {historyQuery.isLoading ? <LoadingSpinner /> : (historyQuery.data ?? []).length === 0 ? (
              <div className="text-sm text-text-muted">기록이 없습니다.</div>
            ) : (
              <div className="space-y-2">
                {(historyQuery.data ?? []).map((event) => (
                  <div key={event.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-card-sm border border-line bg-bg-deep px-3 py-2 text-xs">
                    <span className="font-black text-gold">{event.event_type}</span>
                    <span className="text-text-secondary">업적 #{event.achievement_id ?? '-'}</span>
                    {event.reason && <span className="text-text-secondary">{event.reason}</span>}
                    <span className="ml-auto text-text-muted">{formatRelativeTime(event.created_at)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {masterQuery.isLoading ? (
          <div className="flex justify-center py-12"><LoadingSpinner size="lg" /></div>
        ) : rows.length === 0 ? (
          <EmptyState emoji="🏆" title="표시할 업적이 없습니다" description="새 업적을 만들거나 필터를 변경하세요." />
        ) : (
          <div className="grid gap-3 xl:grid-cols-2">
            {rows.map((row) => (
              <AchievementMasterCard key={row.id} row={row} onEdit={openEdit} onToggle={toggleActive} onToggleHelper={toggleHelperReview} onManageGrant={setGrantRow} />
            ))}
          </div>
        )}
      </div>

      <Modal
        isOpen={editorOpen}
        onClose={() => !actionLoading && setEditorOpen(false)}
        title={editing ? '업적 수정' : '새 업적 등록'}
        emoji="🏆"
        size="lg"
      >
        <AchievementEditor
          editing={editing}
          form={form}
          setForm={setForm}
          onSuggestUid={suggestUid}
          onSave={save}
          loading={actionLoading}
        />
      </Modal>


      {grantRow && classroomId && (
        <AchievementGrantManager
          row={grantRow}
          classroomId={classroomId}
          onClose={() => setGrantRow(null)}
          onChanged={refresh}
        />
      )}
    </TeacherShell>
  );
}

function AchievementMasterCard({
  row, onEdit, onToggle, onToggleHelper, onManageGrant,
}: {
  row: AchievementMasterRow;
  onEdit: (row: AchievementMasterRow) => void;
  onToggle: (row: AchievementMasterRow) => void;
  onToggleHelper: (row: AchievementMasterRow) => void;
  onManageGrant: (row: AchievementMasterRow) => void;
}) {
  return (
    <div className={cn('rounded-card-lg border bg-bg-card p-4', row.is_active ? 'border-line' : 'border-line opacity-60')}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            <span className="rounded-pill bg-bg-deep px-2 py-0.5 font-mono text-2xs font-black text-gold">{row.achievement_uid}</span>
            <span className="rounded-pill border border-line px-2 py-0.5 text-2xs font-black text-text-secondary">{row.grade}</span>
            {row.is_secret && <span className="rounded-pill bg-warning-bg px-2 py-0.5 text-2xs font-black text-warning">🔒 SECRET</span>}
            {row.is_global && <span className="rounded-pill bg-bv/10 px-2 py-0.5 text-2xs font-black text-bv">GLOBAL</span>}
            {!row.is_active && <span className="rounded-pill bg-danger-bg px-2 py-0.5 text-2xs font-black text-danger">비활성</span>}
            {!row.is_global && (
              <span className={cn('rounded-pill px-2 py-0.5 text-2xs font-black', row.helper_review_enabled ? 'bg-success-bg text-success' : 'bg-bg-deep text-text-muted')}>
                {row.helper_review_enabled ? '🔎 도우미 검토' : '👤 교사 전용'}
              </span>
            )}
          </div>
          <h3 className="font-display text-lg text-white">{row.name}</h3>
          <p className="mt-1 text-xs font-bold leading-relaxed text-text-secondary">{row.condition_text}</p>
        </div>
        <div className="shrink-0 text-right text-xs font-bold text-text-muted">
          <div>점수 {row.achievement_score}</div>
          <div>{row.evaluation_type === 'QUANTITATIVE' ? '정량' : '정성'} · {row.auto_eval_enabled ? 'AUTO' : 'MANUAL'}</div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-2xs font-bold">
        {row.reward_bv > 0 && <span className="text-bv">BV +{row.reward_bv}</span>}
        {row.reward_gold > 0 && <span className="text-gold">GOLD +{row.reward_gold}</span>}
        {row.reward_crystal > 0 && <span className="text-crystal">CRYSTAL +{row.reward_crystal}</span>}
        {row.hint && <span className="text-text-muted">💡 {row.hint}</span>}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
        <button
          onClick={() => onManageGrant(row)}
          className="rounded-card-md border border-gold/30 bg-gold/10 px-3 py-2 text-xs font-extrabold text-gold"
        >
          🎖️ 부여·보유자
        </button>
        <button
          onClick={() => onEdit(row)}
          disabled={row.is_global}
          className="btn-secondary disabled:cursor-not-allowed disabled:opacity-40"
          title={row.is_global ? '전역 업적은 학급 Master 화면에서 수정하지 않습니다.' : undefined}
        >
          수정
        </button>
        <button
          onClick={() => onToggleHelper(row)}
          disabled={row.is_global}
          className={cn('rounded-card-md px-3 py-2 text-xs font-extrabold disabled:cursor-not-allowed disabled:opacity-40', row.helper_review_enabled ? 'bg-bg-deep text-text-secondary border border-line' : 'bg-success-bg text-success')}
        >
          {row.helper_review_enabled ? '도우미 제외' : '도우미 허용'}
        </button>
        <button
          onClick={() => onToggle(row)}
          disabled={row.is_global}
          className={cn('rounded-card-md px-3 py-2 text-sm font-extrabold disabled:cursor-not-allowed disabled:opacity-40', row.is_active ? 'bg-danger-bg text-danger' : 'bg-success-bg text-success')}
        >
          {row.is_active ? '비활성화' : '다시 활성화'}
        </button>
      </div>
    </div>
  );
}

function AchievementGrantManager({
  row, classroomId, onClose, onChanged,
}: {
  row: AchievementMasterRow;
  classroomId: number;
  onClose: () => void;
  onChanged: () => void;
}) {
  const queryClient = useQueryClient();
  const { call, isLoading } = useRpcCall();
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [grantReason, setGrantReason] = useState('');
  const [uniqueConfirm, setUniqueConfirm] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<AchievementGrantHolder | null>(null);
  const [revokeReason, setRevokeReason] = useState('');

  const panel = useQuery<AchievementGrantPanel>({
    queryKey: ['achievement-grant-panel-a4', classroomId, row.id],
    queryFn: async () => {
      const result = await achievementA4Rpc.teacherGrantPanel(supabase, classroomId, row.id);
      if (result.success === false) throw new Error(result.error);
      return result.data!;
    },
  });

  const refreshPanel = () => {
    void queryClient.invalidateQueries({ queryKey: ['achievement-grant-panel-a4', classroomId, row.id] });
    void queryClient.invalidateQueries({ queryKey: ['achievements-safe-catalog'] });
    void queryClient.invalidateQueries({ queryKey: ['achievement-titles'] });
    void queryClient.invalidateQueries({ queryKey: ['review-achievements'] });
    onChanged();
  };

  const grantNow = async () => {
    if (!selectedStudentId) return;
    await call(
      () => achievementA4Rpc.teacherGrantDirect(supabase, {
        p_student_id: Number(selectedStudentId),
        p_achievement_id: row.id,
        p_reason: grantReason.trim() || null,
      }),
      {
        successTitle: '🏆 업적 직접 부여 완료',
        successDescription: '보상·마일스톤·히든 공개·필요한 전역 알림과 우편까지 함께 처리했습니다.',
        onSuccess: () => {
          setUniqueConfirm(false);
          setSelectedStudentId('');
          setGrantReason('');
          refreshPanel();
        },
      },
    );
  };

  const requestGrant = async () => {
    if (!selectedStudentId || !panel.data?.achievement.is_active) return;
    if (row.grade === '유일' && (panel.data?.holder_count ?? 0) > 0) {
      setUniqueConfirm(true);
      return;
    }
    await grantNow();
  };

  const revoke = async () => {
    if (!revokeTarget || revokeReason.trim().length < 2) return;
    await call(
      () => achievementA4Rpc.teacherRevokeDirect(supabase, {
        p_student_achievement_id: revokeTarget.student_achievement_id,
        p_reason: revokeReason.trim(),
      }),
      {
        successTitle: '↩️ 업적 회수 완료',
        successDescription: `${revokeTarget.student_name}에게 회수 사유 우편을 보냈습니다.`,
        onSuccess: () => {
          setRevokeTarget(null);
          setRevokeReason('');
          refreshPanel();
        },
      },
    );
  };

  const eligible = (panel.data?.students ?? []).filter((student) => !student.has_achievement);

  return (
    <Modal isOpen onClose={() => !isLoading && onClose()} title="업적 부여 · 보유자 관리" emoji="🎖️" size="lg">
      {panel.isLoading ? <div className="py-8 flex justify-center"><LoadingSpinner /></div> : panel.isError || !panel.data ? (
        <EmptyState emoji="⚠️" title="업적 보유 정보를 불러오지 못했습니다" />
      ) : (
        <div className="space-y-4">
          <div className="rounded-card-md border border-line bg-bg-deep p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-2xs font-black text-gold">{row.achievement_uid}</span>
              <span className="rounded-pill bg-bv/10 px-2 py-0.5 text-2xs font-black text-bv">{row.grade}</span>
              {panel.data.achievement.is_secret && <span className="rounded-pill bg-warning-bg px-2 py-0.5 text-2xs font-black text-warning">🔒 미공개 SECRET</span>}
            </div>
            <div className="mt-1 font-display text-lg text-white">{row.name}</div>
            <div className="mt-1 text-xs font-bold text-text-secondary">현재 보유자 {panel.data.holder_count}명</div>
          </div>

          <section className="rounded-card-md border border-line bg-bg-card p-3">
            <h4 className="text-sm font-black text-white">교사 직접 부여</h4>
            <p className="mt-1 text-xs font-semibold leading-relaxed text-text-muted">신청 없이 교사가 달성을 인정할 때 사용합니다. 개별 보상과 누적 마일스톤도 동일하게 적용됩니다.</p>
            {panel.data.achievement.is_secret && panel.data.holder_count === 0 && (
              <div className="mt-2 rounded-card-sm border border-warning/30 bg-warning-bg/30 p-2.5 text-xs font-bold text-warning">⚠️ 이 업적의 첫 직접 부여는 SECRET을 공개하고 전역 알림을 발생시킵니다.</div>
            )}
            <select value={selectedStudentId} onChange={(e) => { setSelectedStudentId(e.target.value); setUniqueConfirm(false); }} className="login-input mt-3 w-full">
              <option value="">-- 부여할 학생 선택 --</option>
              {eligible.map((student) => <option key={student.student_id} value={student.student_id}>{student.student_name}</option>)}
            </select>
            <input value={grantReason} onChange={(e) => setGrantReason(e.target.value)} maxLength={500} placeholder="직접 부여 메모 (선택)" className="input-field mt-2 w-full" />
            {uniqueConfirm && (
              <div className="mt-2 rounded-card-sm border border-warning/30 bg-warning-bg/30 p-3">
                <div className="text-sm font-black text-warning">🌌 유일 등급 확인</div>
                <p className="mt-1 text-xs font-semibold leading-relaxed text-text-secondary">이미 {panel.data.holder_count}명이 이 유일 업적을 보유하고 있습니다. 공동 달성 등 정당한 사유라면 계속 부여할 수 있습니다.</p>
                <div className="mt-2 flex gap-2"><button className="btn-secondary flex-1" onClick={() => setUniqueConfirm(false)}>취소</button><button className="btn-primary flex-1" onClick={grantNow} disabled={isLoading}>그래도 부여</button></div>
              </div>
            )}
            {!uniqueConfirm && <button className="btn-primary mt-2 w-full" onClick={requestGrant} disabled={isLoading || !selectedStudentId || !panel.data.achievement.is_active}>{panel.data.achievement.is_active ? '선택 학생에게 업적 부여' : '비활성 업적은 부여할 수 없음'}</button>}
          </section>

          <section>
            <h4 className="mb-2 text-sm font-black text-white">현재 보유자</h4>
            {panel.data.holders.length === 0 ? <EmptyState emoji="🏆" title="아직 보유자가 없습니다" /> : (
              <div className="space-y-2">
                {panel.data.holders.map((holder) => (
                  <div key={holder.student_achievement_id} className="rounded-card-md border border-line bg-bg-deep p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="font-black text-white">{holder.student_name} {holder.is_equipped && <span className="text-2xs text-gold">· 칭호 장착 중</span>}</div>
                        <div className="mt-1 text-2xs font-bold text-text-muted">획득 {formatRelativeTime(holder.achieved_at)}</div>
                      </div>
                      <button className="rounded-pill border border-danger/40 px-3 py-1.5 text-xs font-black text-danger" onClick={() => { setRevokeTarget(holder); setRevokeReason(''); }}>회수</button>
                    </div>
                    {revokeTarget?.student_achievement_id === holder.student_achievement_id && (
                      <div className="mt-3 rounded-card-sm border border-danger/25 bg-danger-bg/20 p-3">
                        <p className="text-xs font-semibold text-text-secondary">회수하면 이 업적의 개별 BV/GOLD/CRYSTAL 보상 거래가 되돌려지고 장착 칭호도 해제됩니다. 이미 공개된 히든 업적과 과거 마일스톤 보상은 다시 숨기거나 회수하지 않습니다.</p>
                        <textarea value={revokeReason} onChange={(e) => setRevokeReason(e.target.value)} rows={3} maxLength={500} className="input-field mt-2 w-full resize-none" placeholder="회수 사유 (필수)" />
                        <div className="mt-2 flex gap-2"><button className="btn-secondary flex-1" onClick={() => setRevokeTarget(null)}>취소</button><button className="btn-danger flex-1" onClick={revoke} disabled={isLoading || revokeReason.trim().length < 2}>회수 확정</button></div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </Modal>
  );
}

function AchievementEditor({
  editing, form, setForm, onSuggestUid, onSave, loading,
}: {
  editing: AchievementMasterRow | null;
  form: FormState;
  setForm: Dispatch<SetStateAction<FormState>>;
  onSuggestUid: () => void;
  onSave: () => void;
  loading: boolean;
}) {
  const patch = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="업적 ID">
            {editing ? (
              <div className="input-field opacity-70">{form.achievementUid} <span className="ml-2 text-2xs text-text-muted">ID는 수정하지 않음</span></div>
            ) : (
              <div className="grid grid-cols-[96px_minmax(150px,1fr)_auto] gap-2">
                <select value={form.prefix} onChange={(e) => patch('prefix', e.target.value)} className="input-field w-full">
                  {PREFIXES.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
                <input value={form.achievementUid} onChange={(e) => patch('achievementUid', e.target.value.toUpperCase())} placeholder="ECO-001" className="input-field w-full min-w-[150px] font-mono" />
                <button type="button" onClick={onSuggestUid} className="btn-secondary whitespace-nowrap px-4">추천</button>
              </div>
            )}
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="업적명 = 칭호명">
            <input value={form.name} onChange={(e) => patch('name', e.target.value)} maxLength={80} className="input-field w-full" />
          </Field>
        </div>
      </div>

      <Field label="달성 조건">
        <textarea value={form.conditionText} onChange={(e) => patch('conditionText', e.target.value)} rows={3} maxLength={2000} className="input-field w-full resize-y" />
      </Field>

      <Field label="힌트 (선택)">
        <input value={form.hint} onChange={(e) => patch('hint', e.target.value)} maxLength={500} className="input-field w-full" />
      </Field>

      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="등급">
          <select value={form.grade} onChange={(e) => patch('grade', e.target.value as AchievementGrade)} className="input-field w-full">
            {GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </Field>
        <Field label="조건 성격">
          <select value={form.evaluationType} onChange={(e) => {
            const next = e.target.value as AchievementEvaluationType;
            patch('evaluationType', next);
            if (next === 'QUALITATIVE') patch('autoEvalEnabled', false);
          }} className="input-field w-full">
            <option value="QUALITATIVE">정성</option>
            <option value="QUANTITATIVE">정량</option>
          </select>
        </Field>
        <Field label="업적 점수">
          <input type="number" min={0} value={form.achievementScore} onChange={(e) => patch('achievementScore', e.target.value)} className="input-field w-full" />
        </Field>
        <Field label="정렬 순서">
          <input type="number" value={form.sortOrder} onChange={(e) => patch('sortOrder', e.target.value)} className="input-field w-full" />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="BV 보상"><input type="number" min={0} value={form.rewardBv} onChange={(e) => patch('rewardBv', e.target.value)} className="input-field w-full" /></Field>
        <Field label="GOLD 보상"><input type="number" min={0} value={form.rewardGold} onChange={(e) => patch('rewardGold', e.target.value)} className="input-field w-full" /></Field>
        <Field label="CRYSTAL 보상"><input type="number" min={0} value={form.rewardCrystal} onChange={(e) => patch('rewardCrystal', e.target.value)} className="input-field w-full" /></Field>
      </div>

      <div className="grid gap-3 rounded-card-md border border-line bg-bg-deep p-3 sm:grid-cols-2">
        <label className="flex cursor-pointer items-start gap-2 text-sm font-bold text-text-primary">
          <input type="checkbox" checked={form.isSecret} onChange={(e) => patch('isSecret', e.target.checked)} className="mt-1" />
          <span><b>SECRET</b><small className="mt-0.5 block text-2xs text-text-muted">최초 공개 전 이름·조건·힌트를 학생에게 보내지 않음</small></span>
        </label>
        <label className={cn('flex items-start gap-2 text-sm font-bold', form.evaluationType === 'QUANTITATIVE' ? 'cursor-pointer text-text-primary' : 'cursor-not-allowed text-text-muted')}>
          <input type="checkbox" checked={form.autoEvalEnabled} disabled={form.evaluationType !== 'QUANTITATIVE'} onChange={(e) => patch('autoEvalEnabled', e.target.checked)} className="mt-1" />
          <span><b>자동 판정 활성화</b><small className="mt-0.5 block text-2xs text-text-muted">기본은 꺼짐. 정량형도 MANUAL로 바로 등록 가능</small></span>
        </label>
      </div>

      {form.evaluationType === 'QUANTITATIVE' && (
        <Field label={form.autoEvalEnabled ? '자동 판정 DSL JSON (고급)' : '정량 판단 근거 DSL JSON (도우미·교사용)'}>
          <textarea
            value={form.evaluationQuery}
            onChange={(e) => patch('evaluationQuery', e.target.value)}
            rows={5}
            className="input-field w-full font-mono text-xs"
            placeholder={'{\n  "metric": "..."\n}'}
          />
          <div className="mt-1.5 text-2xs font-semibold leading-relaxed text-text-muted">
            {form.autoEvalEnabled
              ? '이 규칙으로 자동 판정합니다. PASS/FAIL/BORDERLINE 결과가 신청 처리에 반영됩니다.'
              : '자동 판정은 하지 않습니다. 이 규칙은 업적검증도우미와 교사가 현재값·목표값을 확인하는 판단 근거로만 사용합니다.'}
          </div>
        </Field>
      )}

      {editing && (
        <Field label="변경 사유 (선택 · 감사 로그)">
          <input value={form.reason} onChange={(e) => patch('reason', e.target.value)} maxLength={500} className="input-field w-full" />
        </Field>
      )}

      <button onClick={onSave} disabled={loading} className="btn-primary w-full">
        {loading ? '저장 중...' : editing ? '변경사항 저장' : '업적 등록'}
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="block">
      <div className="mb-1.5 block text-xs font-extrabold text-text-secondary">{label}</div>
      {children}
    </div>
  );
}

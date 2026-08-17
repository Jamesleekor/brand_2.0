import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { TeacherShell } from '@/components/teacher/TeacherShell';
import { LoadingSpinner, useRpcCall } from '@/components/shared/components';
import { supabase } from '@/lib/supabase/client';
import { guildTeacherRpc } from '@/lib/rpc/guild_rpc';
import { useClassroomId } from '@/stores/auth_store';
import { formatNumber, getKstDateString } from '@/lib/utils/format';

const OBSERVATION_CATEGORIES = [
  ['COOPERATION', '협력'],
  ['LEADERSHIP', '리더십'],
  ['RESPONSIBILITY', '책임'],
  ['SUPPORT', '지원'],
  ['PROBLEM_SOLVING', '문제해결'],
  ['OTHER', '기타'],
] as const;

const STATUS_LABEL: Record<string, string> = {
  READY: '집계됨',
  PENDING: '기록 대기',
  NOT_READY: '연결 전',
  RESOLVED: '임시 배정됨',
  NEEDS_ROSTER_RESOLUTION: '길드 배정 확인 필요',
};

const displayStudent = (student: any) => student?.brand_name || student?.name || `학생 #${student?.id ?? '?'}`;
const idKey = () => crypto.randomUUID();

export default function GuildScoreAdmin() {
  const classroomId = useClassroomId();
  const [yearMonth, setYearMonth] = useState(getKstDateString().slice(0, 7));
  const client = useQueryClient();
  const query = useGuild2AdminData(classroomId, yearMonth);

  useEffect(() => {
    if (!classroomId) return;
    const refresh = () => void client.invalidateQueries({ queryKey: ['guild2-admin', classroomId, yearMonth] });
    const tables = [
      'guild2_observation_events',
      'guild2_compensation_configs',
      'guild2_individual_contributions',
      'guild2_gs_events',
      'guild2_monthly_gs_summaries',
    ];
    const channels = tables.map((table) => supabase.channel(`guild2-admin:${table}:${classroomId}`).on(
      'postgres_changes',
      { event: '*', schema: 'public', table, filter: `classroom_id=eq.${classroomId}` },
      refresh,
    ).subscribe());
    return () => { channels.forEach((channel) => void supabase.removeChannel(channel)); };
  }, [classroomId, client, yearMonth]);

  return (
    <TeacherShell>
      <div className="space-y-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h1 className="font-display text-2xl text-brand-gradient">📊 길드 점수 <span className="text-xs text-text-muted">Guild 2A · 초안</span></h1>
            <p className="mt-1 text-sm font-bold text-text-secondary">새 개인 기여도 산식과 GS 기록장을 관리합니다. 월 최종 확정은 아직 만들지 않았습니다.</p>
          </div>
          <Link to="/teacher/guild" className="btn-secondary">← Guild 1 운영으로</Link>
        </div>

        <section className="glass-card flex flex-col gap-3 p-4 md:flex-row md:items-end">
          <label className="block text-xs font-black text-text-secondary">조회할 월
            <input type="month" className="input-field mt-1.5 block" value={yearMonth} onChange={(event) => setYearMonth(event.target.value)} />
          </label>
          <p className="flex-1 text-xs leading-relaxed text-text-secondary">Guild2는 <b className="text-white">현재 월 DRAFT 계산기</b>입니다. 미션·동료평가·Arcade 등 연결된 점수원을 현재값에 반영하며, 월 최종 확정은 Guild5에서 snapshot으로 고정합니다.</p>
          <RecalculateButton classroomId={classroomId} yearMonth={yearMonth} />
        </section>

        {query.isLoading && <div className="flex justify-center py-14"><LoadingSpinner size="lg" /></div>}
        {query.isError && <LoadError error={query.error} retry={() => void query.refetch()} />}
        {query.data && <Guild2ScoreContents data={query.data} />}
      </div>
    </TeacherShell>
  );
}

function useGuild2AdminData(classroomId: number | null, yearMonth: string) {
  return useQuery({
    queryKey: ['guild2-admin', classroomId, yearMonth],
    enabled: !!classroomId && /^\d{4}-(0[1-9]|1[0-2])$/.test(yearMonth),
    queryFn: async () => {
      const [students, seasons, guilds, contributions, summaries, configs, observations, ledger] = await Promise.all([
        supabase.from('students').select('id,name,brand_name,role,transferred_at').eq('classroom_id', classroomId!).order('name'),
        supabase.from('guild_seasons').select('id,display_name,starts_on,ends_on,start_date,end_date,lifecycle_status').eq('classroom_id', classroomId!).order('starts_on', { ascending: false }),
        supabase.from('guilds').select('id,name,season_id,is_active').eq('classroom_id', classroomId!).order('id'),
        supabase.from('guild2_individual_contributions').select('*').eq('classroom_id', classroomId!).eq('year_month', yearMonth).order('final_total', { ascending: false }),
        supabase.from('guild2_monthly_gs_summaries').select('*').eq('classroom_id', classroomId!).eq('year_month', yearMonth).order('draft_rank'),
        supabase.from('guild2_compensation_configs').select('*').eq('classroom_id', classroomId!),
        supabase.from('guild2_observation_events').select('*').eq('classroom_id', classroomId!).eq('year_month', yearMonth).order('created_at', { ascending: false }),
        supabase.from('guild2_gs_events').select('*').eq('classroom_id', classroomId!).eq('year_month', yearMonth).order('created_at', { ascending: false }).limit(100),
      ]);
      const responses = { students, seasons, guilds, contributions, summaries, configs, observations, ledger };
      for (const [name, response] of Object.entries(responses)) {
        if (response.error) throw new Error(`[Guild 2:${name}] ${response.error.message}`);
      }

      const monthStart = `${yearMonth}-01`;
      const year = Number(yearMonth.slice(0, 4));
      const month = Number(yearMonth.slice(5, 7));
      const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
      const monthEnd = `${yearMonth}-${String(daysInMonth).padStart(2, '0')}`;
      const season = (seasons.data ?? []).find((row: any) => {
        const startsOn = row.starts_on || row.start_date;
        const endsOn = row.ends_on || row.end_date;
        return startsOn <= monthEnd && endsOn >= monthStart;
      }) ?? null;
      const activeStudents = (students.data ?? []).filter((student: any) => !student.transferred_at && ['STUDENT', 'STUDENT_LEADER', 'GUARD'].includes(String(student.role)));
      return {
        classroomId: classroomId!,
        yearMonth,
        season,
        students: activeStudents,
        allStudents: students.data ?? [],
        guilds: (guilds.data ?? []).filter((guild: any) => !season || Number(guild.season_id) === Number(season.id)),
        contributions: contributions.data ?? [],
        summaries: summaries.data ?? [],
        configs: configs.data ?? [],
        observations: observations.data ?? [],
        ledger: ledger.data ?? [],
      };
    },
  });
}

function RecalculateButton({ classroomId, yearMonth }: { classroomId: number | null; yearMonth: string }) {
  const client = useQueryClient();
  const { call, isLoading } = useRpcCall();
  const refresh = () => void client.invalidateQueries({ queryKey: ['guild2-admin', classroomId, yearMonth] });
  return <button disabled={!classroomId || isLoading} className="btn-primary" onClick={() => {
    if (!classroomId) return;
    void call(
      () => guildTeacherRpc.recalculateGuild2Scores(supabase, { p_classroom_id: classroomId, p_year_month: yearMonth }),
      { successTitle: '점수 초안을 다시 계산했어요', successDescription: '기존 GS 기록은 수정하지 않고, 필요한 취소·새 기록을 남겼습니다.', onSuccess: refresh },
    );
  }}>{isLoading ? '계산 중...' : '↻ 점수 다시 계산'}</button>;
}

function Guild2ScoreContents({ data }: { data: any }) {
  const client = useQueryClient();
  const { call, isLoading } = useRpcCall();
  const [observationStudentId, setObservationStudentId] = useState('');
  const [category, setCategory] = useState<(typeof OBSERVATION_CATEGORIES)[number][0]>('COOPERATION');
  const [reason, setReason] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [occurredOn, setOccurredOn] = useState(getKstDateString());
  const [adjustmentGuildId, setAdjustmentGuildId] = useState('');
  const [adjustmentPoints, setAdjustmentPoints] = useState('');
  const [adjustmentReason, setAdjustmentReason] = useState('');
  const [reversalTarget, setReversalTarget] = useState<number | null>(null);
  const [reversalReason, setReversalReason] = useState('');
  const refresh = () => void client.invalidateQueries({ queryKey: ['guild2-admin', data.classroomId, data.yearMonth] });
  const studentById = useMemo(() => new Map<number, any>(data.allStudents.map((student: any) => [Number(student.id), student])), [data.allStudents]);
  const contributionByStudent = useMemo(() => new Map<number, any>(data.contributions.map((row: any) => [Number(row.student_id), row])), [data.contributions]);
  const summaryByGuild = useMemo(() => new Map<number, any>(data.summaries.map((row: any) => [Number(row.guild_id), row])), [data.summaries]);
  const configByGuild = useMemo(() => new Map<number, any>(data.configs.map((row: any) => [Number(row.guild_id), row])), [data.configs]);
  const reversedEventIds = useMemo(() => new Set(data.observations.filter((row: any) => row.event_kind === 'REVERSAL').map((row: any) => Number(row.reversal_of))), [data.observations]);

  useEffect(() => {
    const today = getKstDateString();
    setOccurredOn(today.startsWith(data.yearMonth) ? today : `${data.yearMonth}-01`);
  }, [data.yearMonth]);

  const logObservation = () => {
    const studentId = Number(observationStudentId);
    if (!studentId) return;
    void call(() => guildTeacherRpc.recordGuild2Observation(supabase, {
      p_student_id: studentId,
      p_category: category,
      p_reason: reason,
      p_is_public: isPublic,
      p_occurred_on: occurredOn,
      p_idempotency_key: idKey(),
    }), {
      successTitle: '길드 기여 기록을 남겼어요',
      successDescription: '개인 기여도와 길드 GS 초안도 함께 다시 계산되었습니다.',
      onSuccess: () => { setReason(''); setIsPublic(false); refresh(); },
    });
  };

  const postAdjustment = () => {
    const guildId = Number(adjustmentGuildId);
    const points = Number(adjustmentPoints);
    if (!guildId || !Number.isFinite(points)) return;
    void call(() => guildTeacherRpc.postGuild2GsAdjustment(supabase, {
      p_classroom_id: data.classroomId,
      p_year_month: data.yearMonth,
      p_guild_id: guildId,
      p_points: points,
      p_reason: adjustmentReason,
      p_idempotency_key: idKey(),
    }), {
      successTitle: 'GS 조정 기록을 남겼어요',
      successDescription: '기존 GS 기록은 지우지 않고 새 기록을 추가했습니다.',
      onSuccess: () => { setAdjustmentPoints(''); setAdjustmentReason(''); refresh(); },
    });
  };

  return <div className="space-y-5">
    {!data.season && <div className="glass-card border-warning/40 p-4 text-sm text-warning">선택한 월이 어떤 길드 시즌에도 들어 있지 않습니다. 날짜를 확인한 뒤 다시 계산해주세요.</div>}
    <div className="grid gap-3 md:grid-cols-3">
      <Stat label="선택한 시즌" value={data.season?.display_name || '확인 필요'} sub={data.season ? '시즌 기간 안의 월입니다.' : '점수 계산을 시작할 수 없습니다.'} />
      <Stat label="개인 초안" value={`${data.contributions.length}명`} sub="Guild 1 소속/세션 snapshot을 바탕으로 계산" />
      <Stat label="미래 기능" value="3개" sub="미션 · 동료평가 · 아케이드는 연결 전" />
    </div>

    <section className="glass-card p-4">
      <div className="mb-3"><h2 className="font-display text-lg">길드별 GS 초안</h2><p className="mt-1 text-xs text-text-secondary">개인 기여도 + 공식 Mission GS + 인원 보정 + 수동 조정의 합입니다. Guild5 FINAL 전까지 점수원 변경에 따라 다시 계산될 수 있습니다.</p></div>
      <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">{data.guilds.map((guild: any) => {
        const summary = summaryByGuild.get(Number(guild.id));
        const config = configByGuild.get(Number(guild.id));
        const enabled = Boolean(config?.enabled);
        return <div key={guild.id} className="rounded-card-md border border-line bg-bg-deep p-4">
          <div className="flex items-start justify-between gap-2"><div><div className="font-black text-white">{guild.name}</div><div className="mt-1 text-xs text-text-secondary">초안 순위 {summary?.draft_rank ? `${summary.draft_rank}위` : '집계 전'}</div></div><span className={`rounded-pill px-2 py-1 text-[10px] font-black ${enabled ? 'bg-success/15 text-success' : 'bg-bg-card text-text-secondary'}`}>{enabled ? '인원 보정 적용' : '인원 보정 없음'}</span></div>
          <div className="mt-4 font-display text-3xl text-gold">{summary ? formatNumber(Number(summary.draft_gs_total)) : '—'} <span className="text-sm">GS</span></div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-text-secondary"><div>개인 합계 <b className="text-white">{formatNumber(Number(summary?.individual_subtotal ?? 0))}</b></div><div>미션 GS <b className="text-white">{formatNumber(Number(summary?.mission_gs_subtotal ?? 0))}</b></div><div>인원 보정 <b className="text-white">{formatNumber(Number(summary?.compensation_amount ?? 0))}</b></div><div>수동 조정 <b className="text-white">{formatNumber(Number(summary?.manual_adjustment_total ?? 0))}</b></div></div>
          <label className="mt-4 flex cursor-pointer items-start gap-2 text-xs text-text-secondary"><input type="checkbox" checked={enabled} disabled={!data.season || isLoading} onChange={(event) => void call(() => guildTeacherRpc.setGuild2Compensation(supabase, { p_guild_id: Number(guild.id), p_season_id: Number(data.season.id), p_enabled: event.target.checked, p_year_month: data.yearMonth }), { successTitle: event.target.checked ? '인원 보정을 켰어요' : '인원 보정을 껐어요', successDescription: '실제 현재 인원과 무관하게 이 길드/시즌에만 적용됩니다.', onSuccess: refresh })} /><span><b className="text-white">인원 보정 대상 길드</b><br />평균 기본기여도 × 0.5 → 10점 단위 반올림</span></label>
        </div>;
      })}</div>
    </section>

    <section className="glass-card p-4">
      <div className="mb-3"><h2 className="font-display text-lg">학생별 개인 기여도 초안</h2><p className="mt-1 text-xs text-text-secondary">연결 전인 항목은 완료된 0점이 아니라, 아직 점수원이 연결되지 않았다는 뜻입니다.</p></div>
      {!data.students.length ? <p className="text-sm text-text-secondary">표시할 재학생이 없습니다.</p> : <div className="overflow-x-auto"><table className="w-full min-w-[1040px] text-left text-xs"><thead className="border-b border-line text-text-secondary"><tr><th className="p-2">학생</th><th className="p-2">동료평가</th><th className="p-2">미션</th><th className="p-2">세션</th><th className="p-2">기여 기록</th><th className="p-2">기본</th><th className="p-2">아케이드</th><th className="p-2">최종</th><th className="p-2">길드 맥락</th></tr></thead><tbody>{data.students.map((student: any) => {
        const row = contributionByStudent.get(Number(student.id));
        return <tr key={student.id} className="border-b border-line/70 last:border-0"><td className="p-2 font-black text-white">{displayStudent(student)}<div className="mt-0.5 text-[10px] font-normal text-text-secondary">{student.name}</div></td><ScoreCell value={row?.peer_points} max={300} status={row?.peer_status} /><ScoreCell value={row?.mission_points} max={300} status={row?.mission_status} /><ScoreCell value={row?.session_points} max={150} status={row?.session_status} detail={row ? `불참 ${row.session_absent_count}회` : undefined} /><ScoreCell value={row?.teacher_observation_points} max={150} status={row?.teacher_observation_status} detail={row ? `${row.observation_count}건` : undefined} /><ScoreCell value={row?.basic_total} max={900} /><td className="p-2 text-text-secondary">원점수 {formatNumber(Number(row?.arcade_raw_total ?? 0))}<br /><b className="text-white">+{formatNumber(Number(row?.arcade_applied ?? 0))} / 90</b><div className="mt-1 text-[10px] text-warning">{STATUS_LABEL[row?.arcade_status] || '연결 전'}</div></td><td className="p-2 font-black text-gold">{formatNumber(Number(row?.final_total ?? 0))} / 990</td><td className="p-2"><span className={row?.guild_context_status === 'RESOLVED' ? 'text-success' : 'text-warning'}>{STATUS_LABEL[row?.guild_context_status] || '계산 전'}</span></td></tr>;
      })}</tbody></table></div>}
    </section>

    <section className="grid gap-5 xl:grid-cols-2">
      <div className="glass-card p-4"><div className="mb-3"><h2 className="font-display text-lg">+ 교사 길드 기여 기록</h2><p className="mt-1 text-xs text-text-secondary">의미 있는 협력·지원 행동을 짧게 남겨주세요. 한 건은 +10점이며, 한 달에 최대 150점까지만 반영됩니다.</p></div><div className="space-y-3"><select className="input-field w-full" value={observationStudentId} onChange={(event) => setObservationStudentId(event.target.value)}><option value="">학생 선택</option>{data.students.map((student: any) => <option key={student.id} value={student.id}>{displayStudent(student)} ({student.name})</option>)}</select><div className="grid grid-cols-2 gap-2"><select className="input-field w-full" value={category} onChange={(event) => setCategory(event.target.value as typeof category)}>{OBSERVATION_CATEGORIES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select><input type="date" className="input-field w-full" value={occurredOn} min={`${data.yearMonth}-01`} max={data.yearMonth === getKstDateString().slice(0, 7) ? getKstDateString() : undefined} onChange={(event) => setOccurredOn(event.target.value)} /></div><textarea className="input-field min-h-24 w-full" value={reason} maxLength={300} onChange={(event) => setReason(event.target.value)} placeholder="학생이 실제로 한 기여를 짧고 구체적으로 기록하세요. (2~300자)" /><label className="flex items-center gap-2 text-sm text-text-secondary"><input type="checkbox" checked={isPublic} onChange={(event) => setIsPublic(event.target.checked)} />이 메모를 학생에게 공개</label><button className="btn-primary w-full" disabled={isLoading || !observationStudentId || reason.trim().length < 2 || !occurredOn.startsWith(data.yearMonth)} onClick={logObservation}>{isLoading ? '저장 중...' : '기여 기록 저장'}</button></div></div>
      <div className="glass-card p-4"><div className="mb-3"><h2 className="font-display text-lg">기록장과 취소</h2><p className="mt-1 text-xs text-text-secondary">잘못된 기록은 지우지 않습니다. 취소 사유를 남기고, 점수에는 더 이상 반영하지 않습니다.</p></div>{data.observations.filter((row: any) => row.event_kind === 'RECOGNITION').length === 0 ? <p className="py-8 text-center text-sm text-text-secondary">아직 이번 달의 기여 기록이 없습니다.</p> : <div className="max-h-[380px] space-y-2 overflow-y-auto pr-1">{data.observations.filter((row: any) => row.event_kind === 'RECOGNITION').map((row: any) => { const cancelled = reversedEventIds.has(Number(row.id)); const student = studentById.get(Number(row.student_id)); return <div key={row.id} className="rounded-card-md border border-line bg-bg-deep p-3"><div className="flex items-start justify-between gap-2"><div><div className="font-black text-white">{displayStudent(student)} · {OBSERVATION_CATEGORIES.find(([code]) => code === row.category)?.[1] || row.category}</div><p className="mt-1 text-xs text-text-secondary">{row.reason}</p><div className="mt-1 text-[10px] text-text-muted">{row.is_public ? '학생 공개' : '비공개'} · {new Date(row.created_at).toLocaleString('ko-KR')}</div></div>{cancelled ? <span className="text-xs font-black text-text-muted">취소됨</span> : <button className="btn-secondary text-xs" disabled={isLoading} onClick={() => { setReversalTarget(Number(row.id)); setReversalReason(''); }}>취소</button>}</div>{reversalTarget === Number(row.id) && <div className="mt-3 flex gap-2"><input className="input-field min-w-0 flex-1 text-xs" autoFocus value={reversalReason} maxLength={300} onChange={(event) => setReversalReason(event.target.value)} placeholder="취소 사유 (2자 이상)" /><button className="btn-primary text-xs" disabled={isLoading || reversalReason.trim().length < 2} onClick={() => void call(() => guildTeacherRpc.reverseGuild2Observation(supabase, { p_observation_event_id: Number(row.id), p_reason: reversalReason, p_idempotency_key: idKey() }), { successTitle: '기여 기록을 취소했어요', successDescription: '원래 기록은 감사 이력으로 보존됩니다.', onSuccess: () => { setReversalTarget(null); refresh(); } })}>확인</button></div>}</div>; })}</div>}</div>
    </section>

    <section className="grid gap-5 xl:grid-cols-2">
      <div className="glass-card p-4"><div className="mb-3"><h2 className="font-display text-lg">GS 수동 조정</h2><p className="mt-1 text-xs text-text-secondary">예외적인 공식 조정만 기록하세요. 기존 GS 행을 바꾸지 않고, 이유가 있는 새 기록을 추가합니다.</p></div><div className="space-y-3"><select className="input-field w-full" value={adjustmentGuildId} onChange={(event) => setAdjustmentGuildId(event.target.value)}><option value="">길드 선택</option>{data.guilds.map((guild: any) => <option key={guild.id} value={guild.id}>{guild.name}</option>)}</select><input className="input-field w-full" type="number" step="0.01" min="-5000" max="5000" value={adjustmentPoints} onChange={(event) => setAdjustmentPoints(event.target.value)} placeholder="더할/뺄 GS (예: 50 또는 -50)" /><input className="input-field w-full" value={adjustmentReason} maxLength={300} onChange={(event) => setAdjustmentReason(event.target.value)} placeholder="조정 사유 (2자 이상)" /><button className="btn-secondary w-full" disabled={isLoading || !adjustmentGuildId || !adjustmentReason.trim() || Number(adjustmentPoints) === 0} onClick={postAdjustment}>GS 조정 기록 추가</button></div></div>
      <div className="glass-card p-4"><div className="mb-3"><h2 className="font-display text-lg">최근 GS 기록장</h2><p className="mt-1 text-xs text-text-secondary">이 합계가 위 길드별 GS 초안의 근거입니다.</p></div>{!data.ledger.length ? <p className="py-8 text-center text-sm text-text-secondary">아직 GS 기록이 없습니다. 점수 다시 계산을 눌러 시작하세요.</p> : <div className="max-h-[340px] space-y-2 overflow-y-auto pr-1">{data.ledger.map((event: any) => <div key={event.id} className="flex items-start justify-between gap-3 rounded-card-md border border-line bg-bg-deep p-3"><div><div className="font-black text-white">{event.source_type === 'INDIVIDUAL_CONTRIBUTION' ? '개인 기여도' : event.source_type === 'MEMBER_COMPENSATION' ? '인원 보정' : event.source_type === 'MANUAL_ADJUSTMENT' ? '수동 조정' : event.source_type === 'REVERSAL' ? '취소 기록' : event.source_type}</div><p className="mt-1 text-xs text-text-secondary">{event.reason}</p><div className="mt-1 text-[10px] text-text-muted">{new Date(event.created_at).toLocaleString('ko-KR')}</div></div><b className={Number(event.points) < 0 ? 'text-danger' : 'text-success'}>{Number(event.points) > 0 ? '+' : ''}{formatNumber(Number(event.points))}</b></div>)}</div>}</div>
    </section>
  </div>;
}

function ScoreCell({ value, max, status, detail }: { value: unknown; max: number; status?: string; detail?: string }) {
  return <td className="p-2 text-text-secondary"><b className="text-white">{formatNumber(Number(value ?? 0))} / {max}</b>{status && <div className={`mt-1 text-[10px] ${status === 'READY' ? 'text-success' : status === 'PENDING' ? 'text-warning' : 'text-text-muted'}`}>{STATUS_LABEL[status] || status}</div>}{detail && <div className="mt-0.5 text-[10px] text-text-muted">{detail}</div>}</td>;
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return <div className="glass-card p-4"><div className="text-xs font-black text-text-secondary">{label}</div><div className="mt-1 font-display text-xl text-gold">{value}</div><div className="mt-1 text-xs text-text-secondary">{sub}</div></div>;
}

function LoadError({ error, retry }: { error: unknown; retry: () => void }) {
  const message = error instanceof Error ? error.message : String(error);
  return <div className="glass-card border-danger/40 p-4"><div className="font-black text-danger">Guild 2 데이터를 불러오지 못했습니다.</div><p className="mt-2 break-all text-xs text-text-secondary">{message}</p><p className="mt-2 text-xs text-text-secondary">먼저 Guild 2A SQL을 Supabase SQL Editor에서 적용했는지도 확인해주세요.</p><button className="btn-secondary mt-3" onClick={retry}>다시 시도</button></div>;
}

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { TeacherShell } from '@/components/teacher/TeacherShell';
import { useRpcCall } from '@/components/shared/components';
import { supabase } from '@/lib/supabase/client';
import { feature4Rpc } from '@/lib/rpc/feature4_rpc';
import { useClassroomId } from '@/stores/auth_store';
import { formatDateTime, formatRelativeTime, getKstDateString } from '@/lib/utils/format';
import { feature4QueryError } from '@/lib/feature4_debug';
import { Feature4ErrorPanel } from '@/features/feature4/Feature4ErrorPanel';

const EMERGENCY_LABEL: Record<string, string> = {
  HYPERINFLATION: '초인플레이션',
  EMPLOYMENT_FREEZE: '고용 동결',
  ASSET_FREEZE: '자산 동결',
};

function defaultEndLocal() {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export default function OperationsAdmin() {
  const classroomId = useClassroomId();
  const qc = useQueryClient();
  const { call, isLoading } = useRpcCall();
  const [etype, setEtype] = useState<'HYPERINFLATION' | 'EMPLOYMENT_FREEZE' | 'ASSET_FREEZE'>('ASSET_FREEZE');
  const [reason, setReason] = useState('');
  const [emergencyEnd, setEmergencyEnd] = useState(defaultEndLocal());
  const [qtitle, setQtitle] = useState('');
  const [qdesc, setQdesc] = useState('');
  const [qgold, setQgold] = useState(50);
  const [qb, setQb] = useState(0);
  const [qmins, setQmins] = useState(30);
  const [guardStudent, setGuardStudent] = useState(0);
  const [guardRole, setGuardRole] = useState<'CHIEF' | 'MEMBER'>('MEMBER');
  const [guardNote, setGuardNote] = useState('');
  const today = getKstDateString();
  const endDefault = getKstDateString(new Date(Date.now() + 30 * 86400000));

  // 핵심 이벤트 데이터도 fault-domain을 나눈다. 한 영역 오류가 학생목록/다른 카드까지 비우지 않게 한다.
  const data = useQuery({
    queryKey: ['f4b-admin', classroomId],
    enabled: !!classroomId,
    queryFn: async () => {
      const [e, q] = await Promise.all([
        supabase.from('emergencies').select('*').eq('classroom_id', classroomId!).order('started_at', { ascending: false }).limit(20),
        supabase.from('emergency_quests').select('*').eq('classroom_id', classroomId!).order('created_at', { ascending: false }).limit(30),
      ]);
      if (e.error) throw feature4QueryError('F4B', 'emergencies', e.error);
      if (q.error) throw feature4QueryError('F4B', 'emergency-quests', q.error);
      return { e: e.data ?? [], q: q.data ?? [] };
    },
  });

  const guards = useQuery({
    queryKey: ['f4b-guards', classroomId],
    enabled: !!classroomId,
    queryFn: async () => {
      const res = await supabase.from('guard_terms').select('*,student:students!student_id(name,brand_name)').eq('classroom_id', classroomId!).order('created_at', { ascending: false }).limit(30);
      if (res.error) throw feature4QueryError('F4B', 'guard-terms', res.error);
      return res.data ?? [];
    },
  });

  const students = useQuery({
    queryKey: ['f4b-students', classroomId],
    enabled: !!classroomId,
    queryFn: async () => {
      const res = await supabase.from('students').select('id,name,brand_name,role').eq('classroom_id', classroomId!).eq('role', 'STUDENT').is('transferred_at', null).order('name');
      if (res.error) throw feature4QueryError('F4B', 'students', res.error);
      return res.data ?? [];
    },
  });

  // Feature 4.1 완료요청은 별도 fault-domain으로 분리한다.
  // migration/schema cache 문제가 있어도 비상사태·수호대·퀘스트 운영 전체가 빈 화면이 되지 않는다.
  const requests = useQuery({
    queryKey: ['f4b-quest-requests', classroomId],
    enabled: !!classroomId,
    retry: false,
    queryFn: async () => {
      const res = await supabase.from('emergency_quest_requests')
        .select('id,quest_id,student_id,status,requested_at,note,student:students!student_id(name,brand_name),quest:emergency_quests!quest_id(title,reward_gold,reward_bv,status,expires_at)')
        .eq('classroom_id', classroomId!).eq('status', 'PENDING').order('requested_at', { ascending: true });
      if (res.error) {
        if ((res.error.message || '').includes('emergency_quest_requests')) return [];
        throw feature4QueryError('F4B', 'quest-requests', res.error);
      }
      return res.data ?? [];
    },
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['f4b-admin', classroomId] });
    void qc.invalidateQueries({ queryKey: ['f4b-quest-requests', classroomId] });
    void qc.invalidateQueries({ queryKey: ['f4b-guards', classroomId] });
    void qc.invalidateQueries({ queryKey: ['f4b-students', classroomId] });
    void qc.invalidateQueries({ queryKey: ['emergency-state', classroomId] });
    void qc.invalidateQueries({ queryKey: ['active-emergencies', classroomId] });
  };

  // 각 테이블을 별도 채널로 격리한다. 한 테이블의 publication/schema 문제가 다른 실시간 갱신을 막지 않는다.
  useEffect(() => {
    if (!classroomId) return;
    const makeChannel = (name: string, table: string) => supabase.channel(`${name}:${classroomId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table, filter: `classroom_id=eq.${classroomId}` }, refresh)
      .subscribe();
    const channels = [
      makeChannel('teacher-f4b-emergencies', 'emergencies'),
      makeChannel('teacher-f4b-quests', 'emergency_quests'),
      makeChannel('teacher-f4b-guards', 'guard_terms'),
    ];
    return () => { channels.forEach((channel) => { void supabase.removeChannel(channel); }); };
  }, [classroomId, qc]);

  const endDate = new Date(emergencyEnd);
  const emergencyEndValid = emergencyEnd && Number.isFinite(endDate.getTime()) && endDate.getTime() > Date.now();
  const pendingRequests = requests.data ?? [];

  return (
    <TeacherShell>
      <div className="space-y-6">
        <div>
          <h1 className="font-display text-2xl text-brand-gradient">🚨 학급 이벤트 운영 <span className="text-xs text-text-secondary">F4B · 4.1</span></h1>
          <p className="text-sm text-text-secondary font-bold mt-1">비상사태 · 경제수호대 · 돌발 퀘스트 승인</p>
        </div>

        {data.isError && <Feature4ErrorPanel domain="F4B" error={data.error} onRetry={() => void data.refetch()} />}
        {guards.isError && <Feature4ErrorPanel domain="F4B" error={guards.error} onRetry={() => void guards.refetch()} />}
        {students.isError && <Feature4ErrorPanel domain="F4B" error={students.error} onRetry={() => void students.refetch()} />}

        <div className="grid xl:grid-cols-3 gap-4">
          <Panel title="⚠️ 비상사태">
            <select value={etype} onChange={(e) => setEtype(e.target.value as any)} className="input-field w-full mb-2 text-base">
              {Object.entries(EMERGENCY_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="발동 사유" className="input-field w-full min-h-24 mb-3 text-base" />
            <label className="block text-[15px] text-text-primary font-extrabold mb-3">종료 시각
              <input type="datetime-local" value={emergencyEnd} onChange={(e) => setEmergencyEnd(e.target.value)} className="input-field w-full mt-1.5 text-base py-3" />
            </label>
            {emergencyEndValid && <div className="text-sm text-text-primary font-bold mb-3">자동 종료 예정 · {formatDateTime(endDate)}</div>}
            <button disabled={isLoading || !emergencyEndValid} onClick={() => call(() => feature4Rpc.activateEmergency(supabase, { p_classroom_id: classroomId!, p_emergency_type: etype, p_reason: reason, p_scheduled_end_at: endDate.toISOString() }), { successTitle: '비상사태를 발동했어요', onSuccess: refresh })} className="btn-danger w-full">발동</button>

            <div className="mt-4 space-y-2">
              <div className="text-sm font-extrabold text-text-primary">최근 비상사태 기록</div>
              {data.data?.e.slice(0, 6).map((x: any) => {
                const active = x.status === 'ACTIVE';
                return <div key={x.id} className={`${active ? 'bg-danger-bg border-danger/40' : 'bg-bg-deep border-line'} border p-3 rounded-card-sm text-sm`}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-black text-white">{EMERGENCY_LABEL[x.emergency_type] || x.emergency_type}</div>
                    <span className={`text-xs font-black ${active ? 'text-danger' : 'text-success'}`}>{active ? '발동 중' : '종료'}</span>
                  </div>
                  <div className="text-text-primary mt-1">{x.reason || '사유 없음'}</div>
                  {x.started_at && <div className="text-xs text-text-secondary font-bold mt-1.5">발동 · {formatDateTime(x.started_at)}</div>}
                  {active && x.scheduled_end_at && <div className="text-sm text-warning font-bold mt-1">종료 예정 · {formatDateTime(x.scheduled_end_at)}</div>}
                  {!active && x.actual_end_at && <div className="text-xs text-text-secondary font-bold mt-1">종료 · {formatDateTime(x.actual_end_at)}</div>}
                  {active && <button className="btn-secondary mt-2 w-full" onClick={() => call(() => feature4Rpc.terminateEmergency(supabase, { p_emergency_id: x.id, p_is_auto: false }), { successTitle: '비상사태를 종료했어요', onSuccess: refresh })}>즉시 종료</button>}
                </div>;
              })}
              {!data.data?.e.length && <p className="text-sm text-text-secondary font-bold">아직 비상사태 기록이 없습니다.</p>}
            </div>
          </Panel>

          <Panel title="⚡ 돌발 퀘스트">
            <input value={qtitle} onChange={(e) => setQtitle(e.target.value)} placeholder="퀘스트 제목" className="input-field w-full mb-2 text-base" />
            <textarea value={qdesc} onChange={(e) => setQdesc(e.target.value)} placeholder="설명" className="input-field w-full min-h-24 mb-3 text-base" />
            <div className="grid grid-cols-3 gap-2 mb-3">
              <FieldN label="GOLD" v={qgold} set={setQgold} />
              <FieldN label="BV" v={qb} set={setQb} />
              <FieldN label="분" v={qmins} set={setQmins} />
            </div>
            <button className="btn-primary w-full" disabled={isLoading} onClick={() => call(() => feature4Rpc.createEmergencyQuest(supabase, { p_classroom_id: classroomId!, p_title: qtitle, p_description: qdesc, p_reward_gold: qgold, p_reward_bv: qb, p_duration_minutes: qmins }), { successTitle: '돌발 퀘스트를 열었어요', onSuccess: () => { setQtitle(''); setQdesc(''); refresh(); } })}>퀘스트 생성</button>
            <div className="mt-3 space-y-2">
              {data.data?.q.slice(0, 5).map((x: any) => (
                <div key={x.id} className="bg-bg-deep p-3 rounded-card-sm text-sm border border-line">
                  <div className="flex justify-between gap-2"><b>{x.title}</b><span className="font-bold">{x.status === 'ACTIVE' ? '진행 중' : '종료'}</span></div>
                  <div className="text-text-secondary mt-1">{x.reward_gold}G · {x.reward_bv}BV · {formatRelativeTime(x.expires_at)} 종료</div>
                  {x.status === 'ACTIVE' && <button onClick={() => call(() => feature4Rpc.closeEmergencyQuest(supabase, { p_quest_id: x.id }), { successTitle: '퀘스트를 닫았어요', onSuccess: refresh })} className="text-danger mt-1 font-black">강제 종료</button>}
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="🛡️ 경제수호대">
            <select value={guardStudent} onChange={(e) => setGuardStudent(Number(e.target.value))} className="input-field w-full mb-2 text-base">
              <option value={0}>학생 선택</option>
              {students.data?.map((s: any) => <option key={s.id} value={s.id}>{s.name}{s.brand_name ? ` (${s.brand_name})` : ''}</option>)}
            </select>
            <select value={guardRole} onChange={(e) => setGuardRole(e.target.value as any)} className="input-field w-full mb-2 text-base"><option value="MEMBER">대원</option><option value="CHIEF">대장</option></select>
            <input value={guardNote} onChange={(e) => setGuardNote(e.target.value)} placeholder="메모 (선택)" className="input-field w-full mb-2 text-base" />
            <button className="btn-primary w-full" disabled={!guardStudent || isLoading} onClick={() => call(() => feature4Rpc.appointGuard(supabase, { p_classroom_id: classroomId!, p_student_id: guardStudent, p_role_type: guardRole, p_start_date: today, p_end_date: endDefault, p_note: guardNote || undefined }), { successTitle: '수호대 임기를 등록했어요', onSuccess: refresh })}>30일 임기 등록</button>
            <div className="mt-3 space-y-2">
              {guards.data?.filter((x: any) => x.is_active && x.end_date >= today).map((x: any) => (
                <div key={x.id} className="bg-bg-deep p-2.5 rounded-card-sm text-sm flex justify-between gap-2 border border-line"><span><b>{x.student?.name}</b>{x.student?.brand_name ? ` (${x.student.brand_name})` : ''} · {x.role_type}</span><button className="text-danger font-black" onClick={() => call(() => feature4Rpc.endGuard(supabase, { p_term_id: x.id, p_end_date: today }), { successTitle: '임기를 종료했어요', onSuccess: refresh })}>종료</button></div>
              ))}
            </div>
          </Panel>
        </div>

        <section className="glass-card p-4">
          <div className="flex items-center justify-between gap-2 mb-3">
            <div><h2 className="font-display text-lg">✅ 돌발 퀘스트 완료 요청</h2><p className="text-xs text-text-secondary mt-1 font-bold">학생의 요청을 교사가 승인한 순간에만 GOLD/BV가 지급됩니다.</p></div>
            <span className="px-2 py-1 rounded-pill bg-gold/15 text-gold text-xs font-black">대기 {pendingRequests.length}</span>
          </div>
          {!pendingRequests.length ? (
            <p className="text-sm text-text-secondary">승인 대기 중인 요청이 없습니다.</p>
          ) : (
            <div className="space-y-2">
              {pendingRequests.map((r: any) => (
                <div key={r.id} className="bg-bg-deep rounded-card-md p-3 flex flex-col md:flex-row md:items-center gap-3 border border-line">
                  <div className="flex-1">
                    <div className="text-sm font-extrabold">{r.student?.name}{r.student?.brand_name ? ` (${r.student.brand_name})` : ''} · {r.quest?.title}</div>
                    <div className="text-xs text-text-secondary mt-1">요청 {formatRelativeTime(r.requested_at)} · 보상 {r.quest?.reward_gold ?? 0}G / {r.quest?.reward_bv ?? 0}BV</div>
                  </div>
                  <div className="flex gap-2">
                    <button disabled={isLoading} className="btn-secondary" onClick={() => call(() => feature4Rpc.reviewEmergencyQuestRequest(supabase, { p_request_id: r.id, p_approve: false, p_note: '교사 반려' }), { successTitle: '완료 요청을 반려했어요', onSuccess: refresh })}>반려</button>
                    <button disabled={isLoading} className="btn-primary" onClick={() => call(() => feature4Rpc.reviewEmergencyQuestRequest(supabase, { p_request_id: r.id, p_approve: true }), { successTitle: '완료를 승인하고 보상을 지급했어요', onSuccess: refresh })}>승인 + 보상</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </TeacherShell>
  );
}

function Panel({ title, children }: { title: string; children: any }) {
  return <section className="glass-card p-4"><h2 className="font-display text-lg mb-3">{title}</h2>{children}</section>;
}

function FieldN({ label, v, set }: { label: string; v: number; set: (n: number) => void }) {
  return <label className="text-sm font-extrabold text-text-primary">{label}<input type="number" min={0} value={v} onChange={(e) => set(Number(e.target.value))} className="input-field w-full mt-1.5 text-base py-3" /></label>;
}

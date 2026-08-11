import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { TeacherShell } from '@/components/teacher/TeacherShell';
import { LoadingSpinner, useRpcCall } from '@/components/shared/components';
import { supabase } from '@/lib/supabase/client';
import { useClassroomId } from '@/stores/auth_store';
import { feature4Rpc } from '@/lib/rpc/feature4_rpc';
import { formatRelativeTime } from '@/lib/utils/format';
import { feature4QueryError } from '@/lib/feature4_debug';
import { Feature4ErrorPanel } from '@/features/feature4/Feature4ErrorPanel';

export default function CommunicationAdmin() {
  const classroomId = useClassroomId();
  const qc = useQueryClient();
  const { call, isLoading } = useRpcCall();
  const [selected, setSelected] = useState<number[]>([]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [alert, setAlert] = useState('');
  const [emoji, setEmoji] = useState('📢');
  const [hours, setHours] = useState(48);

  const students = useQuery({
    queryKey: ['f4a-admin-students', classroomId],
    enabled: !!classroomId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('students')
        .select('id,name,brand_name,role')
        .eq('classroom_id', classroomId!)
        .in('role', ['STUDENT', 'STUDENT_LEADER', 'GUARD'])
        .is('transferred_at', null)
        .order('name');
      if (error) throw feature4QueryError('F4A', 'teacher-student-list', error);
      return data ?? [];
    },
  });

  const recent = useQuery({
    queryKey: ['f4a-admin-recent', classroomId],
    enabled: !!classroomId,
    queryFn: async () => {
      const [mRes, aRes] = await Promise.all([
        supabase.from('mail_messages').select('id,title,recipient_id,created_at,recipient:students!recipient_id(name,brand_name)').eq('classroom_id', classroomId!).order('created_at', { ascending: false }).limit(12),
        supabase.from('global_alerts').select('id,message,emoji,created_at').eq('classroom_id', classroomId!).order('created_at', { ascending: false }).limit(12),
      ]);
      if (mRes.error) throw feature4QueryError('F4A', 'teacher-recent-mail', mRes.error);
      if (aRes.error) throw feature4QueryError('F4A', 'teacher-recent-alerts', aRes.error);
      return { mail: mRes.data ?? [], alerts: aRes.data ?? [] };
    },
  });

  useEffect(() => {
    if (!classroomId) return;
    const invalidate = () => void qc.invalidateQueries({ queryKey: ['f4a-admin-recent', classroomId] });
    const mail = supabase.channel(`teacher-f4a-mail:${classroomId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'mail_messages', filter: `classroom_id=eq.${classroomId}` }, invalidate).subscribe();
    const alerts = supabase.channel(`teacher-f4a-alerts:${classroomId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'global_alerts', filter: `classroom_id=eq.${classroomId}` }, invalidate).subscribe();
    return () => { void supabase.removeChannel(mail); void supabase.removeChannel(alerts); };
  }, [classroomId, qc]);

  const allIds = (students.data ?? []).map((s: any) => s.id);

  return (
    <TeacherShell>
      <div className="space-y-6">
        <Header />
        {students.isError && <Feature4ErrorPanel domain="F4A" error={students.error} onRetry={() => void students.refetch()} />}
        {recent.isError && <Feature4ErrorPanel domain="F4A" error={recent.error} onRetry={() => void recent.refetch()} />}

        <div className="grid lg:grid-cols-2 gap-4">
          <section className="glass-card p-4">
            <h2 className="font-display text-lg mb-3">✉️ 우편 발송</h2>
            {students.isLoading ? <LoadingSpinner /> : (
              <div className="mb-3">
                <div className="flex gap-2 mb-2">
                  <button onClick={() => setSelected(allIds)} className="btn-secondary text-xs">전체 선택</button>
                  <button onClick={() => setSelected([])} className="btn-secondary text-xs">초기화</button>
                  <span className="text-xs text-text-secondary self-center font-bold">{selected.length}명 선택</span>
                </div>
                <div className="max-h-52 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {students.data?.map((s: any) => (
                    <label key={s.id} className="flex gap-2 items-center bg-bg-deep rounded-card-sm p-2.5 text-xs border border-line">
                      <input type="checkbox" checked={selected.includes(s.id)} onChange={() => setSelected((v) => v.includes(s.id) ? v.filter((x) => x !== s.id) : [...v, s.id])} />
                      <span className="min-w-0">
                        <span className="block text-sm font-extrabold text-text-primary truncate">{s.name}</span>
                        {s.brand_name && <span className="block text-xs text-text-secondary truncate">{s.brand_name}</span>}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="제목" className="input-field w-full mb-2" />
            <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="내용" className="input-field w-full min-h-32 mb-2" />
            <button disabled={isLoading || !selected.length} onClick={() => call(() => feature4Rpc.sendMail(supabase, { p_classroom_id: classroomId!, p_recipient_ids: selected, p_title: title, p_body: body, p_message_type: 'TEACHER_MESSAGE' }), { successTitle: '우편을 발송했어요', successDescription: `${selected.length}명`, onSuccess: () => { setTitle(''); setBody(''); qc.invalidateQueries({ queryKey: ['f4a-admin-recent'] }); } })} className="btn-primary w-full">
              선택 학생에게 발송
            </button>
          </section>

          <section className="glass-card p-4">
            <h2 className="font-display text-lg mb-3">🔔 학급 전체 알림</h2>
            <div className="grid grid-cols-[80px_1fr] gap-2 mb-2">
              <input value={emoji} onChange={(e) => setEmoji(e.target.value)} className="input-field" />
              <input type="number" min={1} max={168} value={hours} onChange={(e) => setHours(Number(e.target.value))} className="input-field" />
            </div>
            <textarea value={alert} onChange={(e) => setAlert(e.target.value)} placeholder="모든 학생에게 보여줄 알림" className="input-field w-full min-h-36 mb-2" />
            <button disabled={isLoading} onClick={() => call(() => feature4Rpc.broadcastAlert(supabase, { p_classroom_id: classroomId!, p_message: alert, p_emoji: emoji, p_expires_in_hours: hours }), { successTitle: '전역 알림을 보냈어요', onSuccess: () => { setAlert(''); qc.invalidateQueries({ queryKey: ['f4a-admin-recent'] }); } })} className="btn-primary w-full">
              전체 알림 발송
            </button>
            <p className="text-xs text-text-secondary mt-2 font-bold">만료시간은 1~168시간입니다.</p>
          </section>
        </div>

        <div className="grid lg:grid-cols-2 gap-4">
          <Recent title="최근 우편" rows={(recent.data?.mail ?? []).map((m: any) => ({ id: m.id, title: m.title, meta: `${m.recipient?.name || m.recipient_id}${m.recipient?.brand_name ? ` (${m.recipient.brand_name})` : ''} · ${formatRelativeTime(m.created_at)}` }))} />
          <Recent title="최근 알림" rows={(recent.data?.alerts ?? []).map((a: any) => ({ id: a.id, title: `${a.emoji || '🔔'} ${a.message}`, meta: formatRelativeTime(a.created_at) }))} />
        </div>
      </div>
    </TeacherShell>
  );
}

function Header() {
  return <div><h1 className="font-display text-2xl text-brand-gradient">📬 소통 운영 <span className="text-xs text-text-secondary">F4A</span></h1><p className="text-sm text-text-secondary font-bold mt-1">우편과 전역 알림을 한 곳에서 관리합니다.</p></div>;
}

function Recent({ title, rows }: { title: string; rows: { id: number; title: string; meta: string }[] }) {
  return <section className="bg-bg-card border border-line rounded-card-lg p-4"><h2 className="font-display text-base mb-2">{title}</h2>{!rows.length ? <p className="text-xs text-text-secondary">기록 없음</p> : <div className="space-y-2">{rows.map((r) => <div key={r.id} className="bg-bg-deep rounded-card-sm p-2.5"><div className="text-xs font-bold truncate text-text-primary">{r.title}</div><div className="text-xs text-text-secondary mt-1">{r.meta}</div></div>)}</div>}</section>;
}

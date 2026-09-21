import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { TeacherShell } from '@/components/teacher/TeacherShell';
import { LoadingSpinner, Modal, useRpcCall } from '@/components/shared/components';
import { supabase } from '@/lib/supabase/client';
import { useClassroomId } from '@/stores/auth_store';
import { feature4Rpc } from '@/lib/rpc/feature4_rpc';
import { formatRelativeTime } from '@/lib/utils/format';
import { feature4QueryError } from '@/lib/feature4_debug';
import { Feature4ErrorPanel } from '@/features/feature4/Feature4ErrorPanel';

type SentMailRow = {
  id: number;
  dispatch_uid: string;
  title: string;
  body: string;
  message_type: string;
  recipient_id: number;
  is_read: boolean;
  read_at: string | null;
  recalled_at: string | null;
  created_at: string;
  recipient?: { name?: string | null; brand_name?: string | null } | null;
};

type SentDispatch = {
  dispatchUid: string;
  title: string;
  body: string;
  messageType: string;
  createdAt: string;
  recalledAt: string | null;
  recipients: SentMailRow[];
};

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
  const [openDispatchUid, setOpenDispatchUid] = useState<string | null>(null);

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
        supabase
          .from('mail_messages')
          .select('id,dispatch_uid,title,body,message_type,recipient_id,is_read,read_at,recalled_at,created_at,recipient:students!recipient_id(name,brand_name)')
          .eq('classroom_id', classroomId!)
          .eq('sender_type', 'TEACHER')
          .order('created_at', { ascending: false })
          .limit(500),
        supabase
          .from('global_alerts')
          .select('id,message,emoji,created_at')
          .eq('classroom_id', classroomId!)
          .order('created_at', { ascending: false })
          .limit(12),
      ]);
      if (mRes.error) throw feature4QueryError('F4A', 'teacher-recent-mail', mRes.error);
      if (aRes.error) throw feature4QueryError('F4A', 'teacher-recent-alerts', aRes.error);
      return { mail: (mRes.data ?? []) as SentMailRow[], alerts: aRes.data ?? [] };
    },
  });

  useEffect(() => {
    if (!classroomId) return;
    const invalidate = () => void qc.invalidateQueries({ queryKey: ['f4a-admin-recent', classroomId] });
    const mail = supabase.channel(`teacher-f4a-mail:${classroomId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'mail_messages', filter: `classroom_id=eq.${classroomId}` }, invalidate).subscribe();
    const alerts = supabase.channel(`teacher-f4a-alerts:${classroomId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'global_alerts', filter: `classroom_id=eq.${classroomId}` }, invalidate).subscribe();
    return () => { void supabase.removeChannel(mail); void supabase.removeChannel(alerts); };
  }, [classroomId, qc]);

  const dispatches = useMemo(() => groupDispatches(recent.data?.mail ?? []), [recent.data?.mail]);
  const openDispatch = useMemo(
    () => dispatches.find((dispatch) => dispatch.dispatchUid === openDispatchUid) ?? null,
    [dispatches, openDispatchUid],
  );
  const allIds = (students.data ?? []).map((s: any) => s.id);

  const recall = (dispatch: SentDispatch) => {
    if (!classroomId || dispatch.recalledAt) return;
    const readCount = dispatch.recipients.filter((r) => r.is_read).length;
    const confirmed = window.confirm(
      `이 우편을 회수하시겠습니까?\n\n대상 ${dispatch.recipients.length}명 중 ${readCount}명이 이미 읽었습니다.\n회수하면 학생 받은편지함에서 이 우편이 사라집니다.`,
    );
    if (!confirmed) return;

    void call(
      () => feature4Rpc.recallMailDispatch(supabase, {
        p_classroom_id: classroomId,
        p_dispatch_uid: dispatch.dispatchUid,
      }),
      {
        successTitle: '우편을 회수했어요',
        successDescription: `${dispatch.recipients.length}명의 받은편지함에서 숨김 처리되었습니다.`,
        onSuccess: () => {
          void qc.invalidateQueries({ queryKey: ['f4a-admin-recent', classroomId] });
          void qc.invalidateQueries({ queryKey: ['f4a-mail'] });
          void qc.invalidateQueries({ queryKey: ['mail'] });
          void qc.invalidateQueries({ queryKey: ['dashboard'] });
        },
      },
    );
  };

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
            <button disabled={isLoading || !selected.length} onClick={() => call(() => feature4Rpc.sendMail(supabase, { p_classroom_id: classroomId!, p_recipient_ids: selected, p_title: title, p_body: body, p_message_type: 'TEACHER_MESSAGE' }), { successTitle: '우편을 발송했어요', successDescription: `${selected.length}명`, onSuccess: () => { setTitle(''); setBody(''); void qc.invalidateQueries({ queryKey: ['f4a-admin-recent'] }); } })} className="btn-primary w-full">
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
            <button disabled={isLoading} onClick={() => call(() => feature4Rpc.broadcastAlert(supabase, { p_classroom_id: classroomId!, p_message: alert, p_emoji: emoji, p_expires_in_hours: hours }), { successTitle: '전역 알림을 보냈어요', onSuccess: () => { setAlert(''); void qc.invalidateQueries({ queryKey: ['f4a-admin-recent'] }); } })} className="btn-primary w-full">
              전체 알림 발송
            </button>
            <p className="text-xs text-text-secondary mt-2 font-bold">만료시간은 1~168시간입니다.</p>
          </section>
        </div>

        <div className="grid lg:grid-cols-2 gap-4">
          <SentMailHistory
            dispatches={dispatches}
            onOpen={(dispatchUid) => setOpenDispatchUid(dispatchUid)}
            onRecall={recall}
            isLoading={recent.isLoading}
          />
          <Recent title="최근 알림" rows={(recent.data?.alerts ?? []).map((a: any) => ({ id: a.id, title: `${a.emoji || '🔔'} ${a.message}`, meta: formatRelativeTime(a.created_at) }))} />
        </div>
      </div>

      <SentMailDetailModal
        dispatch={openDispatch}
        isLoading={isLoading}
        onClose={() => setOpenDispatchUid(null)}
        onRecall={recall}
      />
    </TeacherShell>
  );
}

function Header() {
  return <div><h1 className="font-display text-2xl text-brand-gradient">📬 소통 운영 <span className="text-xs text-text-secondary">F4A</span></h1><p className="text-sm text-text-secondary font-bold mt-1">우편과 전역 알림을 한 곳에서 관리합니다.</p></div>;
}

function SentMailHistory({
  dispatches,
  onOpen,
  onRecall,
  isLoading,
}: {
  dispatches: SentDispatch[];
  onOpen: (dispatchUid: string) => void;
  onRecall: (dispatch: SentDispatch) => void;
  isLoading: boolean;
}) {
  return (
    <section className="bg-bg-card border border-line rounded-card-lg p-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="font-display text-base">발송한 우편</h2>
        <span className="text-2xs text-text-muted font-bold">최근 {dispatches.length}건</span>
      </div>
      {isLoading ? <LoadingSpinner /> : !dispatches.length ? (
        <p className="text-xs text-text-secondary">기록 없음</p>
      ) : (
        <div className="space-y-2 max-h-[540px] overflow-y-auto pr-1">
          {dispatches.map((dispatch) => {
            const readCount = dispatch.recipients.filter((r) => r.is_read).length;
            const recalled = Boolean(dispatch.recalledAt);
            return (
              <div key={dispatch.dispatchUid} className="bg-bg-deep rounded-card-sm border border-line p-3">
                <button onClick={() => onOpen(dispatch.dispatchUid)} className="w-full text-left">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-extrabold text-text-primary truncate">{dispatch.title}</div>
                      <div className="text-xs text-text-secondary mt-1">
                        {formatRelativeTime(dispatch.createdAt)} · 읽음 {readCount}/{dispatch.recipients.length}
                      </div>
                    </div>
                    <span className={`shrink-0 text-2xs font-black px-2 py-1 rounded-full ${recalled ? 'bg-danger/15 text-danger' : 'bg-success/15 text-success'}`}>
                      {recalled ? '회수됨' : '발송됨'}
                    </span>
                  </div>
                  <p className="text-xs text-text-muted truncate mt-2">{dispatch.body}</p>
                </button>
                <div className="flex justify-end gap-2 mt-2">
                  <button onClick={() => onOpen(dispatch.dispatchUid)} className="btn-secondary text-xs">상세 보기</button>
                  {!recalled && <button onClick={() => onRecall(dispatch)} className="btn-secondary text-xs text-danger">회수</button>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function SentMailDetailModal({
  dispatch,
  isLoading,
  onClose,
  onRecall,
}: {
  dispatch: SentDispatch | null;
  isLoading: boolean;
  onClose: () => void;
  onRecall: (dispatch: SentDispatch) => void;
}) {
  if (!dispatch) return null;
  const readCount = dispatch.recipients.filter((r) => r.is_read).length;
  const recalled = Boolean(dispatch.recalledAt);
  const recipients = [...dispatch.recipients].sort((a, b) => recipientLabel(a).localeCompare(recipientLabel(b), 'ko'));

  return (
    <Modal isOpen={Boolean(dispatch)} onClose={onClose} title="발송 우편 상세" emoji="✉️" size="lg">
      <div className="space-y-5">
        <div>
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-2xs text-text-muted font-bold">{formatDateTime(dispatch.createdAt)}</div>
              <h3 className="font-display text-xl text-brand-gradient mt-1">{dispatch.title}</h3>
            </div>
            <span className={`shrink-0 text-xs font-black px-2.5 py-1 rounded-full ${recalled ? 'bg-danger/15 text-danger' : 'bg-success/15 text-success'}`}>
              {recalled ? '회수됨' : '발송됨'}
            </span>
          </div>
          {dispatch.recalledAt && <div className="text-xs text-danger font-bold mt-2">회수 시각: {formatDateTime(dispatch.recalledAt)}</div>}
        </div>

        <div className="bg-bg-deep border border-line rounded-card-md p-4">
          <div className="text-xs font-black text-text-secondary mb-2">실제 발송 내용</div>
          <p className="text-sm leading-relaxed whitespace-pre-wrap text-text-primary">{dispatch.body}</p>
        </div>

        <div>
          <div className="flex items-center justify-between gap-3 mb-2">
            <h4 className="font-display text-base">읽음 현황</h4>
            <span className="text-xs font-black text-brand-primary">{readCount} / {dispatch.recipients.length}명 확인</span>
          </div>
          <div className="space-y-1.5 max-h-72 overflow-y-auto">
            {recipients.map((recipient) => (
              <div key={recipient.id} className="flex items-center justify-between gap-3 bg-bg-deep rounded-card-sm border border-line px-3 py-2.5">
                <div className="min-w-0">
                  <div className="text-sm font-extrabold truncate">{recipientLabel(recipient)}</div>
                  {recipient.recipient?.brand_name && <div className="text-2xs text-text-muted truncate">{recipient.recipient.brand_name}</div>}
                </div>
                <div className="text-right shrink-0">
                  <div className={`text-xs font-black ${recipient.is_read ? 'text-success' : 'text-text-muted'}`}>{recipient.is_read ? '✓ 읽음' : '미확인'}</div>
                  {recipient.read_at && <div className="text-2xs text-text-muted mt-0.5">{formatDateTime(recipient.read_at)}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>

        {!recalled && (
          <button disabled={isLoading} onClick={() => onRecall(dispatch)} className="w-full rounded-card-md border border-danger/40 bg-danger/10 hover:bg-danger/15 text-danger font-black py-3 transition-colors disabled:opacity-50">
            이 우편 회수
          </button>
        )}
      </div>
    </Modal>
  );
}

function Recent({ title, rows }: { title: string; rows: { id: number; title: string; meta: string }[] }) {
  return <section className="bg-bg-card border border-line rounded-card-lg p-4"><h2 className="font-display text-base mb-2">{title}</h2>{!rows.length ? <p className="text-xs text-text-secondary">기록 없음</p> : <div className="space-y-2">{rows.map((r) => <div key={r.id} className="bg-bg-deep rounded-card-sm p-2.5"><div className="text-xs font-bold truncate text-text-primary">{r.title}</div><div className="text-xs text-text-secondary mt-1">{r.meta}</div></div>)}</div>}</section>;
}

function groupDispatches(rows: SentMailRow[]): SentDispatch[] {
  const grouped = new Map<string, SentDispatch>();
  for (const row of rows) {
    const key = row.dispatch_uid || `LEGACY_${row.id}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.recipients.push(row);
      if (new Date(row.created_at).getTime() < new Date(existing.createdAt).getTime()) existing.createdAt = row.created_at;
      if (!existing.recalledAt && row.recalled_at) existing.recalledAt = row.recalled_at;
      continue;
    }
    grouped.set(key, {
      dispatchUid: key,
      title: row.title,
      body: row.body,
      messageType: row.message_type,
      createdAt: row.created_at,
      recalledAt: row.recalled_at,
      recipients: [row],
    });
  }
  return [...grouped.values()]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 30);
}

function recipientLabel(row: SentMailRow) {
  return row.recipient?.name || `학생 #${row.recipient_id}`;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(new Date(value));
}

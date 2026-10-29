import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LinkifiedText } from '@/components/shared/LinkifiedText';
import { MailRichBody } from '@/features/mail/MailRichBody';
import { TeacherShell } from '@/components/teacher/TeacherShell';
import { LoadingSpinner, Modal, useRpcCall } from '@/components/shared/components';
import { supabase } from '@/lib/supabase/client';
import { useClassroomId } from '@/stores/auth_store';
import { feature4Rpc } from '@/lib/rpc/feature4_rpc';
import { formatRelativeTime } from '@/lib/utils/format';
import { feature4QueryError } from '@/lib/feature4_debug';
import { Feature4ErrorPanel } from '@/features/feature4/Feature4ErrorPanel';


const DEFAULT_MAIL_SENDER = 'B.R.A.N.D 운영국';
const MAIL_SENDER_PRESETS = [
  DEFAULT_MAIL_SENDER,
  'B.R.A.N.D 길드관리국',
  'B.R.A.N.D 아케이드관리국',
  'B.R.A.N.D 시장관리국',
  'B.R.A.N.D 금융관리국',
  'B.R.A.N.D 기록관리국',
  'B.R.A.N.D 업적관리국',
  'B.R.A.N.D 자산관리국',
  'B.R.A.N.D 차원관리국',
  'B.R.A.N.D 레이드관리국',
  'B.R.A.N.D 편린원정대',
  'B.R.A.N.D 월간 MVP 선정위원회',
] as const;

type DispatchRecipient = {
  message_id: number;
  student_id: number;
  student_name: string | null;
  brand_name: string | null;
  is_read: boolean;
  read_at: string | null;
};

type SentDispatch = {
  dispatch_uid: string;
  sender_name: string;
  title: string;
  body: string;
  message_type: string;
  created_at: string;
  recalled_at: string | null;
  recipient_count: number;
  read_count: number;
  recipients: DispatchRecipient[] | null;
};

type OtherMailRow = {
  id: number;
  title: string;
  message_type: string;
  recipient_id: number;
  created_at: string;
  recipient?: { name?: string | null; brand_name?: string | null } | null;
};

export default function CommunicationAdmin() {
  const classroomId = useClassroomId();
  const qc = useQueryClient();
  const { call, isLoading } = useRpcCall();
  const [selected, setSelected] = useState<number[]>([]);
  const [senderName, setSenderName] = useState(DEFAULT_MAIL_SENDER);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [previewMail, setPreviewMail] = useState(false);
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
      const [dispatchResult, aRes, otherRes] = await Promise.all([
        feature4Rpc.listMailDispatches(supabase, { p_classroom_id: classroomId!, p_limit: 100 }),
        supabase
          .from('global_alerts')
          .select('id,message,emoji,created_at')
          .eq('classroom_id', classroomId!)
          .order('created_at', { ascending: false })
          .limit(12),
        supabase
          .from('mail_messages')
          .select('id,title,message_type,recipient_id,created_at,recipient:students!recipient_id(name,brand_name)')
          .eq('classroom_id', classroomId!)
          .eq('message_type', 'P2P_NOTE')
          .order('created_at', { ascending: false })
          .limit(50),
      ]);
      if (dispatchResult.success === false) {
        throw new Error(dispatchResult.error);
      }
      if (aRes.error) throw feature4QueryError('F4A', 'teacher-recent-alerts', aRes.error);
      if (otherRes.error) throw feature4QueryError('F4A', 'teacher-p2p-mail-log', otherRes.error);
      return {
        dispatches: (dispatchResult.data ?? []) as SentDispatch[],
        alerts: aRes.data ?? [],
        otherMail: (otherRes.data ?? []) as OtherMailRow[],
      };
    },
  });

  useEffect(() => {
    if (!classroomId) return;
    const invalidate = () => void qc.invalidateQueries({ queryKey: ['f4a-admin-recent', classroomId] });
    const mail = supabase.channel(`teacher-f4a-mail:${classroomId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'mail_messages', filter: `classroom_id=eq.${classroomId}` }, invalidate).subscribe();
    const alerts = supabase.channel(`teacher-f4a-alerts:${classroomId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'global_alerts', filter: `classroom_id=eq.${classroomId}` }, invalidate).subscribe();
    return () => { void supabase.removeChannel(mail); void supabase.removeChannel(alerts); };
  }, [classroomId, qc]);

  const dispatches = recent.data?.dispatches ?? [];
  const openDispatch = useMemo(
    () => dispatches.find((dispatch) => dispatch.dispatch_uid === openDispatchUid) ?? null,
    [dispatches, openDispatchUid],
  );
  const allIds = (students.data ?? []).map((s: any) => s.id);

  const recall = (dispatch: SentDispatch) => {
    if (!classroomId || dispatch.recalled_at) return;
    const confirmed = window.confirm(
      `이 우편을 회수하시겠습니까?\n\n대상 ${dispatch.recipient_count}명 중 ${dispatch.read_count}명이 이미 읽었습니다.\n회수하면 학생 받은편지함에서 이 우편이 사라집니다.`,
    );
    if (!confirmed) return;

    void call(
      () => feature4Rpc.recallMailDispatch(supabase, {
        p_classroom_id: classroomId,
        p_dispatch_uid: dispatch.dispatch_uid,
      }),
      {
        successTitle: '우편을 회수했어요',
        successDescription: `${dispatch.recipient_count}명의 받은편지함에서 숨김 처리되었습니다.`,
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

        <section className="glass-card p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            <h2 className="font-display text-lg">✉️ 우편 발송</h2>
            <span className="text-xs font-bold text-[#CFFBF1]">수신자 선택 → 내용 작성 → 발송</span>
          </div>
          <div className="grid xl:grid-cols-[minmax(220px,0.8fr)_minmax(0,2fr)] gap-5 items-start">
            <div className="min-w-0 rounded-card-md border border-line bg-bg-deep p-3">
              <div className="flex items-center justify-between gap-2 mb-3">
                <h3 className="text-sm font-extrabold text-[#F3EBD3]">수신자</h3>
                <span className="text-xs font-black text-[#9FE8D8]" aria-live="polite">{selected.length}명 선택</span>
              </div>
              <div className="flex flex-wrap gap-2 mb-3">
                <button onClick={() => setSelected(allIds)} className="btn-secondary !px-3 !py-2 text-xs whitespace-nowrap">전체 선택</button>
                <button onClick={() => setSelected([])} className="btn-secondary !px-3 !py-2 text-xs whitespace-nowrap">초기화</button>
              </div>
              {students.isLoading ? <LoadingSpinner /> : (
                <div className="max-h-52 xl:max-h-[520px] overflow-y-auto overscroll-contain grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-1 gap-1.5 pr-1">
                  {students.data?.map((s: any) => (
                    <label key={s.id} className={`flex gap-2.5 items-center rounded-card-sm p-2.5 text-xs border cursor-pointer transition-colors ${selected.includes(s.id) ? 'border-crystal/60 bg-crystal/10' : 'border-line hover:border-line-strong'}`}>
                      <input type="checkbox" checked={selected.includes(s.id)} onChange={() => setSelected((v) => v.includes(s.id) ? v.filter((x) => x !== s.id) : [...v, s.id])} className="shrink-0 accent-[#4ECDC4]" />
                      <span className="min-w-0">
                        <span className="block text-sm font-extrabold text-text-primary truncate">{s.name}</span>
                        {s.brand_name && <span className="block text-xs text-[#F3EBD3] truncate">{s.brand_name}</span>}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div className="min-w-0 space-y-3">
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-2xs font-black text-[#9FE8D8]">발송인</span>
                <input list="brand-mail-sender-presets" maxLength={60} value={senderName} onChange={(e) => setSenderName(e.target.value)} className="input-field w-full pl-[62px] font-bold text-[#CFFBF1]" aria-label="우편 발송인" />
                <datalist id="brand-mail-sender-presets">
                  {MAIL_SENDER_PRESETS.map((preset) => <option key={preset} value={preset} />)}
                </datalist>
              </div>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="제목" aria-label="우편 제목" maxLength={200} className="input-field w-full" />
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <label htmlFor="brand-mail-body" className="text-sm font-extrabold text-[#F3EBD3]">메시지</label>
                  <button type="button" onClick={() => setPreviewMail((v) => !v)} aria-pressed={previewMail} aria-controls="brand-mail-preview" className="text-xs font-bold text-[#9FE8D8] underline underline-offset-4">{previewMail ? '미리보기 닫기' : '미리보기'}</button>
                </div>
                <textarea id="brand-mail-body" value={body} onChange={(e) => setBody(e.target.value)} placeholder="내용을 입력하세요. 웹 주소는 받은 우편에서 바로 클릭할 수 있습니다." maxLength={5000} className="input-field block w-full min-h-[360px] xl:min-h-[420px] resize-y leading-7" />
                <div className="flex flex-wrap justify-between gap-2 mt-2 text-xs text-[#F3EBD3]">
                  <span>웹 주소 자동 링크 · B.R.A.N.D 이미지 주소는 미리보기로 표시</span>
                  <span className="tabular-nums">{body.length.toLocaleString()} / 5,000자</span>
                </div>
              </div>
              {previewMail && (
                <div id="brand-mail-preview" className="rounded-card-md border border-crystal/40 bg-bg-deep p-4">
                  <h3 className="text-xs font-black text-[#9FE8D8] mb-2">받는 화면 미리보기</h3>
                  <p className="text-xs font-bold text-[#CFFBF1]">{senderName.trim() || DEFAULT_MAIL_SENDER}</p>
                  <p className="font-extrabold text-[#F3EBD3] mt-1 mb-3 break-words">{title || '제목'}</p>
                  <div className="max-h-96 overflow-y-auto text-sm leading-7 whitespace-pre-wrap break-words text-text-primary"><MailRichBody text={body || '작성한 내용이 여기에 표시됩니다.'} allowImagePreviews /></div>
                </div>
              )}
              <button disabled={isLoading || !classroomId || !selected.length || !senderName.trim() || !title.trim() || !body.trim()} onClick={() => call(() => feature4Rpc.sendMail(supabase, { p_classroom_id: classroomId!, p_recipient_ids: selected, p_sender_name: senderName, p_title: title, p_body: body, p_message_type: 'TEACHER_MESSAGE' }), { successTitle: '우편을 발송했어요', successDescription: `${senderName.trim()} · ${selected.length}명`, onSuccess: () => { setTitle(''); setBody(''); setPreviewMail(false); void qc.invalidateQueries({ queryKey: ['f4a-admin-recent'] }); } })} className="btn-primary w-full">
                {isLoading ? '처리 중…' : `선택 학생 ${selected.length}명에게 발송`}
              </button>
            </div>
          </div>
        </section>

        <details className="glass-card group">
          <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 p-4 sm:p-5 [&::-webkit-details-marker]:hidden">
            <span className="font-display text-base">🔔 학급 전체 알림</span>
            <span className="text-xs font-bold text-[#F3EBD3]"><span className="group-open:hidden">필요할 때 펼쳐서 발송 ▾</span><span className="hidden group-open:inline">접기 ▴</span></span>
          </summary>
          <div className="grid lg:grid-cols-[minmax(0,1fr)_240px] gap-4 px-4 pb-4 sm:px-5 sm:pb-5 border-t border-line pt-4">
            <textarea value={alert} onChange={(e) => setAlert(e.target.value)} placeholder="모든 학생에게 보여줄 알림" aria-label="학급 전체 알림 내용" className="input-field w-full min-h-36 resize-y" />
            <div className="space-y-3">
              <div className="grid grid-cols-[80px_minmax(0,1fr)] gap-2">
                <label className="text-xs font-bold text-[#F3EBD3]">아이콘<input value={emoji} onChange={(e) => setEmoji(e.target.value)} className="input-field w-full mt-1" /></label>
                <label className="text-xs font-bold text-[#F3EBD3]">유지 시간<input type="number" min={1} max={168} value={hours} onChange={(e) => setHours(Number(e.target.value))} className="input-field w-full mt-1" /></label>
              </div>
              <p className="text-xs text-[#F3EBD3] font-bold">1~168시간 동안 표시됩니다.</p>
              <button disabled={isLoading || !classroomId || !alert.trim() || !Number.isFinite(hours) || hours < 1 || hours > 168} onClick={() => call(() => feature4Rpc.broadcastAlert(supabase, { p_classroom_id: classroomId!, p_message: alert, p_emoji: emoji, p_expires_in_hours: hours }), { successTitle: '전체 알림을 보냈어요', onSuccess: () => { setAlert(''); void qc.invalidateQueries({ queryKey: ['f4a-admin-recent'] }); } })} className="btn-primary w-full whitespace-nowrap">
                전체 알림 발송
              </button>
            </div>
          </div>
        </details>

        <SentMailHistory
          dispatches={dispatches}
          onOpen={(dispatchUid) => setOpenDispatchUid(dispatchUid)}
          onRecall={recall}
          isLoading={recent.isLoading}
        />

        <div className="grid lg:grid-cols-2 gap-4">
          <OtherMailTable rows={recent.data?.otherMail ?? []} />
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
  return <div><h1 className="font-display text-2xl text-brand-gradient">📬 소통 운영 <span className="text-xs text-[#F3EBD3]">F4A</span></h1><p className="text-sm text-[#F3EBD3] font-bold mt-1">교사가 직접 보낸 우편의 내용과 학생별 읽음 여부를 발송 건 단위로 관리합니다.</p></div>;
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
        <div>
          <h2 className="font-display text-base">내가 보낸 우편</h2>
          <p className="text-2xs text-[#F3EBD3] mt-1">같은 시점에 여러 학생에게 보낸 우편은 한 건으로 묶어 표시합니다.</p>
        </div>
        <span className="text-2xs text-[#F3EBD3] font-bold">최근 {dispatches.length}건</span>
      </div>
      {isLoading ? <LoadingSpinner /> : !dispatches.length ? (
        <p className="text-xs text-[#F3EBD3]">발송 기록 없음</p>
      ) : (
        <div className="overflow-x-auto border border-line rounded-card-md">
          <table className="w-full min-w-[880px] table-fixed text-xs">
            <thead className="bg-bg-deep text-[#F3EBD3]">
              <tr>
                <th className="text-left px-3 py-2.5 font-black w-[150px]">발송일</th>
                <th className="text-left px-3 py-2.5 font-black">제목</th>
                <th className="text-center px-3 py-2.5 font-black w-[90px]">수신</th>
                <th className="text-center px-3 py-2.5 font-black w-[120px]">읽음</th>
                <th className="text-center px-3 py-2.5 font-black w-[90px]">상태</th>
                <th className="text-right px-3 py-2.5 font-black w-[164px]">관리</th>
              </tr>
            </thead>
            <tbody>
              {dispatches.map((dispatch) => {
                const recalled = Boolean(dispatch.recalled_at);
                const unread = Math.max(0, dispatch.recipient_count - dispatch.read_count);
                return (
                  <tr key={dispatch.dispatch_uid} className="border-t border-line hover:bg-bg-deep/70 transition-colors">
                    <td className="px-3 py-3 text-[#F3EBD3] whitespace-nowrap">{formatDateTimeCompact(dispatch.created_at)}</td>
                    <td className="px-3 py-3 min-w-0">
                      <button className="text-left w-full" onClick={() => onOpen(dispatch.dispatch_uid)}>
                        <div className="flex items-center gap-2 min-w-0 max-w-[620px]">
                          <span className="max-w-[45%] shrink-0 truncate text-2xs font-black text-[#9FE8D8]">{dispatch.sender_name || DEFAULT_MAIL_SENDER}</span>
                          <span className="font-extrabold text-text-primary truncate">{dispatch.title}</span>
                        </div>
                        <div className="text-2xs text-[#F3EBD3] truncate max-w-[620px] mt-0.5">{dispatch.body}</div>
                      </button>
                    </td>
                    <td className="px-3 py-3 text-center font-bold">{dispatch.recipient_count}명</td>
                    <td className="px-3 py-3 text-center">
                      <div className="font-black text-success">{dispatch.read_count}/{dispatch.recipient_count}</div>
                      {unread > 0 && <div className="text-2xs text-[#F3EBD3] mt-0.5">미확인 {unread}명</div>}
                    </td>
                    <td className="px-3 py-3 text-center">
                      <span className={`text-2xs font-black px-2 py-1 rounded-full ${recalled ? 'bg-danger/15 text-danger' : 'bg-success/15 text-success'}`}>
                        {recalled ? '회수됨' : '발송됨'}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-nowrap justify-end gap-1.5">
                        <button onClick={() => onOpen(dispatch.dispatch_uid)} className="btn-secondary !px-3 !py-2 text-xs whitespace-nowrap shrink-0 min-w-[52px]">상세</button>
                        {!recalled && <button onClick={() => onRecall(dispatch)} className="btn-secondary !px-3 !py-2 text-xs text-danger whitespace-nowrap shrink-0 min-w-[52px]">회수</button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
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
  const recalled = Boolean(dispatch.recalled_at);
  const recipients = [...(dispatch.recipients ?? [])].sort((a, b) => recipientLabel(a).localeCompare(recipientLabel(b), 'ko'));
  const readRecipients = recipients.filter((r) => r.is_read);
  const unreadRecipients = recipients.filter((r) => !r.is_read);

  return (
    <Modal isOpen={Boolean(dispatch)} onClose={onClose} title="발송 우편 상세" emoji="✉️" size="lg">
      <div className="space-y-5">
        <div>
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-2xs font-black"><span className="text-[#9FE8D8]">{dispatch.sender_name || DEFAULT_MAIL_SENDER}</span><span className="text-[#F3EBD3]"> · {formatDateTime(dispatch.created_at)}</span></div>
              <h3 className="font-display text-xl text-brand-gradient mt-1">{dispatch.title}</h3>
            </div>
            <span className={`shrink-0 text-xs font-black px-2.5 py-1 rounded-full ${recalled ? 'bg-danger/15 text-danger' : 'bg-success/15 text-success'}`}>
              {recalled ? '회수됨' : '발송됨'}
            </span>
          </div>
          {dispatch.recalled_at && <div className="text-xs text-danger font-bold mt-2">회수 시각: {formatDateTime(dispatch.recalled_at)}</div>}
        </div>

        <div className="bg-bg-deep border border-line rounded-card-md p-4">
          <div className="text-xs font-black text-[#F3EBD3] mb-2">실제 발송 내용</div>
          <p className="text-sm leading-relaxed whitespace-pre-wrap break-words text-text-primary"><LinkifiedText text={dispatch.body} /></p>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <Metric label="전체 수신" value={`${dispatch.recipient_count}명`} />
          <Metric label="읽음" value={`${dispatch.read_count}명`} emphasis="success" />
          <Metric label="미확인" value={`${Math.max(0, dispatch.recipient_count - dispatch.read_count)}명`} emphasis="warning" />
        </div>

        <div className="grid md:grid-cols-2 gap-3">
          <RecipientList title={`✓ 읽은 학생 ${readRecipients.length}명`} recipients={readRecipients} read />
          <RecipientList title={`○ 미확인 학생 ${unreadRecipients.length}명`} recipients={unreadRecipients} read={false} />
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

function Metric({ label, value, emphasis }: { label: string; value: string; emphasis?: 'success' | 'warning' }) {
  const cls = emphasis === 'success' ? 'text-success' : emphasis === 'warning' ? 'text-warning' : 'text-text-primary';
  return <div className="bg-bg-deep border border-line rounded-card-md p-3 text-center"><div className="text-2xs text-[#F3EBD3] font-bold">{label}</div><div className={`font-display text-lg mt-1 ${cls}`}>{value}</div></div>;
}

function RecipientList({ title, recipients, read }: { title: string; recipients: DispatchRecipient[]; read: boolean }) {
  return (
    <div className="border border-line rounded-card-md overflow-hidden">
      <div className="bg-bg-deep px-3 py-2.5 text-xs font-black">{title}</div>
      <div className="max-h-64 overflow-y-auto">
        {!recipients.length ? <div className="p-3 text-xs text-[#F3EBD3]">해당 학생 없음</div> : recipients.map((recipient) => (
          <div key={recipient.message_id} className="flex items-center justify-between gap-3 px-3 py-2.5 border-t border-line first:border-t-0">
            <div className="min-w-0">
              <div className="text-sm font-extrabold truncate">{recipientLabel(recipient)}</div>
              {recipient.brand_name && <div className="text-2xs text-[#F3EBD3] truncate">{recipient.brand_name}</div>}
            </div>
            <div className={`text-right shrink-0 text-xs font-black ${read ? 'text-success' : 'text-[#F3EBD3]'}`}>
              {read && recipient.read_at ? formatDateTime(recipient.read_at) : '미확인'}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function OtherMailTable({ rows }: { rows: OtherMailRow[] }) {
  return (
    <section className="bg-bg-card border border-line rounded-card-lg p-4">
      <div className="mb-3">
        <h2 className="font-display text-base">거래 우편 기록</h2>
        <p className="text-2xs text-[#F3EBD3] mt-1">학생 간 서비스 거래 등 P2P 관련 우편입니다. 교사 발송 이력과 분리해 표시합니다.</p>
      </div>
      {!rows.length ? <p className="text-xs text-[#F3EBD3]">거래 우편 기록 없음</p> : (
        <div className="max-h-72 overflow-auto border border-line rounded-card-md">
          <table className="w-full min-w-[520px] text-xs">
            <thead className="bg-bg-deep text-[#F3EBD3] sticky top-0">
              <tr><th className="text-left px-3 py-2 font-black">시각</th><th className="text-left px-3 py-2 font-black">제목</th><th className="text-left px-3 py-2 font-black">수신자</th></tr>
            </thead>
            <tbody>
              {rows.map((row) => <tr key={row.id} className="border-t border-line"><td className="px-3 py-2 whitespace-nowrap text-[#F3EBD3]">{formatDateTimeCompact(row.created_at)}</td><td className="px-3 py-2 font-bold truncate max-w-[280px]">{row.title}</td><td className="px-3 py-2 whitespace-nowrap">{row.recipient?.name || `학생 #${row.recipient_id}`}</td></tr>)}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Recent({ title, rows }: { title: string; rows: { id: number; title: string; meta: string }[] }) {
  return <section className="bg-bg-card border border-line rounded-card-lg p-4"><h2 className="font-display text-base mb-2">{title}</h2>{!rows.length ? <p className="text-xs text-[#F3EBD3]">기록 없음</p> : <div className="space-y-2">{rows.map((r) => <div key={r.id} className="bg-bg-deep rounded-card-sm p-2.5"><div className="text-xs font-bold truncate text-text-primary">{r.title}</div><div className="text-xs text-[#F3EBD3] mt-1">{r.meta}</div></div>)}</div>}</section>;
}

function recipientLabel(row: DispatchRecipient) {
  return row.student_name || `학생 #${row.student_id}`;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(new Date(value));
}

function formatDateTimeCompact(value: string) {
  return new Intl.DateTimeFormat('ko-KR', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(new Date(value));
}

// =====================================================================
// B.R.A.N.D 2.0 — 우편함 (Mail Inbox)
// Stage 6-C · 생성일 2026-05-20
// =====================================================================
// 학생 우편함 — 시스템·교사·수호대·다른 학생으로부터의 메시지.
// 출석 보상도 여기로 도착.
// =====================================================================

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Modal, LoadingSpinner, EmptyState, useRpcCall } from '@/components/shared/components';
import { supabase } from '@/lib/supabase/client';
import { studentRpc } from '@/lib/rpc/student_rpc';
import { useStudentId } from '@/stores/auth_store';
import { formatRelativeTime } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';

// =====================================================================
// 타입
// =====================================================================

interface MailMessage {
  id: number;
  senderType: 'SYSTEM' | 'TEACHER' | 'GUARD' | 'STUDENT';
  senderId: number | null;
  senderName: string | null;
  title: string;
  body: string;
  messageType: string;
  isRead: boolean;
  createdAt: string;
}

const SENDER_CONFIG = {
  SYSTEM:  { icon: '🤖', label: '시스템',    color: 'text-bv' },
  TEACHER: { icon: '👩‍🏫', label: '선생님',   color: 'text-gold' },
  GUARD:   { icon: '🛡️', label: '수호대',    color: 'text-crystal' },
  STUDENT: { icon: '👤', label: '학생',      color: 'text-text-primary' },
} as const;

// =====================================================================
// MailInbox 모달
// =====================================================================

interface MailInboxProps {
  isOpen: boolean;
  onClose: () => void;
}

export function MailInbox({ isOpen, onClose }: MailInboxProps) {
  const studentId = useStudentId();
  const [selected, setSelected] = useState<MailMessage | null>(null);
  
  const { data: messages, isLoading } = useQuery<MailMessage[]>({
    queryKey: ['mail', studentId],
    queryFn: async () => {
      if (!studentId) return [];
      
      const { data } = await supabase
        .from('mail_messages')
        .select(`
          id, sender_type, sender_id, title, body, message_type, is_read, created_at,
          sender:students!sender_id(name, brand_name)
        `)
        .eq('recipient_id', studentId)
        .order('created_at', { ascending: false })
        .limit(50);
      
      return (data ?? []).map((m: any) => ({
        id: m.id,
        senderType: m.sender_type,
        senderId: m.sender_id,
        senderName: m.sender?.brand_name || m.sender?.name || null,
        title: m.title,
        body: m.body,
        messageType: m.message_type,
        isRead: m.is_read,
        createdAt: m.created_at,
      }));
    },
    enabled: studentId !== null && isOpen,
  });
  
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="우편함" emoji="✉️" size="lg">
      {selected ? (
        <MailDetail
          message={selected}
          onBack={() => setSelected(null)}
        />
      ) : (
        <MailList
          messages={messages ?? []}
          isLoading={isLoading}
          onSelect={setSelected}
        />
      )}
    </Modal>
  );
}

// =====================================================================
// 메일 목록
// =====================================================================

function MailList({
  messages, isLoading, onSelect
}: {
  messages: MailMessage[];
  isLoading: boolean;
  onSelect: (m: MailMessage) => void;
}) {
  if (isLoading) {
    return <div className="py-8 flex justify-center"><LoadingSpinner size="lg" /></div>;
  }
  
  if (messages.length === 0) {
    return (
      <EmptyState
        emoji="📭"
        title="우편함이 비어있어요"
        description="새 메시지가 도착하면 여기에 표시됩니다"
      />
    );
  }
  
  return (
    <div className="space-y-2">
      {messages.map((msg) => {
        const sender = SENDER_CONFIG[msg.senderType];
        
        return (
          <motion.div
            key={msg.id}
            whileTap={{ scale: 0.98 }}
            onClick={() => onSelect(msg)}
            className={cn(
              'p-3.5 rounded-card-md border cursor-pointer transition-all hover-lift',
              msg.isRead
                ? 'bg-bg-deep border-line opacity-70'
                : 'bg-bg-card border-line-brand'
            )}
          >
            <div className="flex items-start gap-3">
              <div className="text-xl flex-shrink-0">{sender.icon}</div>
              
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className={cn('text-2xs font-black tracking-wide', sender.color)}>
                    {msg.senderName || sender.label}
                  </span>
                  <span className="text-2xs text-text-muted">·</span>
                  <span className="text-2xs text-text-muted">
                    {formatRelativeTime(msg.createdAt)}
                  </span>
                </div>
                
                <h4 className={cn(
                  'text-sm mb-0.5 truncate',
                  msg.isRead ? 'font-bold text-text-secondary' : 'font-extrabold text-text-primary'
                )}>
                  {msg.title}
                </h4>
                
                <p className="text-xs text-text-muted truncate">
                  {msg.body}
                </p>
              </div>
              
              {!msg.isRead && (
                <div className="w-2 h-2 rounded-full bg-brand-primary mt-2 flex-shrink-0" />
              )}
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

// =====================================================================
// 메일 상세
// =====================================================================

function MailDetail({ message, onBack }: { message: MailMessage; onBack: () => void }) {
  const queryClient = useQueryClient();
  const studentId = useStudentId();
  const { call } = useRpcCall();
  const sender = SENDER_CONFIG[message.senderType];
  
  // 진입 시 자동 읽음 처리
  useEffect(() => {
    if (!message.isRead) {
      call(
        () => studentRpc.markMailRead(supabase, { p_message_id: message.id }),
        {
          silent: true,
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['mail', studentId] });
            queryClient.invalidateQueries({ queryKey: ['dashboard', studentId] });
          },
        }
      );
    }
  }, [message.id, message.isRead]);
  
  return (
    <div>
      {/* 뒤로 버튼 */}
      <button
        onClick={onBack}
        className="text-xs font-bold text-brand-primary mb-4 flex items-center gap-1"
      >
        ← 목록으로
      </button>
      
      {/* 발신자 정보 */}
      <div className="flex items-center gap-3 mb-4 pb-4 border-b border-line">
        <div className="w-12 h-12 rounded-card-md bg-bg-card border border-line flex items-center justify-center text-2xl">
          {sender.icon}
        </div>
        <div>
          <div className={cn('text-2xs font-black uppercase tracking-widest mb-0.5', sender.color)}>
            {sender.label}
          </div>
          <div className="text-sm font-bold text-text-primary">
            {message.senderName || sender.label}
          </div>
          <div className="text-2xs text-text-muted mt-0.5">
            {formatRelativeTime(message.createdAt)}
          </div>
        </div>
      </div>
      
      {/* 제목 */}
      <h3 className="font-display text-lg text-brand-gradient mb-3 tracking-tight">
        {message.title}
      </h3>
      
      {/* 본문 */}
      <div className="text-sm text-text-primary leading-relaxed whitespace-pre-wrap break-keep">
        {message.body}
      </div>
    </div>
  );
}

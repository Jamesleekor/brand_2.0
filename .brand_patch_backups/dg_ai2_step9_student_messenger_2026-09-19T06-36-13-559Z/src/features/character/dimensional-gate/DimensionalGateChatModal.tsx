import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { useEffect, useMemo, useRef, useState } from 'react';

import { LoadingSpinner } from '@/components/shared/components';
import {
  dimensionalGateRpc,
  type DimensionalGateChatMessage,
  type DimensionalGateRosterRow,
} from '@/lib/rpc/dimensional_gate_rpc';
import { supabase } from '@/lib/supabase/client';
import { cn } from '@/lib/utils/cn';
import { DIMENSIONAL_GATE_RELATION_LABEL } from '../dimensional_gate_rules';

interface Props {
  character: DimensionalGateRosterRow;
  onClose: () => void;
}

type DisplayMessage = Pick<DimensionalGateChatMessage, 'role' | 'content'> & { tempId?: string };

export default function DimensionalGateChatModal({ character, onClose }: Props) {
  const queryClient = useQueryClient();
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [optimistic, setOptimistic] = useState<DisplayMessage[]>([]);
  const [affinity, setAffinity] = useState(character.affinity);
  const [stage, setStage] = useState(character.relation_stage);
  const [status, setStatus] = useState(character.status);
  const [remaining, setRemaining] = useState(character.remaining_chat_count);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const historyQuery = useQuery({
    queryKey: ['dimensional-gate-chat-history', character.character_id],
    queryFn: async () => {
      const result = await dimensionalGateRpc.chatHistory(supabase, character.character_id, 40);
      if (result.success === false) throw new Error(result.error);
      return result.data;
    },
    staleTime: 5_000,
    retry: 1,
  });

  const messages = useMemo<DisplayMessage[]>(() => [
    ...(historyQuery.data ?? []),
    ...optimistic,
  ], [historyQuery.data, optimistic]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, sending]);

  const send = async () => {
    const message = input.trim();
    if (!message || sending || status === 'LOCKED' || remaining <= 0) return;

    const tempId = crypto.randomUUID();
    setInput('');
    setError(null);
    setSending(true);
    setOptimistic((items) => [...items, { role: 'STUDENT', content: message, tempId }]);

    const result = await dimensionalGateRpc.sendChat(supabase, character.character_id, message, tempId);
    setSending(false);

    if (result.success === false) {
      setOptimistic((items) => items.filter((item) => item.tempId !== tempId));
      setInput(message);
      setError(result.error);
      return;
    }

    setOptimistic((items) => [
      ...items,
      { role: 'CHARACTER', content: result.data.reply, tempId: `${tempId}:reply` },
    ]);
    if (typeof result.data.affinity === 'number') setAffinity(result.data.affinity);
    if (result.data.relation_stage) setStage(result.data.relation_stage);
    if (result.data.status) setStatus(result.data.status);
    if (typeof result.data.remaining_chat_count === 'number') setRemaining(result.data.remaining_chat_count);

    const historyRefresh = await historyQuery.refetch();
    if (!historyRefresh.error) setOptimistic([]);

    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['dimensional-gate-roster'] }),
      queryClient.invalidateQueries({ queryKey: ['dimensional-gate-character', character.character_id] }),
      queryClient.invalidateQueries({ queryKey: ['dimensional-gate-rewards', character.character_id] }),
      queryClient.invalidateQueries({ queryKey: ['dimensional-gate-gallery', character.character_id] }),
    ]);
  };

  const blocked = status === 'LOCKED' || remaining <= 0;

  return (
    <div className="fixed inset-0 z-[75] flex items-center justify-center bg-black/80 p-3 backdrop-blur-sm" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.99 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="flex h-[min(720px,88vh)] w-full max-w-xl flex-col overflow-hidden rounded-card-xl border border-line bg-bg-overlay shadow-card"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-black text-white">{character.name}</div>
            <div className="mt-0.5 text-[9px] font-black text-text-muted">
              {DIMENSIONAL_GATE_RELATION_LABEL[stage]} · {affinity}/100 · 오늘 {remaining}회 남음
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-full border border-line bg-bg-card px-2.5 py-1 text-sm font-black text-white">×</button>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-4">
          {historyQuery.isLoading ? (
            <div className="grid h-full min-h-40 place-items-center"><LoadingSpinner size="md" /></div>
          ) : historyQuery.isError ? (
            <div className="rounded-card-md border border-danger/30 bg-danger-bg p-4 text-center text-xs font-bold text-danger">지난 대화를 불러오지 못했어요.</div>
          ) : messages.length === 0 ? (
            <div className="mx-auto mt-16 max-w-sm text-center">
              <div className="text-3xl">◈</div>
              <p className="mt-3 text-xs font-black text-white">아직 나눈 대화가 없어요.</p>
              <p className="mt-1 text-[10px] font-bold leading-relaxed text-text-muted">먼저 말을 걸어보세요. 관계가 깊어질수록 되찾은 기억의 범위 안에서 더 많은 이야기를 나눌 수 있습니다.</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {messages.map((message, index) => (
                <div key={message.tempId ?? `${message.role}-${index}`} className={cn('flex', message.role === 'STUDENT' ? 'justify-end' : 'justify-start')}>
                  <div className={cn(
                    'max-w-[82%] rounded-2xl px-3 py-2.5 text-[11px] font-semibold leading-relaxed',
                    message.role === 'STUDENT'
                      ? 'rounded-br-md bg-brand-primary text-white'
                      : 'rounded-bl-md border border-violet-300/15 bg-violet-500/10 text-text-primary',
                  )}>
                    {message.content}
                  </div>
                </div>
              ))}
              {sending && (
                <div className="flex justify-start">
                  <div className="rounded-2xl rounded-bl-md border border-violet-300/15 bg-violet-500/10 px-3 py-2.5 text-[10px] font-black text-violet-200">생각하는 중…</div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          )}
        </main>

        <footer className="border-t border-line bg-bg-overlay px-3 py-3 sm:px-4">
          {error && <div className="mb-2 rounded-card-md border border-danger/30 bg-danger-bg px-3 py-2 text-[10px] font-bold text-danger">{error}</div>}
          {status === 'LOCKED' && <div className="mb-2 text-center text-[10px] font-black text-danger">🔒 지금은 이 편린과 대화할 수 없습니다. 선생님의 관계 복구가 필요합니다.</div>}
          {status !== 'LOCKED' && remaining <= 0 && <div className="mb-2 text-center text-[10px] font-black text-warning">오늘의 대화를 모두 사용했어요. 내일 다시 만날 수 있습니다.</div>}
          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
              disabled={blocked || sending}
              maxLength={600}
              rows={2}
              placeholder={blocked ? '대화할 수 없는 상태입니다.' : '말을 걸어보세요…'}
              className="min-h-[48px] flex-1 resize-none rounded-card-md border border-line bg-bg-deep px-3 py-2.5 text-xs font-semibold text-white outline-none placeholder:text-text-muted focus:border-violet-300/40 disabled:opacity-50"
            />
            <button
              type="button"
              onClick={() => { void send(); }}
              disabled={blocked || sending || !input.trim()}
              className="h-12 rounded-card-md bg-brand-primary px-4 text-xs font-black text-white disabled:cursor-default disabled:opacity-40"
            >
              보내기
            </button>
          </div>
          <div className="mt-1.5 text-right text-[9px] font-bold text-text-muted">{input.length}/600 · Enter 전송 / Shift+Enter 줄바꿈</div>
        </footer>
      </motion.div>
    </div>
  );
}

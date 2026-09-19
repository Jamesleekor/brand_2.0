import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { ArrowLeft, Heart, RefreshCw, SendHorizontal, Sparkles, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { LoadingSpinner } from '@/components/shared/components';
import { resolveAssetUrl } from '@/lib/assets/asset_urls';
import {
  dimensionalGateRpc,
  type DimensionalGateChatMessage,
  type DimensionalGateChatResponse,
  type DimensionalGateRosterRow,
} from '@/lib/rpc/dimensional_gate_rpc';
import { supabase } from '@/lib/supabase/client';
import { cn } from '@/lib/utils/cn';
import { DIMENSIONAL_GATE_RELATION_LABEL } from '../dimensional_gate_rules';

interface Props {
  character: DimensionalGateRosterRow;
  onClose: () => void;
}

type DeliveryState = 'sending' | 'failed' | 'sent';

type DisplayMessage = Pick<
  DimensionalGateChatMessage,
  'role' | 'content' | 'created_at' | 'severity' | 'affinity_delta'
> & {
  tempId?: string;
  requestId?: string;
  delivery?: DeliveryState;
  errorCode?: string;
  replyFor?: string;
};

const KST_TIMEZONE = 'Asia/Seoul';
const MAX_MESSAGE_LENGTH = 600;
const TEXTAREA_MAX_HEIGHT = 112;

function getCharacterAvatar(character: DimensionalGateRosterRow): string | null {
  const raw = character.avatar_image_url
    || character.card_image_url
    || character.full_image_url
    || character.resource_url;
  return raw ? resolveAssetUrl(raw, 'character') : null;
}

function dateKey(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: KST_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function dateLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: KST_TIMEZONE,
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  }).format(date);
}

function timeLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: KST_TIMEZONE,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date).replace('오전', '오전 ').replace('오후', '오후 ');
}

function relationDeltaTone(delta: number): string {
  if (delta > 0) return 'text-success';
  if (delta < 0) return 'text-danger';
  return 'text-text-muted';
}

function retryNeedsNewRequestId(code?: string): boolean {
  return code === 'DG_REQUEST_ABORTED'
    || code === 'DG_REQUEST_EXPIRED'
    || code === 'DG_REQUEST_STALE'
    || code === 'DG_AI_TIMEOUT'
    || code === 'DG_AI_FAILED';
}

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
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const avatarUrl = useMemo(() => getCharacterAvatar(character), [character]);

  const historyQuery = useQuery({
    queryKey: ['dimensional-gate-chat-history', character.character_id],
    queryFn: async () => {
      const result = await dimensionalGateRpc.chatHistory(supabase, character.character_id, 60);
      if (result.success === false) throw new Error(result.error);
      return result.data;
    },
    staleTime: 3_000,
    retry: 1,
  });

  const messages = useMemo<DisplayMessage[]>(() => {
    const combined: DisplayMessage[] = [
      ...(historyQuery.data ?? []),
      ...optimistic,
    ];
    return combined.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  }, [historyQuery.data, optimistic]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: historyQuery.isLoading ? 'auto' : 'smooth', block: 'end' });
  }, [messages.length, sending, historyQuery.isLoading]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, TEXTAREA_MAX_HEIGHT)}px`;
  }, [input]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const applyRelationship = (data: DimensionalGateChatResponse) => {
    const relation = data.relationship;
    const nextAffinity = relation?.affinity ?? data.affinity;
    const nextStage = relation?.relation_stage ?? data.relation_stage;
    const nextStatus = relation?.status ?? data.status;
    const nextRemaining = relation?.remaining_chat_count ?? data.remaining_chat_count;

    if (typeof nextAffinity === 'number') setAffinity(nextAffinity);
    if (nextStage) setStage(nextStage);
    if (nextStatus) setStatus(nextStatus);
    if (typeof nextRemaining === 'number') setRemaining(nextRemaining);
  };

  const deliver = async (tempId: string, message: string, requestId: string) => {
    setError(null);
    setSending(true);
    setOptimistic((items) => items.map((item) => (
      item.tempId === tempId
        ? { ...item, requestId, delivery: 'sending', errorCode: undefined }
        : item
    )));

    const result = await dimensionalGateRpc.sendChat(
      supabase,
      character.character_id,
      message,
      requestId,
    );

    setSending(false);

    if (result.success === false) {
      setOptimistic((items) => items.map((item) => (
        item.tempId === tempId
          ? { ...item, delivery: 'failed', errorCode: 'code' in result ? result.code : undefined }
          : item
      )));
      setError(result.error);
      return;
    }

    const relation = result.data.relationship;
    const affinityDelta = relation?.affinity_delta ?? result.data.affinity_delta ?? null;
    const severity = result.data.moderation_severity
      ?? relation?.severity
      ?? result.data.severity
      ?? 'none';
    const now = new Date().toISOString();

    setOptimistic((items) => [
      ...items.map((item) => (
        item.tempId === tempId ? { ...item, delivery: 'sent' as const } : item
      )),
      {
        role: 'CHARACTER',
        content: result.data.reply,
        created_at: now,
        severity,
        affinity_delta: affinityDelta,
        tempId: `${tempId}:reply`,
        replyFor: tempId,
        delivery: 'sent',
      },
    ]);

    applyRelationship(result.data);

    if (!result.data.relationship) {
      const detailResult = await dimensionalGateRpc.character(supabase, character.character_id);
      if (detailResult.success) {
        setAffinity(detailResult.data.relationship.affinity);
        setStage(detailResult.data.relationship.relation_stage);
        setStatus(detailResult.data.relationship.status);
        setRemaining(detailResult.data.relationship.remaining_chat_count);
      }
    }

    const historyRefresh = await historyQuery.refetch();
    if (!historyRefresh.error) {
      setOptimistic((items) => items.filter((item) => item.delivery === 'failed'));
    }

    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['dimensional-gate-roster'] }),
      queryClient.invalidateQueries({ queryKey: ['dimensional-gate-character', character.character_id] }),
      queryClient.invalidateQueries({ queryKey: ['dimensional-gate-rewards', character.character_id] }),
      queryClient.invalidateQueries({ queryKey: ['dimensional-gate-gallery', character.character_id] }),
    ]);
  };

  const send = async () => {
    const message = input.trim();
    if (!message || sending || status === 'LOCKED' || remaining <= 0 || !character.chat_enabled) return;

    const requestId = crypto.randomUUID();
    const tempId = `student:${requestId}`;
    setInput('');
    setOptimistic((items) => [
      ...items,
      {
        role: 'STUDENT',
        content: message,
        created_at: new Date().toISOString(),
        severity: null,
        affinity_delta: null,
        tempId,
        requestId,
        delivery: 'sending',
      },
    ]);
    await deliver(tempId, message, requestId);
  };

  const retry = async (message: DisplayMessage) => {
    if (!message.tempId || !message.content || sending || status === 'LOCKED' || remaining <= 0) return;
    const requestId = retryNeedsNewRequestId(message.errorCode)
      ? crypto.randomUUID()
      : message.requestId ?? crypto.randomUUID();
    await deliver(message.tempId, message.content, requestId);
  };

  const blocked = !character.chat_enabled || status === 'LOCKED' || remaining <= 0;
  const dailyUsed = Math.max(0, character.daily_chat_limit - remaining);

  return (
    <div
      className="fixed inset-0 z-[75] flex items-center justify-center bg-black/80 p-0 backdrop-blur-sm md:p-4"
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <motion.section
        initial={{ opacity: 0, y: 14, scale: 0.99 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="flex h-[100dvh] w-full flex-col overflow-hidden bg-bg-base shadow-card md:h-[min(820px,92vh)] md:max-w-2xl md:rounded-[28px] md:border md:border-line"
        onClick={(event) => event.stopPropagation()}
        aria-label={`${character.name} 대화`}
      >
        <header className="relative shrink-0 border-b border-line bg-bg-overlay backdrop-blur-xl">
          <div className="flex min-h-[68px] items-center gap-3 px-3 py-2.5 sm:px-4">
            <button
              type="button"
              onClick={onClose}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-text-secondary transition-colors hover:bg-white/5 hover:text-white md:hidden"
              aria-label="대화 닫기"
            >
              <ArrowLeft size={21} strokeWidth={2.25} />
            </button>

            <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-full border border-white/10 bg-bg-soft shadow-card">
              {avatarUrl ? (
                <img src={avatarUrl} alt="" className="h-full w-full object-cover object-top" />
              ) : (
                <div className="grid h-full w-full place-items-center text-base font-black text-violet-100">
                  {character.name.slice(0, 1)}
                </div>
              )}
              <span className="absolute bottom-0.5 right-0.5 h-2.5 w-2.5 rounded-full border-2 border-bg-overlay bg-success" />
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                <h2 className="truncate text-sm font-black text-white sm:text-[15px]">{character.name}</h2>
                {character.epithet && (
                  <span className="hidden truncate text-[9px] font-bold text-text-muted sm:inline">{character.epithet}</span>
                )}
              </div>
              <div className="mt-0.5 flex items-center gap-1.5 text-[10px] font-bold text-text-muted">
                <span className="h-1.5 w-1.5 rounded-full bg-success" />
                <span>차원 연결됨</span>
                <span className="text-text-faded">·</span>
                <span className="text-violet-200">{DIMENSIONAL_GATE_RELATION_LABEL[stage]}</span>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <div className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-right">
                <div className="text-[9px] font-black text-text-muted">오늘 대화</div>
                <div className="mt-0.5 text-[11px] font-black text-white">
                  {dailyUsed}/{character.daily_chat_limit}
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="hidden h-9 w-9 place-items-center rounded-full text-text-secondary transition-colors hover:bg-white/5 hover:text-white md:grid"
                aria-label="대화 닫기"
              >
                <X size={19} strokeWidth={2.25} />
              </button>
            </div>
          </div>

          <div className="h-[2px] bg-white/[0.04]">
            <div
              className="h-full bg-gradient-to-r from-violet-400 via-fuchsia-400 to-brand-primary transition-[width] duration-500"
              style={{ width: `${Math.max(0, Math.min(100, affinity))}%` }}
            />
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto bg-[radial-gradient(circle_at_50%_0%,rgba(139,92,246,0.07),transparent_38%)] px-3 py-4 sm:px-5 sm:py-5">
          {historyQuery.isLoading ? (
            <div className="grid h-full min-h-40 place-items-center"><LoadingSpinner size="md" /></div>
          ) : historyQuery.isError ? (
            <div className="mx-auto mt-10 max-w-sm rounded-card-lg border border-danger/25 bg-danger-bg p-4 text-center">
              <p className="text-xs font-black text-danger">지난 대화를 불러오지 못했어요.</p>
              <button
                type="button"
                onClick={() => { void historyQuery.refetch(); }}
                className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-danger/25 bg-black/10 px-3 py-1.5 text-[10px] font-black text-danger"
              >
                <RefreshCw size={12} /> 다시 불러오기
              </button>
            </div>
          ) : (
            <div className="mx-auto w-full max-w-[620px]">
              {messages.length === 0 && (
                <div className="mx-auto mb-8 mt-10 max-w-sm text-center">
                  <div className="mx-auto grid h-16 w-16 place-items-center overflow-hidden rounded-full border border-violet-300/20 bg-violet-500/10 shadow-bv-sm">
                    {avatarUrl ? (
                      <img src={avatarUrl} alt="" className="h-full w-full object-cover object-top" />
                    ) : (
                      <Sparkles size={24} className="text-violet-200" />
                    )}
                  </div>
                  <h3 className="mt-4 text-sm font-black text-white">{character.name}에게 말을 걸어보세요</h3>
                  <p className="mt-1.5 text-[10px] font-semibold leading-relaxed text-text-muted">
                    차원 너머의 기억과 지금의 이야기가 이 대화 안에서 이어집니다.
                  </p>
                </div>
              )}

              <div className="space-y-1">
                {messages.map((message, index) => {
                  const previous = index > 0 ? messages[index - 1] : null;
                  const next = index < messages.length - 1 ? messages[index + 1] : null;
                  const dayChanged = !previous || dateKey(previous.created_at) !== dateKey(message.created_at);
                  const groupedWithPrevious = Boolean(
                    previous
                    && previous.role === message.role
                    && dateKey(previous.created_at) === dateKey(message.created_at),
                  );
                  const groupedWithNext = Boolean(
                    next
                    && next.role === message.role
                    && dateKey(next.created_at) === dateKey(message.created_at),
                  );
                  const mine = message.role === 'STUDENT';
                  const failed = message.delivery === 'failed';
                  const pending = message.delivery === 'sending';

                  return (
                    <div key={message.tempId ?? `${message.role}-${message.created_at}-${index}`}>
                      {dayChanged && (
                        <div className="my-5 flex items-center justify-center">
                          <span className="rounded-full border border-white/5 bg-black/20 px-3 py-1 text-[9px] font-bold text-text-muted">
                            {dateLabel(message.created_at)}
                          </span>
                        </div>
                      )}

                      <div className={cn('flex items-end gap-2', mine ? 'justify-end' : 'justify-start', groupedWithPrevious ? 'mt-1' : 'mt-3')}>
                        {!mine && (
                          <div className="w-8 shrink-0 self-start pt-0.5">
                            {!groupedWithPrevious && (
                              <div className="h-8 w-8 overflow-hidden rounded-full border border-white/10 bg-bg-soft">
                                {avatarUrl ? (
                                  <img src={avatarUrl} alt="" className="h-full w-full object-cover object-top" />
                                ) : (
                                  <div className="grid h-full w-full place-items-center text-[11px] font-black text-violet-100">
                                    {character.name.slice(0, 1)}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )}

                        <div className={cn('flex max-w-[82%] items-end gap-1.5 sm:max-w-[76%]', mine && 'flex-row-reverse')}>
                          <div className="min-w-0">
                            {!mine && !groupedWithPrevious && (
                              <div className="mb-1 pl-1 text-[10px] font-black text-text-secondary">{character.name}</div>
                            )}
                            <div
                              className={cn(
                                'whitespace-pre-wrap break-words px-3.5 py-2.5 text-[13px] font-semibold leading-[1.55] shadow-sm',
                                mine
                                  ? 'bg-brand-primary text-white'
                                  : 'border border-white/[0.07] bg-bg-soft text-text-primary',
                                mine
                                  ? cn(groupedWithPrevious ? 'rounded-tr-md' : 'rounded-tr-[18px]', groupedWithNext ? 'rounded-br-md' : 'rounded-br-[18px]', 'rounded-l-[18px]')
                                  : cn(groupedWithPrevious ? 'rounded-tl-md' : 'rounded-tl-[18px]', groupedWithNext ? 'rounded-bl-md' : 'rounded-bl-[18px]', 'rounded-r-[18px]'),
                                failed && 'border border-danger/40 bg-danger-bg text-white',
                              )}
                            >
                              {message.content}
                            </div>

                            {failed && (
                              <button
                                type="button"
                                onClick={() => { void retry(message); }}
                                disabled={sending || blocked}
                                className="mt-1.5 inline-flex items-center gap-1 rounded-full px-1 text-[9px] font-black text-danger hover:underline disabled:opacity-50"
                              >
                                <RefreshCw size={10} /> 전송 실패 · 다시 보내기
                              </button>
                            )}

                            {!mine && typeof message.affinity_delta === 'number' && message.affinity_delta !== 0 && (
                              <div className={cn('mt-1 pl-1 text-[9px] font-black', relationDeltaTone(message.affinity_delta))}>
                                <Heart size={9} className="mr-0.5 inline" fill="currentColor" />
                                호감도 {message.affinity_delta > 0 ? '+' : ''}{message.affinity_delta}
                              </div>
                            )}
                          </div>

                          <div className={cn('mb-0.5 shrink-0 text-[8px] font-bold leading-tight text-text-faded', mine ? 'text-right' : 'text-left')}>
                            {pending ? '전송 중' : timeLabel(message.created_at)}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}

                {sending && (
                  <div className="mt-3 flex items-end gap-2">
                    <div className="h-8 w-8 shrink-0 overflow-hidden rounded-full border border-white/10 bg-bg-soft">
                      {avatarUrl ? (
                        <img src={avatarUrl} alt="" className="h-full w-full object-cover object-top" />
                      ) : (
                        <div className="grid h-full w-full place-items-center text-[11px] font-black text-violet-100">
                          {character.name.slice(0, 1)}
                        </div>
                      )}
                    </div>
                    <div className="rounded-[18px] rounded-bl-md border border-white/[0.07] bg-bg-soft px-3.5 py-3 shadow-sm" aria-label="답장 작성 중">
                      <div className="flex items-center gap-1.5">
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-text-muted [animation-delay:-240ms]" />
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-text-muted [animation-delay:-120ms]" />
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-text-muted" />
                      </div>
                    </div>
                  </div>
                )}

                <div ref={bottomRef} />
              </div>
            </div>
          )}
        </main>

        <footer className="shrink-0 border-t border-line bg-bg-overlay px-3 pb-3 pt-2.5 backdrop-blur-xl sm:px-4">
          {error && (
            <div className="mx-auto mb-2 max-w-[620px] rounded-card-md border border-danger/25 bg-danger-bg px-3 py-2 text-[10px] font-bold leading-relaxed text-danger">
              {error}
            </div>
          )}

          <div className="mx-auto max-w-[620px]">
            {!character.chat_enabled && (
              <div className="mb-2 text-center text-[10px] font-black text-text-muted">
                이 편린의 자유 대화는 아직 준비 중입니다.
              </div>
            )}
            {character.chat_enabled && status === 'LOCKED' && (
              <div className="mb-2 text-center text-[10px] font-black text-danger">
                🔒 지금은 대화가 잠겨 있습니다. 선생님의 관계 복구가 필요합니다.
              </div>
            )}
            {character.chat_enabled && status !== 'LOCKED' && remaining <= 0 && (
              <div className="mb-2 text-center text-[10px] font-black text-warning">
                오늘의 대화를 모두 사용했어요. 내일 다시 만날 수 있습니다.
              </div>
            )}

            <div className="flex items-end gap-2 rounded-[24px] border border-line bg-bg-deep/85 p-1.5 pl-3 focus-within:border-violet-300/35">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    void send();
                  }
                }}
                disabled={blocked || sending}
                maxLength={MAX_MESSAGE_LENGTH}
                rows={1}
                placeholder={blocked ? '지금은 메시지를 보낼 수 없어요.' : `${character.name}에게 메시지 보내기`}
                className="min-h-10 max-h-28 flex-1 resize-none bg-transparent py-2 text-[13px] font-semibold leading-5 text-white outline-none placeholder:text-text-muted disabled:cursor-default disabled:opacity-50"
                aria-label="대화 메시지"
              />
              <button
                type="button"
                onClick={() => { void send(); }}
                disabled={blocked || sending || !input.trim()}
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-primary text-white shadow-brand-sm transition-transform hover:scale-[1.03] active:scale-95 disabled:cursor-default disabled:opacity-35 disabled:shadow-none"
                aria-label="메시지 보내기"
              >
                <SendHorizontal size={17} strokeWidth={2.5} />
              </button>
            </div>

            <div className="mt-1.5 flex items-center justify-between px-1 text-[8px] font-bold text-text-faded">
              <span>{remaining > 0 ? `오늘 ${remaining}회 남음` : '오늘 대화 종료'}</span>
              <span className={cn(input.length >= 540 && 'text-warning')}>{input.length}/{MAX_MESSAGE_LENGTH}</span>
            </div>
          </div>
        </footer>
      </motion.section>
    </div>
  );
}

import { AnimatePresence, motion } from 'framer-motion';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';

import { LoadingSpinner } from '@/components/shared/components';
import { resolveAssetUrl } from '@/lib/assets/asset_urls';
import {
  dimensionalGateRpc,
  type DimensionalGateRosterRow,
  type DimensionalGateStoryCut,
  type DimensionalGateStoryListItem,
  type DimensionalGateStoryScript,
} from '@/lib/rpc/dimensional_gate_rpc';
import { supabase } from '@/lib/supabase/client';
import { cn } from '@/lib/utils/cn';
import './dimensional-gate-vn.css';

interface Props {
  character: DimensionalGateRosterRow;
  story: DimensionalGateStoryListItem;
  onClose: () => void;
  previewMode?: boolean;
  previewScript?: DimensionalGateStoryScript;
}

export default function DimensionalGateVN({ character, story, onClose, previewMode = false, previewScript }: Props) {
  const queryClient = useQueryClient();
  const [index, setIndex] = useState(0);
  const [displayText, setDisplayText] = useState('');
  const [typingDone, setTypingDone] = useState(false);
  const [ended, setEnded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [qaCutOrder, setQaCutOrder] = useState('');
  const visitedGalleryIds = useRef<Set<number>>(new Set());
  const bgmRef = useRef<HTMLAudioElement | null>(null);
  const sfxRef = useRef<HTMLAudioElement | null>(null);
  const startedRef = useRef(false);

  const scriptQuery = useQuery({
    queryKey: ['dimensional-gate-story-script', story.episode_id],
    queryFn: async () => {
      const result = await dimensionalGateRpc.story(supabase, story.episode_id);
      if (result.success === false) throw new Error(result.error);
      return result.data;
    },
    staleTime: 60_000,
    retry: 1,
    enabled: previewScript == null,
  });

  const script = previewScript ?? scriptQuery.data;
  const cuts = script?.cuts ?? [];
  const current = cuts[index] ?? null;
  const orderMap = useMemo(() => {
    const map = new Map<number, number>();
    cuts.forEach((cut, idx) => map.set(cut.cut_order, idx));
    return map;
  }, [cuts]);

  useEffect(() => {
    if (!script || startedRef.current) return;
    startedRef.current = true;
    if (!previewMode) void dimensionalGateRpc.startStory(supabase, script.episode_id);
    const urls = new Set<string>();
    script.cuts.forEach((cut) => {
      if (cut.background_url) urls.add(resolveAssetUrl(cut.background_url, 'background'));
      if (cut.sprite_url) urls.add(resolveAssetUrl(cut.sprite_url, 'character'));
    });
    urls.forEach((url) => { const img = new Image(); img.src = url; });
  }, [previewMode, script]);

  useEffect(() => {
    if (current) setQaCutOrder(String(current.cut_order));
  }, [current?.cut_order]);

  useEffect(() => {
    if (!current) return;
    if (current.gallery_asset_id != null) visitedGalleryIds.current.add(current.gallery_asset_id);

    const text = current.content ?? '';
    setDisplayText('');
    setTypingDone(text.length === 0);
    if (!text) return;

    let cursor = 0;
    const timer = window.setInterval(() => {
      cursor += 1;
      setDisplayText(text.slice(0, cursor));
      if (cursor >= text.length) {
        window.clearInterval(timer);
        setTypingDone(true);
      }
    }, 18);
    return () => window.clearInterval(timer);
  }, [current?.cut_order]);

  useEffect(() => {
    if (!script) return;
    let target = current?.bgm_url ?? (index === 0 ? script.default_bgm_url : undefined);
    if (previewMode) {
      target = script.default_bgm_url;
      for (let cursor = index; cursor >= 0; cursor -= 1) {
        const candidate = cuts[cursor]?.bgm_url;
        if (candidate !== undefined && candidate !== null && String(candidate).trim() !== '') {
          target = candidate;
          break;
        }
      }
    }
    if (target === undefined || target === null || target === '') {
      if (previewMode) {
        bgmRef.current?.pause();
        bgmRef.current = null;
      }
      return;
    }
    const normalized = String(target).trim();
    if (normalized === '-' || normalized.toLowerCase() === 'none') {
      bgmRef.current?.pause();
      bgmRef.current = null;
      return;
    }
    const url = resolveAssetUrl(normalized, 'icon');
    if (bgmRef.current?.src === url) return;
    bgmRef.current?.pause();
    const audio = new Audio(url);
    audio.loop = true;
    audio.volume = muted ? 0 : 0.45;
    bgmRef.current = audio;
    void audio.play().catch(() => undefined);
  }, [cuts, previewMode, script, current?.cut_order, current?.bgm_url, index]);

  useEffect(() => {
    if (bgmRef.current) bgmRef.current.volume = muted ? 0 : 0.45;
    if (sfxRef.current) sfxRef.current.volume = muted ? 0 : 0.7;
  }, [muted]);

  useEffect(() => {
    const raw = current?.sfx_url?.trim();
    if (!raw) return;
    if (raw === '-' || raw.toLowerCase() === 'none') {
      sfxRef.current?.pause();
      sfxRef.current = null;
      return;
    }
    sfxRef.current?.pause();
    const audio = new Audio(resolveAssetUrl(raw, 'icon'));
    audio.volume = muted ? 0 : 0.7;
    sfxRef.current = audio;
    void audio.play().catch(() => undefined);
  }, [current?.cut_order, current?.sfx_url]);

  useEffect(() => () => {
    bgmRef.current?.pause();
    sfxRef.current?.pause();
  }, []);

  const complete = useCallback(async () => {
    if (!script || saving || ended) return;
    if (previewMode) {
      setEnded(true);
      return;
    }
    setSaving(true);
    setSaveError(null);
    const result = await dimensionalGateRpc.completeStory(
      supabase,
      script.episode_id,
      [...visitedGalleryIds.current],
    );
    setSaving(false);
    if (result.success === false) {
      setSaveError(result.error);
      return;
    }
    setEnded(true);
    void queryClient.invalidateQueries({ queryKey: ['dimensional-gate-stories', character.character_id] });
    void queryClient.invalidateQueries({ queryKey: ['dimensional-gate-gallery', character.character_id] });
  }, [character.character_id, ended, previewMode, queryClient, saving, script]);

  const goToIndex = useCallback((next: number) => {
    if (next >= cuts.length) {
      void complete();
      return;
    }
    setIndex(Math.max(0, next));
  }, [complete, cuts.length]);

  const advance = useCallback(() => {
    if (!current || saving || ended) return;
    if (!typingDone) {
      setDisplayText(current.content ?? '');
      setTypingDone(true);
      return;
    }
    if (current.cut_type === 'CHOICE') return;
    if (current.jump_to_order != null) {
      const jumpIndex = orderMap.get(current.jump_to_order);
      goToIndex(jumpIndex ?? index + 1);
      return;
    }
    goToIndex(index + 1);
  }, [current, ended, goToIndex, index, orderMap, saving, typingDone]);

  const choose = useCallback((to: number) => {
    const target = orderMap.get(to);
    goToIndex(target ?? index + 1);
  }, [goToIndex, index, orderMap]);

  const jumpToQaCut = useCallback(() => {
    const order = Number(qaCutOrder);
    if (!Number.isInteger(order)) return;
    const target = orderMap.get(order);
    if (target == null) return;
    setEnded(false);
    setIndex(target);
  }, [orderMap, qaCutOrder]);

  if (!previewScript && scriptQuery.isLoading) {
    return <div className="fixed inset-0 z-[100] grid place-items-center bg-[#050610]"><LoadingSpinner size="lg" /></div>;
  }

  if ((!previewScript && scriptQuery.isError) || !script || !current) {
    return (
      <div className="fixed inset-0 z-[100] grid place-items-center bg-[#050610] p-4">
        <div className="max-w-sm rounded-card-lg border border-danger/30 bg-bg-overlay p-5 text-center">
          <div className="text-3xl">🌌</div>
          <p className="mt-2 text-sm font-black text-white">이야기를 불러오지 못했어요.</p>
          <button type="button" onClick={onClose} className="mt-4 rounded-pill border border-line bg-bg-card px-4 py-2 text-xs font-black text-white">돌아가기</button>
        </div>
      </div>
    );
  }

  const effects = Array.isArray(current.effects) ? current.effects : [];
  const background = current.background_url ? resolveAssetUrl(current.background_url, 'background') : null;
  const sprite = current.sprite_url ? resolveAssetUrl(current.sprite_url, 'character') : getCharacterSprite(character);
  const isCg = current.cut_type === 'CG' || effects.includes('cg');
  const hideSprite = current.metadata?.hide_sprite === true;
  const titleKick = typeof current.metadata?.title_kick === 'string' && current.metadata.title_kick.trim() ? current.metadata.title_kick : 'Chapter';
  const nameGlow = current.metadata?.name_glow === true;
  const isTitle = current.cut_type === 'TITLE';
  const isNarration = current.cut_type === 'NARRATION' || isCg;
  const progress = Math.round(((index + 1) / Math.max(cuts.length, 1)) * 100);

  return (
    <div
      className={cn('dg-vn-root fixed inset-0 z-[100] overflow-hidden bg-[#050610] text-white', effects.includes('shake') && 'dg-vn-shake')}
      onClick={advance}
    >
      <AnimatePresence mode="popLayout">
        {background && (
          <motion.div
            key={background}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.8 }}
            className="absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: `url("${background}")`, filter: sceneFilter(effects) }}
          />
        )}
      </AnimatePresence>
      <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-black/35" />
      {effects.includes('vignette') && <div className="dg-vn-vignette absolute inset-0" />}
      <ParticleField effects={effects} cutOrder={current.cut_order} />
      <OneShotOverlay effects={effects} cutOrder={current.cut_order} />

      {!isCg && !isTitle && !hideSprite && sprite && (
        <motion.img
          key={`${sprite}-${current.cut_order}`}
          src={sprite}
          alt=""
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: effects.includes('dim') ? 0.42 : 1, y: 0, x: '-50%', scale: effects.includes('zoomin') ? 1.08 : effects.includes('zoomout') ? 0.93 : 1 }}
          transition={{ duration: 0.45 }}
          className="pointer-events-none absolute bottom-[18%] left-1/2 max-h-[70vh] max-w-[80vw] object-contain drop-shadow-[0_20px_30px_rgba(0,0,0,0.55)] sm:left-[60%]"
        />
      )}

      <header className="absolute inset-x-0 top-0 z-20 flex items-center gap-3 p-3 sm:p-4" onClick={(event) => event.stopPropagation()}>
        <button type="button" onClick={onClose} className="rounded-full border border-white/15 bg-black/35 px-3 py-1.5 text-xs font-black backdrop-blur">✕</button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[10px] font-black text-white/65">{script.episode_no}편 · {script.title}{previewMode ? ' · 교사 QA' : ''}</div>
          <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-violet-300/80" style={{ width: `${progress}%` }} /></div>
        </div>
        <button type="button" onClick={() => setMuted((value) => !value)} className="rounded-full border border-white/15 bg-black/35 px-3 py-1.5 text-xs font-black backdrop-blur">{muted ? '🔇' : '🔊'}</button>
      </header>

      {previewMode && (
        <div className="absolute left-1/2 top-14 z-30 flex w-[min(94vw,720px)] -translate-x-1/2 flex-wrap items-center justify-center gap-1.5 rounded-card-md border border-amber-200/25 bg-black/72 px-2.5 py-2 shadow-xl backdrop-blur sm:top-16" onClick={(event) => event.stopPropagation()}>
          <span className="mr-1 text-[9px] font-black text-amber-100">교사 QA · 기록/보상 없음</span>
          <button type="button" onClick={() => { setEnded(false); setIndex(Math.max(0, index - 1)); }} disabled={index <= 0} className="rounded border border-white/15 bg-white/5 px-2 py-1 text-[9px] font-black text-white disabled:opacity-30">← 이전</button>
          <button type="button" onClick={() => { setEnded(false); setIndex(Math.min(cuts.length - 1, index + 1)); }} disabled={index >= cuts.length - 1} className="rounded border border-white/15 bg-white/5 px-2 py-1 text-[9px] font-black text-white disabled:opacity-30">다음 →</button>
          <span className="px-1 text-[9px] font-black text-white/70">CUT {current.cut_order} · {index + 1}/{cuts.length}</span>
          <input
            value={qaCutOrder}
            onChange={(event) => setQaCutOrder(event.target.value.replace(/[^0-9]/g, ''))}
            onKeyDown={(event) => { if (event.key === 'Enter') jumpToQaCut(); }}
            inputMode="numeric"
            aria-label="이동할 컷 번호"
            className="w-16 rounded border border-white/15 bg-black/50 px-2 py-1 text-center text-[9px] font-black text-white outline-none focus:border-amber-200/50"
          />
          <button type="button" onClick={jumpToQaCut} className="rounded border border-amber-200/25 bg-amber-300/10 px-2 py-1 text-[9px] font-black text-amber-50">컷 이동</button>
        </div>
      )}

      {isTitle ? (
        <motion.div
          key={current.cut_order}
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          className="absolute inset-0 z-10 grid place-items-center p-6 text-center"
        >
          <div>
            <div className="text-xs font-black uppercase tracking-[0.35em] text-violet-100/65">{titleKick}</div>
            <div className="mt-4 font-display text-3xl text-white sm:text-5xl">{displayText || current.content}</div>
            {typingDone && <div className="mt-6 text-[10px] font-black tracking-widest text-white/45">화면을 눌러 계속</div>}
          </div>
        </motion.div>
      ) : (
        <div className="absolute inset-x-0 bottom-0 z-20 p-3 pb-5 sm:p-6 sm:pb-8">
          <div className={cn(
            'mx-auto max-w-4xl rounded-[20px] border border-white/15 bg-[#090b17]/88 p-4 shadow-2xl backdrop-blur-md sm:p-5',
            isNarration && 'bg-black/62 text-center',
          )}>
            {!isNarration && current.speaker && <div className={cn('mb-2 text-xs font-black tracking-wide text-violet-200', nameGlow && 'drop-shadow-[0_0_10px_rgba(196,181,253,0.95)] text-violet-100')}>{current.speaker}</div>}
            <div className={cn('min-h-[3.25rem] whitespace-pre-wrap text-sm font-semibold leading-7 text-white sm:text-base', isNarration && 'font-serif leading-8')}>
              {displayText}
            </div>

            {current.cut_type === 'CHOICE' && typingDone && current.choices && (
              <div className="mt-4 grid gap-2" onClick={(event) => event.stopPropagation()}>
                {current.choices.map((choice, choiceIndex) => (
                  <button
                    type="button"
                    key={`${choice.label}-${choice.to}-${choiceIndex}`}
                    onClick={() => choose(choice.to)}
                    className="rounded-card-md border border-violet-300/25 bg-violet-500/10 px-3 py-3 text-left text-xs font-black text-white transition-colors hover:bg-violet-500/20"
                  >
                    <span className="mr-2 text-violet-200">{choiceIndex + 1}.</span>{choice.label}
                  </button>
                ))}
              </div>
            )}

            {current.cut_type !== 'CHOICE' && typingDone && <div className="mt-2 text-right text-[9px] font-black tracking-widest text-white/40">다음 ▼</div>}
          </div>
        </div>
      )}

      {ended && (
        <div className="absolute inset-0 z-50 grid place-items-center bg-black/88 p-4" onClick={(event) => event.stopPropagation()}>
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="max-w-md text-center">
            <div className="text-4xl">✦</div>
            <div className="mt-4 text-[10px] font-black uppercase tracking-[0.3em] text-violet-200/70">Story Complete</div>
            <h2 className="mt-2 font-display text-2xl text-white">{script.title}</h2>
            <p className="mt-2 text-xs font-semibold leading-relaxed text-white/60">{previewMode ? '교사 QA 미리보기에서는 학생 진행도·화첩·보상을 기록하지 않습니다.' : '이 장면의 기록이 차원관문에 남았습니다.'}</p>
            <div className="mt-5 flex justify-center gap-2">
              {previewMode && <button type="button" onClick={() => { setEnded(false); setIndex(0); }} className="rounded-pill border border-white/15 bg-white/5 px-5 py-2.5 text-xs font-black text-white">처음부터 다시</button>}
              <button type="button" onClick={onClose} className="rounded-pill border border-violet-200/25 bg-violet-500/15 px-5 py-2.5 text-xs font-black text-white">{previewMode ? '미리보기 닫기' : '차원관문으로 돌아가기'}</button>
            </div>
          </motion.div>
        </div>
      )}

      {saving && <div className="absolute inset-0 z-40 grid place-items-center bg-black/45"><LoadingSpinner size="md" /></div>}
      {saveError && (
        <div className="absolute bottom-3 left-1/2 z-50 w-[min(90vw,520px)] -translate-x-1/2 rounded-card-md border border-danger/30 bg-danger-bg px-3 py-2 text-center text-[10px] font-bold text-danger" onClick={(event) => event.stopPropagation()}>
          이야기 완료 기록에 실패했습니다. 다시 마지막 장면을 눌러 주세요. ({saveError})
        </div>
      )}
    </div>
  );
}

function ParticleField({ effects, cutOrder }: { effects: string[]; cutOrder: number }) {
  const type = ['snow', 'embers', 'starlight', 'petals', 'rain'].find((item) => effects.includes(item));
  if (!type) return null;
  const count = type === 'rain' ? 36 : 24;
  return (
    <div key={`${type}-${cutOrder}`} className={`dg-vn-particles dg-vn-particles-${type} pointer-events-none absolute inset-0 z-[4] overflow-hidden`}>
      {Array.from({ length: count }).map((_, idx) => {
        const speed = type === 'rain'
          ? 0.7 + (idx % 6) * 0.08
          : type === 'starlight'
            ? 1.6 + (idx % 5) * 0.45
            : type === 'embers'
              ? 3.6 + (idx % 6) * 0.5
              : type === 'petals'
                ? 5.5 + (idx % 7) * 0.6
                : 5 + (idx % 6) * 0.65;
        return (
          <i
            key={idx}
            style={{
              left: `${(idx * 37) % 100}%`,
              top: type === 'starlight' ? `${(idx * 53) % 92}%` : undefined,
              animationDelay: `${-((idx % 11) * 0.45)}s`,
              '--dg-speed': `${speed}s`,
            } as CSSProperties}
          />
        );
      })}
    </div>
  );
}

function OneShotOverlay({ effects, cutOrder }: { effects: string[]; cutOrder: number }) {
  const type = effects.includes('whiteout') ? 'whiteout' : effects.includes('redflash') ? 'redflash' : effects.includes('flash') ? 'flash' : effects.includes('fadein') ? 'fadein' : null;
  if (!type) return null;
  return <div key={`${type}-${cutOrder}`} className={`dg-vn-overlay dg-vn-overlay-${type} pointer-events-none absolute inset-0 z-[15]`} />;
}

function sceneFilter(effects: string[]) {
  const filters: string[] = [];
  if (effects.includes('gray')) filters.push('grayscale(1)');
  if (effects.includes('sepia')) filters.push('sepia(.9)');
  if (effects.includes('blur')) filters.push('blur(5px)');
  return filters.join(' ') || undefined;
}

function getCharacterSprite(row: DimensionalGateRosterRow) {
  const raw = row.full_image_url || row.resource_url || row.card_image_url || row.avatar_image_url;
  return raw ? resolveAssetUrl(raw, 'character') : null;
}

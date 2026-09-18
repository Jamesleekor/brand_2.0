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
  const [visibleCharCount, setVisibleCharCount] = useState(0);
  const [typingDone, setTypingDone] = useState(false);
  const [ended, setEnded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [qaCutOrder, setQaCutOrder] = useState('');
  const [epilogueRun, setEpilogueRun] = useState<EpilogueRun | null>(null);
  const [epilogueEndReveal, setEpilogueEndReveal] = useState(false);
  const visitedGalleryIds = useRef<Set<number>>(new Set());
  const bgmRef = useRef<HTMLAudioElement | null>(null);
  const bgmSourceRef = useRef<string | null>(null);
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
  const finalEpilogue = useMemo(() => getFinalEpilogueConfig(script?.title), [script?.title]);

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
    const glyphCount = Array.from(text).length;
    setVisibleCharCount(0);
    setTypingDone(glyphCount === 0);
    if (!glyphCount) return;

    // Legacy BrandVN-style soft reveal: lay the whole sentence out first, then fade
    // small two-character groups in. This avoids the eye-fatiguing horizontal reflow
    // of slicing the string one character at a time.
    let cursor = 0;
    const timer = window.setInterval(() => {
      cursor = Math.min(glyphCount, cursor + 2);
      setVisibleCharCount(cursor);
      if (cursor >= glyphCount) {
        window.clearInterval(timer);
        setTypingDone(true);
      }
    }, 45);
    return () => window.clearInterval(timer);
  }, [current?.cut_order]);

  const applyBgmCommand = useCallback((raw: string | null | undefined) => {
    const command = parseBgmCommand(raw);
    if (command.kind === 'hold') return;

    if (command.kind === 'stop') {
      if (bgmSourceRef.current === BGM_STOP_KEY && !bgmRef.current) return;
      bgmRef.current?.pause();
      bgmRef.current = null;
      bgmSourceRef.current = BGM_STOP_KEY;
      return;
    }

    // Compare the original logical source string, not HTMLAudioElement.src. Browsers
    // percent-encode Korean filenames in audio.src, which previously made the same
    // track look different on every cut and restarted it from 0:00.
    if (bgmSourceRef.current === command.url && bgmRef.current) return;
    bgmRef.current?.pause();
    const audio = new Audio(resolveAssetUrl(command.url, 'icon'));
    audio.loop = true;
    audio.volume = muted ? 0 : 0.45;
    bgmRef.current = audio;
    bgmSourceRef.current = command.url;
    void audio.play().catch(() => undefined);
  }, [muted]);

  useEffect(() => {
    if (!script || !current) return;
    const cutCommand = parseBgmCommand(current.bgm_url);
    if (cutCommand.kind !== 'hold') {
      applyBgmCommand(current.bgm_url);
      return;
    }

    // Empty BGM cell means HOLD: keep the previously playing music. Only the first
    // cut falls back to the episode default when no explicit cue exists yet.
    if (index === 0) applyBgmCommand(script.default_bgm_url);
  }, [applyBgmCommand, current?.bgm_url, current?.cut_order, index, script]);

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
    bgmRef.current = null;
    bgmSourceRef.current = null;
    sfxRef.current?.pause();
  }, []);

  const complete = useCallback(async () => {
    if (!script || saving || ended) return;
    if (previewMode) {
      setEpilogueEndReveal(false);
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
      setEpilogueEndReveal(false);
      setSaveError(result.error);
      return;
    }
    setEpilogueEndReveal(false);
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
    if (!current || saving || ended || epilogueRun) return;
    if (!typingDone) {
      setVisibleCharCount(Array.from(current.content ?? '').length);
      setTypingDone(true);
      return;
    }
    if (current.cut_type === 'CHOICE') return;
    if (current.jump_to_order != null) {
      const jumpIndex = orderMap.get(current.jump_to_order);
      goToIndex(jumpIndex ?? index + 1);
      return;
    }

    // 1.0 BrandVN final-chapter staging:
    // - Rumi: after cut 235, play the epilogue before revealing cut 236 (hidden ending).
    // - Astell: after the final cut, play the epilogue before the Story Complete screen.
    if (finalEpilogue?.atCut != null && current.cut_order === finalEpilogue.atCut) {
      setEpilogueRun({ config: finalEpilogue, mode: 'mid', sourceIndex: index });
      return;
    }
    if (finalEpilogue && finalEpilogue.atCut == null && index >= cuts.length - 1) {
      setEpilogueEndReveal(false);
      setEpilogueRun({ config: finalEpilogue, mode: 'end', sourceIndex: index });
      return;
    }

    goToIndex(index + 1);
  }, [current, cuts.length, ended, epilogueRun, finalEpilogue, goToIndex, index, orderMap, saving, typingDone]);

  const choose = useCallback((to: number) => {
    const target = orderMap.get(to);
    goToIndex(target ?? index + 1);
  }, [goToIndex, index, orderMap]);

  const jumpToQaCut = useCallback(() => {
    const order = Number(qaCutOrder);
    if (!Number.isInteger(order)) return;
    const target = orderMap.get(order);
    if (target == null) return;

    // QA cut-jump has no playback history, so rebuild the effective BGM from the
    // nearest preceding valid command. Sequential playback itself never scans back.
    if (previewMode) {
      const qaBgm = effectiveBgmCommandAt(cuts, target, script?.default_bgm_url);
      if (qaBgm != null) applyBgmCommand(qaBgm);
      else {
        bgmRef.current?.pause();
        bgmRef.current = null;
        bgmSourceRef.current = null;
      }
    }

    setEpilogueRun(null);
    setEpilogueEndReveal(false);
    setEnded(false);
    setIndex(target);
  }, [applyBgmCommand, cuts, orderMap, previewMode, qaCutOrder, script?.default_bgm_url]);

  const handleEpilogueReveal = useCallback(() => {
    if (!epilogueRun) return;
    if (epilogueRun.mode === 'mid') {
      setIndex(Math.min(cuts.length - 1, epilogueRun.sourceIndex + 1));
    } else {
      setEpilogueEndReveal(true);
    }
  }, [cuts.length, epilogueRun]);

  const handleEpilogueDone = useCallback(() => {
    if (!epilogueRun) return;
    const mode = epilogueRun.mode;
    setEpilogueRun(null);
    if (mode === 'end') void complete();
  }, [complete, epilogueRun]);

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
  // Explicit per-cut sprite directives from the legacy H column always win.
  // `sprite:none` is represented as metadata.hide_sprite=true with no sprite_url.
  const hideSprite = current.metadata?.hide_sprite === true && !current.sprite_url;
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
          animate={{ opacity: 1, y: 0, x: '-50%', scale: effects.includes('zoomin') ? 1.08 : effects.includes('zoomout') ? 0.93 : 1 }}
          transition={{ duration: 0.45 }}
          className="pointer-events-none absolute bottom-[12vh] left-1/2 max-h-[72vh] max-w-[84vw] object-contain drop-shadow-[0_20px_30px_rgba(0,0,0,0.55)] sm:bottom-[10vh]"
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
          <button type="button" onClick={() => { setEnded(false); advance(); }} disabled={saving || ended || !!epilogueRun} className="rounded border border-white/15 bg-white/5 px-2 py-1 text-[9px] font-black text-white disabled:opacity-30">다음 →</button>
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
            <div className="mt-4 font-display text-3xl text-white sm:text-5xl"><SoftTypedText text={current.content ?? ''} visibleCount={visibleCharCount} /></div>
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
            <div className={cn('min-h-[3.5rem] whitespace-pre-wrap text-[17px] font-semibold leading-8 text-white sm:text-[19px] sm:leading-9', isNarration && 'font-serif leading-9')}>
              <SoftTypedText text={current.content ?? ''} visibleCount={visibleCharCount} />
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

      {epilogueRun && (
        <FinalChapterEpilogue
          key={`${epilogueRun.config.key}-${epilogueRun.mode}-${epilogueRun.sourceIndex}`}
          config={epilogueRun.config}
          onReveal={handleEpilogueReveal}
          onDone={handleEpilogueDone}
        />
      )}

      {(ended || epilogueEndReveal) && (
        <div className="absolute inset-0 z-50 grid place-items-center bg-black/88 p-4" onClick={(event) => event.stopPropagation()}>
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="max-w-md text-center">
            <div className="text-4xl">✦</div>
            <div className="mt-4 text-[10px] font-black uppercase tracking-[0.3em] text-violet-200/70">Story Complete</div>
            <h2 className="mt-2 font-display text-2xl text-white">{script.title}</h2>
            <p className="mt-2 text-xs font-semibold leading-relaxed text-white/60">{epilogueEndReveal && !ended ? '마지막 기록을 정리하고 있습니다.' : previewMode ? '교사 QA 미리보기에서는 학생 진행도·화첩·보상을 기록하지 않습니다.' : '이 장면의 기록이 차원관문에 남았습니다.'}</p>
            {ended && (
              <div className="mt-5 flex justify-center gap-2">
                {previewMode && <button type="button" onClick={() => { setEnded(false); setIndex(0); }} className="rounded-pill border border-white/15 bg-white/5 px-5 py-2.5 text-xs font-black text-white">처음부터 다시</button>}
                <button type="button" onClick={onClose} className="rounded-pill border border-violet-200/25 bg-violet-500/15 px-5 py-2.5 text-xs font-black text-white">{previewMode ? '미리보기 닫기' : '차원관문으로 돌아가기'}</button>
              </div>
            )}
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

type EpilogueLine = {
  text: string;
  opening?: boolean;
  witness?: boolean;
  blankAfter?: boolean;
  longPauseAfter?: boolean;
};

type FinalEpilogueConfig = {
  key: string;
  lines: EpilogueLine[];
  atCut?: number;
};

type EpilogueRun = {
  config: FinalEpilogueConfig;
  mode: 'mid' | 'end';
  sourceIndex: number;
};

const EPILOGUE_TIMING = {
  fadeToBlack: 2500,
  holdBlack: 2500,
  lineFade: 1800,
  afterOpening: 1600,
  gapSmall: 450,
  betweenLines: 1200,
  beforeWitness: 900,
  longPause: 2800,
  narrationHold: 3000,
  narrationFade: 2200,
  revealEnding: 2200,
};

const ASTELL_EPILOGUE_LINES: EpilogueLine[] = [
  { text: '별이 자라는 데엔, 아주 오랜 시간이 걸린다.', opening: true, blankAfter: true },
  { text: '잊혀가던 그의 기억을 깨우고,' },
  { text: '그 밤의 진실을 끝까지 들어준 단 한 사람.', blankAfter: true },
  { text: '그는 오래도록 기억할 것이다.' },
  { text: '그 멈춘 밤의 증인을.', witness: true, blankAfter: true, longPauseAfter: true },
  { text: '그러니 가끔은, 그를 보러 와주길.' },
  { text: '……그 긴 기다림이, 조금은 덜 외롭도록.' },
];

const RUMI_EPILOGUE_LINES: EpilogueLine[] = [
  { text: '긴 겨울이 있었다.', opening: true, blankAfter: true },
  { text: '닿으면 부서질까 두려워' },
  { text: '끝내 아무도 곁에 두지 못했던 눈여우가 있었다.', blankAfter: true },
  { text: '그 겨울의 끝까지 남아' },
  { text: '그녀의 이름을 불러 준 단 한 사람.', witness: true, blankAfter: true, longPauseAfter: true },
  { text: '그러니 가끔은, 그녀를 보러 와주길.' },
  { text: '……눈이 녹아야, 봄이 오는 거니까.' },
];

const FINAL_EPILOGUES: FinalEpilogueConfig[] = [
  { key: '멈춰버린 밤', lines: ASTELL_EPILOGUE_LINES },
  // Legacy 1.0 plays Rumi's ending narration after cut 235, then reveals
  // the Arcanum/Liminel hidden-ending sequence stored in cuts 236+.
  { key: '맞잡은 손', lines: RUMI_EPILOGUE_LINES, atCut: 235 },
];

function getFinalEpilogueConfig(title?: string | null) {
  const normalized = String(title ?? '');
  return FINAL_EPILOGUES.find((item) => normalized.includes(item.key)) ?? null;
}

function SoftTypedText({ text, visibleCount }: { text: string; visibleCount: number }) {
  const glyphs = Array.from(text);
  return (
    <>
      {glyphs.map((glyph, index) => glyph === '\n' ? (
        <br key={`br-${index}`} />
      ) : (
        <span
          key={`${index}-${glyph}`}
          style={{
            opacity: index < visibleCount ? 1 : 0,
            transition: 'opacity 260ms ease-out',
            whiteSpace: 'pre',
          }}
        >
          {glyph}
        </span>
      ))}
    </>
  );
}

function FinalChapterEpilogue({
  config,
  onReveal,
  onDone,
}: {
  config: FinalEpilogueConfig;
  onReveal: () => void;
  onDone: () => void;
}) {
  const [overlayVisible, setOverlayVisible] = useState(false);
  const [visibleLines, setVisibleLines] = useState(0);
  const [textVisible, setTextVisible] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

    const run = async () => {
      await sleep(30);
      if (cancelled) return;
      setOverlayVisible(true);
      await sleep(EPILOGUE_TIMING.fadeToBlack + EPILOGUE_TIMING.holdBlack);

      for (let index = 0; index < config.lines.length; index += 1) {
        if (cancelled) return;
        setVisibleLines(index + 1);
        const line = config.lines[index];
        await sleep(EPILOGUE_TIMING.lineFade);
        if (line.longPauseAfter) await sleep(EPILOGUE_TIMING.longPause);
        else if (line.blankAfter) await sleep(EPILOGUE_TIMING.betweenLines);
        else if (index === 0) await sleep(EPILOGUE_TIMING.afterOpening);
        else await sleep(EPILOGUE_TIMING.gapSmall);
        if (config.lines[index + 1]?.witness) await sleep(EPILOGUE_TIMING.beforeWitness);
      }

      if (cancelled) return;
      await sleep(EPILOGUE_TIMING.narrationHold);
      setTextVisible(false);
      await sleep(EPILOGUE_TIMING.narrationFade);
      if (cancelled) return;

      // Match 1.0: prepare the hidden ending / complete screen underneath first,
      // then let the black narration veil recede to reveal it.
      onReveal();
      setOverlayVisible(false);
      await sleep(EPILOGUE_TIMING.revealEnding);
      if (!cancelled) onDone();
    };

    void run();
    return () => { cancelled = true; };
  }, [config, onDone, onReveal]);

  return (
    <div
      className="absolute inset-0 z-[60] flex items-center justify-center bg-black px-6 py-10"
      style={{
        opacity: overlayVisible ? 1 : 0,
        transition: `opacity ${overlayVisible ? EPILOGUE_TIMING.fadeToBlack : EPILOGUE_TIMING.revealEnding}ms ease`,
      }}
      onClick={(event) => event.stopPropagation()}
    >
      <div
        className="w-full max-w-3xl text-center font-serif leading-[2.1] text-[#d7ddf5]"
        style={{
          opacity: textVisible ? 1 : 0,
          transition: `opacity ${EPILOGUE_TIMING.narrationFade}ms ease`,
        }}
      >
        {config.lines.map((line, index) => (
          <div key={`${config.key}-${index}`} className={line.blankAfter ? 'mb-3.5' : ''}>
            <p
              className={cn(
                'm-0 text-[18px] tracking-[0.04em] sm:text-[23px]',
                line.opening && 'text-[21px] tracking-[0.12em] text-[#c6cdf0] sm:text-[26px]',
                line.witness && 'tracking-[0.14em] text-[#eaf0ff] drop-shadow-[0_0_18px_rgba(160,180,255,0.55)]',
              )}
              style={{
                opacity: index < visibleLines ? 1 : 0,
                transition: `opacity ${EPILOGUE_TIMING.lineFade}ms ease`,
              }}
            >
              {line.text}
            </p>
          </div>
        ))}
      </div>
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

  // Legacy H-column `dim` is a scene-depth cue: soften the BACKGROUND so the
  // foreground character/text reads more clearly. Sprites must never be dimmed.
  // Explicit `blur` remains the stronger blur cue.
  if (effects.includes('blur')) filters.push('blur(5px)');
  else if (effects.includes('dim')) filters.push('blur(2.8px)', 'brightness(.9)');

  return filters.join(' ') || undefined;
}

type BgmCommand =
  | { kind: 'hold' }
  | { kind: 'stop' }
  | { kind: 'play'; url: string };

const BGM_STOP_KEY = '__DG_BGM_STOP__';

function parseBgmCommand(raw: string | null | undefined): BgmCommand {
  const value = String(raw ?? '').trim();
  if (!value) return { kind: 'hold' };
  const lower = value.toLowerCase();
  if (value === '-' || lower === 'none') return { kind: 'stop' };
  if (/^https?:\/\//i.test(value)) return { kind: 'play', url: value };

  // Source TSV contains a few descriptive cue notes (e.g. music direction text)
  // without a playable URL. Do not invent a file or interrupt the current track.
  return { kind: 'hold' };
}

function effectiveBgmCommandAt(
  cuts: DimensionalGateStoryCut[],
  targetIndex: number,
  defaultBgm: string | null | undefined,
) {
  let effective: string | null = null;
  const initial = parseBgmCommand(defaultBgm);
  if (initial.kind === 'play') effective = initial.url;
  else if (initial.kind === 'stop') effective = 'none';

  for (let cursor = 0; cursor <= targetIndex; cursor += 1) {
    const raw = cuts[cursor]?.bgm_url;
    const command = parseBgmCommand(raw);
    if (command.kind === 'play') effective = command.url;
    else if (command.kind === 'stop') effective = 'none';
  }
  return effective;
}

const DIMENSIONAL_GATE_DEFAULT_STORY_SPRITES: Record<string, string> = {
  'CHAR-022': 'https://cdn.jsdelivr.net/gh/Jamesleekor/brand-assets@main/Character_Stories/Char_fullbody_Astell.png',
  'CHAR-012': 'https://cdn.jsdelivr.net/gh/Jamesleekor/brand-assets@main/Character_Stories/Rumi/Char/Char_Rumi_Basic-2.png',
};

function getCharacterSprite(row: DimensionalGateRosterRow) {
  const storySprite = DIMENSIONAL_GATE_DEFAULT_STORY_SPRITES[row.character_uid];
  if (storySprite) return resolveAssetUrl(storySprite, 'character');

  // Fallback for characters that do not yet have a dedicated VN sprite registered.
  const raw = row.full_image_url || row.resource_url || row.card_image_url || row.avatar_image_url;
  return raw ? resolveAssetUrl(raw, 'character') : null;
}

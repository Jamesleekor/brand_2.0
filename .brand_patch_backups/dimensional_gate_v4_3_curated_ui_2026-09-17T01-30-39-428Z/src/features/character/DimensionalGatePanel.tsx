import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';

import { LoadingSpinner } from '@/components/shared/components';
import { resolveAssetUrl } from '@/lib/assets/asset_urls';
import { dimensionalGateRpc, type DimensionalGateRosterRow, type DimensionalGateStoryListItem } from '@/lib/rpc/dimensional_gate_rpc';
import { supabase } from '@/lib/supabase/client';
import { cn } from '@/lib/utils/cn';
import { DIMENSIONAL_GATE_RELATION_LABEL } from './dimensional_gate_rules';
import DimensionalGateChatModal from './dimensional-gate/DimensionalGateChatModal';
import DimensionalGateGalleryModal from './dimensional-gate/DimensionalGateGalleryModal';
import DimensionalGateLiminelModal from './dimensional-gate/DimensionalGateLiminelModal';
import DimensionalGateRewardsModal from './dimensional-gate/DimensionalGateRewardsModal';
import DimensionalGateStoryModal from './dimensional-gate/DimensionalGateStoryModal';
import DimensionalGateVN from './dimensional-gate/DimensionalGateVN';

export default function DimensionalGatePanel() {
  const [selected, setSelected] = useState<DimensionalGateRosterRow | null>(null);
  const [liminelOpen, setLiminelOpen] = useState(false);
  const introAutoOpened = useRef(false);
  const rosterQuery = useQuery({
    queryKey: ['dimensional-gate-roster'],
    queryFn: async () => {
      const result = await dimensionalGateRpc.roster(supabase);
      if (result.success === false) throw new Error(result.error);
      return result.data;
    },
    staleTime: 30_000,
    retry: 1,
  });

  const liminelQuery = useQuery({
    queryKey: ['dimensional-gate-liminel'],
    queryFn: async () => {
      const result = await dimensionalGateRpc.liminelRecord(supabase);
      if (result.success === false) throw new Error(result.error);
      return result.data;
    },
    staleTime: 30_000,
    retry: 1,
  });

  useEffect(() => {
    if (!liminelQuery.data || introAutoOpened.current) return;
    if (!liminelQuery.data.intro_seen) {
      introAutoOpened.current = true;
      setLiminelOpen(true);
    }
  }, [liminelQuery.data]);

  const roster = rosterQuery.data ?? [];
  const ordered = useMemo(() => [...roster].sort((a, b) => {
    if (a.is_owned !== b.is_owned) return a.is_owned ? -1 : 1;
    if (a.gate_enabled !== b.gate_enabled) return a.gate_enabled ? -1 : 1;
    return a.name.localeCompare(b.name, 'ko-KR');
  }), [roster]);

  if (rosterQuery.isLoading) {
    return <div className="flex min-h-[320px] items-center justify-center"><LoadingSpinner size="lg" /></div>;
  }

  if (rosterQuery.isError) {
    return (
      <div className="rounded-card-lg border border-danger/40 bg-danger-bg p-5 text-center">
        <div className="mb-2 text-3xl">🌀</div>
        <p className="text-sm font-black text-text-primary">차원관문을 불러오지 못했어요.</p>
        <p className="mt-1 text-xs text-text-secondary">차원관문 서버 기반이 아직 적용되지 않았거나 연결이 잠시 불안정할 수 있어요.</p>
        <button
          type="button"
          onClick={() => { void rosterQuery.refetch(); }}
          className="mt-4 rounded-pill border border-line bg-bg-deep px-4 py-2 text-xs font-black text-text-primary"
        >
          다시 불러오기
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section role="button" tabIndex={0} onClick={() => liminelQuery.data && setLiminelOpen(true)} onKeyDown={(event) => { if ((event.key === 'Enter' || event.key === ' ') && liminelQuery.data) setLiminelOpen(true); }} className="cursor-pointer overflow-hidden rounded-card-xl border border-violet-400/25 bg-gradient-to-br from-bg-card via-bg-card to-violet-500/10 shadow-card transition-colors hover:border-violet-300/40">
        <div className="p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <div className="grid h-12 w-12 flex-none place-items-center rounded-full border border-violet-300/30 bg-violet-500/10 text-2xl shadow-brand-sm">◈</div>
            <div className="min-w-0">
              <div className="text-[10px] font-black uppercase tracking-[0.2em] text-violet-200/70">Arcanum Archivist</div>
              <h2 className="mt-0.5 font-display text-xl text-white">리미넬 옵스큐라</h2>
              <p className="mt-1 text-xs font-semibold leading-relaxed text-text-secondary">
                차원관문의 관리자이자 편린과 맺은 관계를 기록하는 기록관. 클릭하면 되찾은 기억과 신뢰의 기록을 확인할 수 있습니다.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <h2 className="text-base font-black text-white">연결된 편린</h2>
            <p className="mt-0.5 text-2xs font-bold text-text-muted">영입한 편린과 관계를 쌓고, 기억과 이야기를 되찾습니다.</p>
          </div>
          <div className="text-2xs font-black text-brand-primary">
            {ordered.filter((row) => row.is_owned).length} / {ordered.length} 연결
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {ordered.map((row) => (
            <GateCharacterCard key={row.character_id} row={row} onClick={() => row.is_owned && setSelected(row)} />
          ))}
        </div>
      </section>

      {selected && <GateCharacterPreview row={selected} onClose={() => setSelected(null)} />}
      {liminelOpen && liminelQuery.data && <DimensionalGateLiminelModal record={liminelQuery.data} onClose={() => setLiminelOpen(false)} />}
    </div>
  );
}

function GateCharacterCard({ row, onClick }: { row: DimensionalGateRosterRow; onClick: () => void }) {
  const image = getCharacterImage(row);
  const disabled = !row.is_owned;
  const pct = Math.max(0, Math.min(100, row.affinity));

  return (
    <motion.button
      type="button"
      whileTap={disabled ? undefined : { scale: 0.97 }}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'overflow-hidden rounded-card-lg border bg-bg-card text-left shadow-card transition-all',
        disabled ? 'cursor-default border-line opacity-55' : 'border-line hover:border-brand-primary/45 hover:shadow-brand-sm',
      )}
    >
      <div className="relative aspect-[3/4] overflow-hidden bg-bg-deep">
        {image ? (
          <img src={image} alt="" className={cn('h-full w-full object-cover object-top', disabled && 'grayscale')} />
        ) : (
          <div className="grid h-full place-items-center text-4xl text-text-muted">{disabled ? '？' : '✦'}</div>
        )}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-2.5 pb-2.5 pt-10">
          <div className="truncate text-sm font-black text-white">{row.name}</div>
          <div className="mt-0.5 flex items-center justify-between gap-1 text-[10px] font-black">
            <span className={disabled ? 'text-text-muted' : relationTone(row.relation_stage)}>
              {DIMENSIONAL_GATE_RELATION_LABEL[row.relation_stage]}
            </span>
            {!disabled && <span className="text-white/70">{pct}/100</span>}
          </div>
        </div>
      </div>
      <div className="p-2.5">
        {disabled ? (
          <div className="text-[10px] font-bold text-text-muted">영입 후 차원관문 연결</div>
        ) : !row.gate_enabled ? (
          <div className="text-[10px] font-bold text-warning">차원관문 콘텐츠 준비 중</div>
        ) : row.status === 'LOCKED' ? (
          <div className="text-[10px] font-bold text-danger">🔒 관계 잠김</div>
        ) : (
          <>
            <div className="h-1.5 overflow-hidden rounded-pill bg-bg-deep">
              <div className="h-full rounded-pill bg-gradient-to-r from-violet-500 to-brand-primary" style={{ width: `${pct}%` }} />
            </div>
            <div className="mt-1.5 text-[9px] font-bold text-text-muted">오늘 남은 대화 {row.remaining_chat_count}회</div>
          </>
        )}
      </div>
    </motion.button>
  );
}

function GateCharacterPreview({ row, onClose }: { row: DimensionalGateRosterRow; onClose: () => void }) {
  const image = getCharacterImage(row);
  const [chatOpen, setChatOpen] = useState(false);
  const [storyOpen, setStoryOpen] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [rewardsOpen, setRewardsOpen] = useState(false);
  const [playingStory, setPlayingStory] = useState<DimensionalGateStoryListItem | null>(null);
  const detailQuery = useQuery({
    queryKey: ['dimensional-gate-character', row.character_id],
    queryFn: async () => {
      const result = await dimensionalGateRpc.character(supabase, row.character_id);
      if (result.success === false) throw new Error(result.error);
      return result.data;
    },
    staleTime: 30_000,
    retry: 1,
  });
  const detail = detailQuery.data;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="w-full max-w-md overflow-hidden rounded-card-xl border border-line bg-bg-overlay shadow-card"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="relative aspect-[16/9] overflow-hidden bg-bg-deep">
          {image && <img src={image} alt="" className="h-full w-full object-cover object-top opacity-80" />}
          <div className="absolute inset-0 bg-gradient-to-t from-bg-overlay via-bg-overlay/40 to-transparent" />
          <button type="button" onClick={onClose} className="absolute right-3 top-3 rounded-full border border-white/15 bg-black/45 px-2.5 py-1 text-sm font-black text-white">×</button>
          <div className="absolute inset-x-0 bottom-0 p-4">
            <div className="text-2xs font-black text-violet-200">{DIMENSIONAL_GATE_RELATION_LABEL[row.relation_stage]} · {row.affinity}/100</div>
            <h3 className="mt-1 font-display text-2xl text-white">{row.name}</h3>
            {row.epithet && <p className="mt-0.5 text-xs font-bold text-text-secondary">{row.epithet}</p>}
          </div>
        </div>
        <div className="space-y-3 p-4">
          <p className="text-xs font-semibold leading-relaxed text-text-secondary">{row.description || '아직 기록되지 않은 편린입니다.'}</p>
          <div className="grid grid-cols-4 gap-2">
            <PreviewAction icon="💬" label="대화" disabled={!row.gate_enabled || row.status === 'LOCKED'} onClick={() => setChatOpen(true)} />
            <PreviewAction icon="▶" label="만남" disabled={!row.gate_enabled} onClick={() => setStoryOpen(true)} />
            <PreviewAction icon="🖼️" label="화첩" disabled={!row.gate_enabled} onClick={() => setGalleryOpen(true)} />
            <PreviewAction icon="🎁" label="보상" disabled={!row.gate_enabled} onClick={() => setRewardsOpen(true)} />
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <div className="text-xs font-black text-white">되찾은 기억</div>
              <div className="text-[9px] font-bold text-text-muted">40 · 70 · 100</div>
            </div>
            {detailQuery.isLoading ? (
              <div className="rounded-card-md border border-line bg-bg-deep/50 px-3 py-4 text-center text-[10px] font-bold text-text-muted">기억을 불러오는 중...</div>
            ) : detailQuery.isError ? (
              <div className="rounded-card-md border border-warning/30 bg-warning/10 px-3 py-3 text-[10px] font-bold text-warning">기억 정보를 불러오지 못했어요.</div>
            ) : (detail?.memories.length ?? 0) === 0 ? (
              <div className="rounded-card-md border border-dashed border-line bg-bg-deep/40 px-3 py-4 text-center text-[10px] font-bold text-text-muted">아직 등록된 기억이 없습니다.</div>
            ) : (
              <div className="space-y-2">
                {detail?.memories.map((memory) => (
                  <div key={memory.memory_no} className={cn('rounded-card-md border px-3 py-2.5', memory.unlocked ? 'border-violet-300/25 bg-violet-500/5' : 'border-line bg-bg-deep/45')}>
                    <div className="flex items-center justify-between gap-2">
                      <div className={cn('text-[11px] font-black', memory.unlocked ? 'text-white' : 'text-text-muted')}>
                        {memory.unlocked ? (memory.title || `기억 ${memory.memory_no}`) : `기억 ${memory.memory_no} · ???`}
                      </div>
                      <div className="text-[9px] font-black text-text-muted">호감도 {memory.unlock_affinity}</div>
                    </div>
                    {memory.unlocked && memory.content && <p className="mt-1.5 text-[10px] font-semibold leading-relaxed text-text-secondary">{memory.content}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-card-md border border-line bg-bg-deep/60 px-3 py-2 text-[10px] font-bold leading-relaxed text-text-muted">
            AI 자유 대화·기억·만남 이벤트·화첩·호감도 보상이 연결되어 있습니다.
          </div>
        </div>
      </motion.div>

      {chatOpen && <DimensionalGateChatModal character={row} onClose={() => setChatOpen(false)} />}
      {storyOpen && (
        <DimensionalGateStoryModal
          character={row}
          onClose={() => setStoryOpen(false)}
          onPlay={(story) => { setStoryOpen(false); setPlayingStory(story); }}
        />
      )}
      {galleryOpen && <DimensionalGateGalleryModal character={row} onClose={() => setGalleryOpen(false)} />}
      {rewardsOpen && <DimensionalGateRewardsModal character={row} onClose={() => setRewardsOpen(false)} />}
      {playingStory && <DimensionalGateVN character={row} story={playingStory} onClose={() => setPlayingStory(null)} />}
    </div>
  );
}

function PreviewAction({ icon, label, disabled = false, onClick }: { icon: string; label: string; disabled?: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'rounded-card-md border border-line bg-bg-card px-2 py-3 text-center transition-colors',
        disabled ? 'cursor-default opacity-45' : 'hover:border-violet-300/35 hover:bg-violet-500/5',
      )}
    >
      <div className="text-lg">{icon}</div>
      <div className="mt-1 text-[10px] font-black text-text-secondary">{label}</div>
    </button>
  );
}

function getCharacterImage(row: DimensionalGateRosterRow): string | null {
  const raw = row.card_image_url || row.full_image_url || row.avatar_image_url || row.resource_url;
  return raw ? resolveAssetUrl(raw, 'character') : null;
}

function relationTone(stage: DimensionalGateRosterRow['relation_stage']) {
  if (stage === 'TRUST') return 'text-gold';
  if (stage === 'AFFECTION') return 'text-pink-300';
  if (stage === 'INTEREST') return 'text-brand-glow';
  return 'text-text-secondary';
}

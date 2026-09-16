import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';

import { LoadingSpinner } from '@/components/shared/components';
import {
  dimensionalGateRpc,
  type DimensionalGateRosterRow,
  type DimensionalGateStoryListItem,
} from '@/lib/rpc/dimensional_gate_rpc';
import { supabase } from '@/lib/supabase/client';
import { cn } from '@/lib/utils/cn';

interface Props {
  character: DimensionalGateRosterRow;
  onClose: () => void;
  onPlay: (story: DimensionalGateStoryListItem) => void;
}

export default function DimensionalGateStoryModal({ character, onClose, onPlay }: Props) {
  const query = useQuery({
    queryKey: ['dimensional-gate-stories', character.character_id],
    queryFn: async () => {
      const result = await dimensionalGateRpc.stories(supabase, character.character_id);
      if (result.success === false) throw new Error(result.error);
      return result.data;
    },
    staleTime: 15_000,
    retry: 1,
  });

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-black/75 p-4 backdrop-blur-sm" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, y: 14, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="w-full max-w-lg overflow-hidden rounded-card-xl border border-line bg-bg-overlay shadow-card"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-violet-200/70">Meeting Event</div>
            <h3 className="mt-0.5 text-lg font-black text-white">{character.name}의 이야기</h3>
          </div>
          <button type="button" onClick={onClose} className="rounded-full border border-line bg-bg-card px-2.5 py-1 text-sm font-black text-white">×</button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto p-4">
          {query.isLoading ? (
            <div className="grid min-h-48 place-items-center"><LoadingSpinner size="md" /></div>
          ) : query.isError ? (
            <div className="rounded-card-md border border-danger/30 bg-danger-bg p-4 text-center text-xs font-bold text-danger">
              만남 이벤트를 불러오지 못했어요.
            </div>
          ) : (query.data?.stories.length ?? 0) === 0 ? (
            <div className="rounded-card-md border border-dashed border-line bg-bg-deep/40 p-8 text-center">
              <div className="text-3xl">📖</div>
              <p className="mt-2 text-xs font-black text-text-secondary">아직 등록된 만남 이벤트가 없습니다.</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {query.data?.stories.map((story) => (
                <StoryCard key={story.episode_id} story={story} onPlay={() => onPlay(story)} />
              ))}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}

function StoryCard({ story, onPlay }: { story: DimensionalGateStoryListItem; onPlay: () => void }) {
  return (
    <button
      type="button"
      disabled={!story.unlocked}
      onClick={onPlay}
      className={cn(
        'flex w-full items-center gap-3 rounded-card-md border px-3.5 py-3 text-left transition-all',
        story.unlocked
          ? 'border-line bg-bg-card hover:border-violet-300/35 hover:bg-violet-500/5'
          : 'cursor-default border-line/60 bg-bg-deep/45 opacity-60',
      )}
    >
      <div className={cn(
        'grid h-10 w-10 flex-none place-items-center rounded-full border text-sm font-black',
        story.unlocked ? 'border-violet-300/25 bg-violet-500/10 text-violet-100' : 'border-line bg-bg-deep text-text-muted',
      )}>
        {story.unlocked ? story.episode_no : '🔒'}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <div className="truncate text-xs font-black text-white">{story.episode_no}편 · {story.title}</div>
          {story.is_new && <span className="rounded-pill bg-danger px-1.5 py-0.5 text-[8px] font-black text-white">NEW</span>}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[9px] font-bold text-text-muted">
          {!story.unlocked ? (
            <span>호감도 {story.required_affinity}에서 열림</span>
          ) : story.completed ? (
            <span className="text-success">✓ 감상 완료</span>
          ) : story.opened ? (
            <span className="text-brand-glow">이어보기 가능</span>
          ) : (
            <span>열람 가능</span>
          )}
          {story.estimated_minutes != null && <span>약 {story.estimated_minutes}분</span>}
          {story.headphone_recommended && <span>🎧 이어폰 권장</span>}
        </div>
      </div>
      {story.unlocked && <div className="text-sm text-text-muted">›</div>}
    </button>
  );
}

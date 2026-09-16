import { useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { useState } from 'react';

import type { DimensionalGateLiminelRecord } from '@/lib/rpc/dimensional_gate_rpc';
import { dimensionalGateRpc } from '@/lib/rpc/dimensional_gate_rpc';
import { supabase } from '@/lib/supabase/client';

interface Props {
  record: DimensionalGateLiminelRecord;
  onClose: () => void;
}

export default function DimensionalGateLiminelModal({ record, onClose }: Props) {
  const queryClient = useQueryClient();
  const [closing, setClosing] = useState(false);

  const close = async () => {
    if (closing) return;
    setClosing(true);
    if (!record.intro_seen) {
      await dimensionalGateRpc.markLiminelIntroSeen(supabase);
      await queryClient.invalidateQueries({ queryKey: ['dimensional-gate-liminel'] });
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[76] grid place-items-center bg-black/80 p-4 backdrop-blur-sm" onClick={() => { void close(); }}>
      <motion.div
        initial={{ opacity: 0, y: 14, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="w-full max-w-xl overflow-hidden rounded-card-xl border border-violet-300/20 bg-bg-overlay shadow-card"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="border-b border-line bg-gradient-to-br from-violet-500/10 to-transparent p-5">
          <div className="text-[10px] font-black uppercase tracking-[0.22em] text-violet-200/70">Arcanum · Archivist</div>
          <h3 className="mt-1 font-display text-2xl text-white">리미넬 옵스큐라</h3>
          <p className="mt-2 text-xs font-semibold leading-relaxed text-text-secondary">
            {record.intro_seen
              ? '당신과 편린들이 이어온 관계를 기록하고 있어요. 되찾은 기억과 신뢰의 흔적은 이곳에서 사라지지 않습니다.'
              : '차원관문에 온 것을 환영해요. 이곳에서는 영입한 편린과 대화하고, 관계가 깊어질수록 잃어버린 기억과 이야기를 되찾게 됩니다.'}
          </p>
        </div>

        <div className="p-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <RecordStat label="연결" value={record.relationship_count} />
            <RecordStat label="기억" value={record.memory_count} />
            <RecordStat label="완독" value={record.completed_story_count} />
            <RecordStat label="화첩" value={record.gallery_count} />
            <RecordStat label="신뢰" value={record.trust_count} accent />
          </div>

          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-xs font-black text-white">신뢰의 기록</div>
              <div className="text-[9px] font-bold text-text-muted">호감도 100 달성 기록</div>
            </div>
            {record.trust_records.length === 0 ? (
              <div className="rounded-card-md border border-dashed border-line bg-bg-deep/40 p-5 text-center text-[10px] font-bold text-text-muted">
                아직 신뢰 단계에 도달한 편린은 없습니다.
              </div>
            ) : (
              <div className="max-h-52 space-y-2 overflow-y-auto">
                {record.trust_records.map((item) => (
                  <div key={`${item.character_id}-${item.unlocked_at}`} className="flex items-center justify-between rounded-card-md border border-violet-300/15 bg-violet-500/5 px-3 py-2.5">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-black text-white">{item.name}</div>
                      <div className="truncate text-[9px] font-bold text-text-muted">{item.epithet || item.character_uid}</div>
                    </div>
                    <div className="ml-3 flex-none text-[9px] font-black text-violet-200">신뢰 ✓</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {!record.intro_seen && (
            <div className="mt-4 rounded-card-md border border-violet-300/20 bg-violet-500/5 px-3 py-2.5 text-[10px] font-semibold leading-relaxed text-text-secondary">
              관계 단계는 낯섦(0~39) → 관심(40~69) → 호감(70~99) → 신뢰(100)로 이어집니다. 40·70·100에서 새로운 기억이 열립니다.
            </div>
          )}

          <button type="button" disabled={closing} onClick={() => { void close(); }} className="mt-4 w-full rounded-card-md bg-brand-primary px-4 py-2.5 text-xs font-black text-white disabled:opacity-50">
            {record.intro_seen ? '기록관 닫기' : '기록을 시작한다'}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

function RecordStat({ label, value, accent = false }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="rounded-card-md border border-line bg-bg-deep/55 px-2 py-3 text-center">
      <div className={accent ? 'text-lg font-black text-violet-200' : 'text-lg font-black text-white'}>{value}</div>
      <div className="mt-0.5 text-[9px] font-black text-text-muted">{label}</div>
    </div>
  );
}

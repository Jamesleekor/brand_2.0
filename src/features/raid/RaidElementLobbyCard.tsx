import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import {
  raidStudentRpc,
  type RaidElement,
  type RaidElementOption,
  type RaidElementEffect,
  type RaidStatus,
} from '@/lib/rpc/raid_student_rpc';

const ELEMENT_LABELS: Record<RaidElement, string> = {
  EARTH: '지(土)', WATER: '수(水)', FIRE: '화(火)',
  WIND: '풍(風)', LIGHT: '성(聖)', DARK: '암(暗)',
};
const TYPE_LABELS: Record<string, string> = {
  PURE: '순수 조합', ADJACENT: '인접 조합', CROSS: '교차 조합',
  POLAR_MIXED: '원소·성암 혼합', POLAR_DUAL: '성암 혼합', UNEQUIPPED: '미장착',
};

const multiplierText = (bp: number | undefined) =>
  `${((Number.isFinite(bp) ? Number(bp) : 10000) / 100).toFixed(2)}%`;

function partText(option: RaidElementOption) {
  const first = `${ELEMENT_LABELS[option.primary_element]} ${option.primary_points}`;
  return option.secondary_element
    ? `${first} · ${ELEMENT_LABELS[option.secondary_element]} ${option.secondary_points}`
    : first;
}

export default function RaidElementLobbyCard({ raidId, status, bossElement }: {
  raidId: number;
  status: RaidStatus;
  bossElement: RaidElement;
}) {
  const queryClient = useQueryClient();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [savingId, setSavingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ['raid-element-options', raidId],
    queryFn: async () => {
      const response = await raidStudentRpc.elementOptions(supabase, raidId);
      if (response.success === false) throw new Error(response.error);
      return response.data;
    },
    enabled: Number.isFinite(raidId) && raidId > 0,
    staleTime: 5000,
    refetchInterval: status === 'LOBBY_OPEN' ? 15000 : false,
    refetchOnWindowFocus: true,
  });
  const data = query.data;
  const ruleOn = data?.rules_version === 'V1';
  const editable = status === 'LOBBY_OPEN';
  const options = useMemo(() => {
    const list = data?.options ?? [];
    const q = search.trim().toLocaleLowerCase();
    return list.filter((item) => !q || item.name.toLocaleLowerCase().includes(q))
      .sort((a, b) => Number(b.effect.total_multiplier_bp ?? 10000) - Number(a.effect.total_multiplier_bp ?? 10000) || a.name.localeCompare(b.name));
  }, [data?.options, search]);
  const locked = status !== 'LOBBY_OPEN';
  const displayedId = locked ? data?.locked_equipped_character_id : data?.equipped_character_id;
  const equipped = data?.options.find((option) => option.character_id === displayedId);
  const equippedName = equipped?.name ?? (locked ? data?.locked_equipped_character_name : null);
  const equippedImage = equipped?.image_url ?? (locked ? data?.locked_equipped_character_image_url : null);
  const preview = data?.preview;
  const noEquip = ruleOn && (preview?.type === 'UNEQUIPPED' || !displayedId);

  const equip = async (candidate: RaidElementOption) => {
    if (!editable || savingId !== null) return;
    setSavingId(candidate.character_id);
    setError(null);
    try {
      const result = await raidStudentRpc.equipCharacter(supabase, candidate.character_id);
      if (result.success === false) throw new Error(result.error);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['raid-element-options', raidId] }),
        queryClient.invalidateQueries({ queryKey: ['raid-lobby', raidId] }),
      ]);
      setPickerOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '편린 장착에 실패했습니다.');
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="border-b border-yellow-300/25 bg-[#171821]/95 p-3 text-white">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-black text-yellow-100">⚔️ 내 속성 상성</span>
        <span className="text-[11px] font-bold text-cyan-100">보스 {ELEMENT_LABELS[bossElement]}</span>
      </div>
      {query.isLoading ? (
        <div className="mt-2 text-xs text-cyan-100">상성을 계산하는 중...</div>
      ) : query.isError ? (
        <div className="mt-2 text-xs font-bold text-red-200">상성 정보 조회에 실패했습니다. 교사에게 문의해주세요.</div>
      ) : !ruleOn ? (
        <div className="mt-2 text-xs text-cyan-100">이번 레이드는 속성 보정 미사용 (100.00%)</div>
      ) : (
        <div className="mt-2 space-y-2">
          <div className="flex items-center gap-2 rounded-card-md border border-yellow-300/20 bg-black/30 p-2">
            {equippedImage ? <img src={equippedImage} alt="장착 편린" className="h-11 w-11 flex-none rounded object-cover" /> : <span className="text-2xl">✨</span>}
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-black">{equippedName ?? '장착한 편린 없음'}</div>
              <div className="truncate text-[10px] text-cyan-100">{equipped ? `${partText(equipped)} · ${TYPE_LABELS[preview?.type ?? ''] ?? '속성 조합'}` : equippedName ? `${TYPE_LABELS[preview?.type ?? ''] ?? '속성 조합'} · 전투 시작 시 고정` : '지금 편린을 장착해 보세요'}</div>
            </div>
            <div className="text-right">
              <div className="text-[10px] text-yellow-100">{editable ? '예상 배율' : '확정 배율'}</div>
              <div className="font-mono text-lg font-black text-emerald-200">{multiplierText(preview?.total_multiplier_bp)}</div>
            </div>
          </div>
          {noEquip && <div className="text-[11px] font-bold text-red-200">미장착: 전투 대미지는 90%만 적용됩니다.</div>}
          {preview?.grade_bonus_bp != null && (
            <div className="text-[10px] text-cyan-100">등급 +{(preview.grade_bonus_bp / 100).toFixed(2)}%p · 상성 {preview.matchup_bonus_bp && preview.matchup_bonus_bp > 0 ? '+' : ''}{((preview.matchup_bonus_bp ?? 0) / 100).toFixed(2)}%p</div>
          )}
          {editable ? (
            <button type="button" onClick={() => { setPickerOpen(true); setError(null); }} className="w-full rounded-card-md border border-yellow-300/45 bg-yellow-500/10 px-3 py-2 text-xs font-black text-yellow-100 hover:bg-yellow-400/20">
              장착 편린 변경 · 상성 비교
            </button>
          ) : <div className="text-[10px] text-cyan-100">전투 시작 시점에 속성이 고정되었습니다.</div>}
        </div>
      )}
      {pickerOpen && editable && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/80 p-4" role="dialog" aria-modal="true" aria-label="장착 편린 선택">
          <div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-card-lg border border-yellow-300/50 bg-[#101a2c] p-4 shadow-2xl">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-base font-black text-yellow-100">이번 보스 상성 비교</h3>
              <button type="button" onClick={() => setPickerOpen(false)} className="rounded border border-white/20 px-3 py-1 text-xs text-white">닫기</button>
            </div>
            <p className="my-2 text-xs text-cyan-100">장착 후 교사가 전투를 시작하는 순간 배율이 확정됩니다.</p>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="보유 편린 검색" className="mb-2 w-full rounded border border-cyan-300/35 bg-black/40 px-3 py-2 text-sm text-white" />
            {error && <p role="alert" className="mb-2 text-xs font-bold text-red-200">{error}</p>}
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
              {options.length === 0 && <p className="p-4 text-center text-xs text-cyan-100">표시할 편린이 없습니다.</p>}
              {options.map((option) => (
                <div key={option.character_id} className="flex items-center gap-2 rounded-card-md border border-cyan-300/25 bg-black/25 p-2">
                  {option.image_url ? <img src={option.image_url} alt="" className="h-12 w-12 flex-none rounded object-cover" /> : <span className="h-12 w-12 flex-none text-center text-2xl">✦</span>}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-black">{option.name}</div>
                    <div className="truncate text-[10px] text-cyan-100">{partText(option)}</div>
                    <div className="text-[10px] text-yellow-100">{TYPE_LABELS[option.effect.type ?? ''] ?? '속성 조합'}</div>
                  </div>
                  <div className="flex-none text-right">
                    <div className="font-mono text-sm font-black text-emerald-200">{multiplierText(option.effect.total_multiplier_bp)}</div>
                    <button type="button" disabled={option.is_equipped || savingId !== null} onClick={() => void equip(option)} className="mt-1 rounded border border-yellow-300/40 bg-yellow-500/15 px-2 py-1 text-[11px] font-black text-yellow-100 disabled:opacity-50">
                      {option.is_equipped ? '장착 중' : savingId === option.character_id ? '변경 중...' : '장착하기'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

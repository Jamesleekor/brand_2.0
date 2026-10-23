export type ExpeditionPartySlots = [number | null, number | null, number | null];

export const EXPEDITION_ROLES = [
  { label: '원정대장', symbol: '♛', effect: '유리한 속성 기여 ×1.2' },
  { label: '부대장', symbol: '✦', effect: '특기 일치 시 +5%p' },
  { label: '대원', symbol: '⚔', effect: '기본 능력으로 참여' },
] as const;

export function assignExpeditionParty(
  slots: ExpeditionPartySlots,
  target: number,
  characterId: number,
): { slots: ExpeditionPartySlots; activeSlot: number } {
  const next = [...slots] as ExpeditionPartySlots;
  if (target < 0 || target > 2) return { slots: next, activeSlot: 0 };
  const previous = next.indexOf(characterId);
  if (previous === target) {
    next[target] = null;
    return { slots: next, activeSlot: target };
  }
  if (previous >= 0) next[previous] = next[target];
  next[target] = characterId;
  const empty = next.findIndex(id => id === null);
  return { slots: next, activeSlot: empty < 0 ? target : empty };
}

export function swapExpeditionParty(slots: ExpeditionPartySlots, first: number, second: number): ExpeditionPartySlots {
  const next = [...slots] as ExpeditionPartySlots;
  if (first < 0 || second < 0 || first > 2 || second > 2) return next;
  [next[first], next[second]] = [next[second], next[first]];
  return next;
}

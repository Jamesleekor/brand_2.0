import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { EmptyState, LoadingSpinner, Modal, useRpcCall } from '@/components/shared/components';
import { characterC4BRpc, type TeacherBuffEffectRow, type TeacherCharacterCollectionAdminBoard, type TeacherCharacterCollectionRow, type TeacherCollectionPreview } from '@/lib/rpc/character_c4b_rpc';
import type { TeacherCharacterRow, TeacherCharacterStudentRow } from '@/lib/rpc/character_c3_rpc';
import type { CharacterCollectionClass, CharacterCollectionRewardInput } from '@/lib/zod_schemas/character_c4b_schemas';
import { supabase } from '@/lib/supabase/client';
import { cn } from '@/lib/utils/cn';

type CollectionFilter = 'ALL' | 'ACTIVE' | 'DRAFT' | 'SMALL' | 'STANDARD' | 'LARGE';

type CollectionForm = {
  uid: string;
  name: string;
  description: string;
  collectionClass: CharacterCollectionClass;
  isActive: boolean;
  isVisible: boolean;
  sortOrder: string;
  characterIds: number[];
  rewards: CharacterCollectionRewardInput[];
};

export function CharacterCollectionAdminPanel({
  classroomId,
  characters,
  students,
}: {
  classroomId: number;
  characters: TeacherCharacterRow[];
  students: TeacherCharacterStudentRow[];
}) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<CollectionFilter>('ALL');
  const [editing, setEditing] = useState<TeacherCharacterCollectionRow | 'NEW' | null>(null);

  const query = useQuery<TeacherCharacterCollectionAdminBoard>({
    queryKey: ['character-c4b-admin-board', classroomId],
    queryFn: async () => {
      const result = await characterC4BRpc.board(supabase, classroomId);
      if (result.success === false) throw new Error(result.error);
      return result.data ?? { total_students: 0, effects: [], collections: [] };
    },
  });

  const rows = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase('ko-KR');
    return (query.data?.collections ?? []).filter((row) => {
      if (filter === 'ACTIVE' && !row.is_active) return false;
      if (filter === 'DRAFT' && row.is_active) return false;
      if (filter === 'SMALL' && row.collection_class !== 'SMALL') return false;
      if (filter === 'STANDARD' && row.collection_class !== 'STANDARD') return false;
      if (filter === 'LARGE' && row.collection_class !== 'LARGE') return false;
      if (!needle) return true;
      return [row.collection_uid, row.name, row.description, ...row.members.map((member) => member.name), ...row.rewards.map((reward) => reward.display_name)]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase('ko-KR').includes(needle));
    });
  }, [filter, query.data?.collections, search]);

  const activeCount = (query.data?.collections ?? []).filter((row) => row.is_active).length;
  const visibleCount = (query.data?.collections ?? []).filter((row) => row.is_visible).length;
  const totalRewards = (query.data?.collections ?? []).reduce((sum, row) => sum + row.reward_count, 0);

  if (query.isLoading || !query.data) {
    return <div className="flex min-h-[420px] items-center justify-center"><LoadingSpinner size="lg" /></div>;
  }

  if (query.isError) {
    return (
      <div className="rounded-card-lg border border-danger/40 bg-danger-bg p-6 text-center">
        <div className="text-3xl">⚠️</div>
        <h2 className="mt-2 font-display text-lg text-white">콜렉션 운영 데이터를 불러오지 못했습니다</h2>
        <p className="mt-2 break-all text-xs text-text-primary">
          {query.error instanceof Error ? query.error.message : '알 수 없는 오류'}
        </p>
        <p className="mt-2 text-xs font-bold text-warning">C4-B 운영 RPC migration이 먼저 적용되어 있어야 합니다.</p>
      </div>
    );
  }

  return (
    <section className="space-y-4">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <MiniStat emoji="🧩" label="전체 콜렉션" value={query.data.collections.length} />
        <MiniStat emoji="⚡" label="활성" value={activeCount} accent="success" />
        <MiniStat emoji="👁" label="학생 공개" value={visibleCount} accent="bv" />
        <MiniStat emoji="✨" label="등록 버프" value={totalRewards} accent="gold" />
      </div>

      <div className="rounded-card-lg border border-line bg-bg-card p-3">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex gap-1.5 overflow-x-auto">
            {(['ALL','ACTIVE','DRAFT','SMALL','STANDARD','LARGE'] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={cn(
                  'flex-shrink-0 rounded-pill border px-3 py-2 text-xs font-black transition-all',
                  filter === key ? 'border-brand-primary/50 bg-brand-primary/20 text-white' : 'border-line bg-bg-deep text-text-secondary hover:text-white',
                )}
              >
                {filterLabel(key)}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="콜렉션 · 편린 · 버프 검색"
              className="min-w-0 flex-1 rounded-card-md border border-line bg-bg-deep px-3 py-2 text-xs font-bold text-text-primary outline-none focus:border-brand-primary/60 xl:w-72"
            />
            <button type="button" onClick={() => setEditing('NEW')} className="btn-primary whitespace-nowrap">+ 새 콜렉션</button>
          </div>
        </div>
        <div className="mt-2 text-[10px] font-bold text-text-muted">
          소형·일반·대형은 운영 분류입니다. 권장 편린 수를 벗어나도 저장할 수 있으며, 한 편린은 여러 콜렉션에 중복 포함할 수 있습니다.
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-card-lg border border-line bg-bg-card">
          <EmptyState
            emoji="🧩"
            title={query.data.collections.length === 0 ? '아직 편린 콜렉션이 없습니다' : '조건에 맞는 콜렉션이 없습니다'}
            description={query.data.collections.length === 0 ? '첫 콜렉션을 만들어 편린 조합과 자동 버프를 설정해보세요.' : '검색어나 필터를 바꿔보세요.'}
            action={query.data.collections.length === 0 ? <button type="button" onClick={() => setEditing('NEW')} className="btn-primary">첫 콜렉션 만들기</button> : undefined}
          />
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
          {rows.map((row) => (
            <CollectionCard key={row.id} row={row} onEdit={() => setEditing(row)} />
          ))}
        </div>
      )}

      <CollectionEditorModal
        row={editing}
        classroomId={classroomId}
        characters={characters}
        students={students}
        effects={query.data.effects}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          void queryClient.invalidateQueries({ queryKey: ['character-c4b-admin-board', classroomId] });
        }}
      />
    </section>
  );
}

function CollectionCard({ row, onEdit }: { row: TeacherCharacterCollectionRow; onEdit: () => void }) {
  const completionPct = row.total_students > 0 ? Math.round((row.complete_students / row.total_students) * 100) : 0;
  return (
    <article className={cn('overflow-hidden rounded-card-lg border bg-bg-card', row.is_active ? 'border-brand-primary/25' : 'border-line opacity-85')}>
      <div className="flex items-start justify-between gap-3 border-b border-line p-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge label={classLabel(row.collection_class)} tone="info" />
            <Badge label={row.is_active ? '활성' : '비활성'} tone={row.is_active ? 'success' : 'muted'} />
            {!row.is_visible && <Badge label="비공개" tone="warning" />}
          </div>
          <div className="mt-2 truncate font-mono text-[10px] font-black text-text-muted">{row.collection_uid}</div>
          <h3 className="truncate font-display text-lg text-white">{row.name}</h3>
          <p className="mt-1 line-clamp-2 min-h-[32px] text-xs font-semibold text-text-secondary">{row.description || '설명 없음'}</p>
        </div>
        <button type="button" onClick={onEdit} className="btn-secondary flex-shrink-0">편집</button>
      </div>

      <div className="space-y-3 p-4">
        <div>
          <div className="mb-1.5 flex items-center justify-between text-[10px] font-black text-text-muted">
            <span>구성 편린 {row.member_count}종</span>
            <span>{row.complete_students} / {row.total_students}명 완성</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-bg-deep">
            <div className="h-full rounded-full bg-brand-primary transition-all" style={{ width: `${completionPct}%` }} />
          </div>
        </div>

        <div className="flex min-h-[48px] items-center gap-1.5 overflow-hidden">
          {row.members.slice(0, 6).map((member) => <MemberMini key={member.character_id} member={member} />)}
          {row.members.length > 6 && (
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full border border-line bg-bg-deep text-[10px] font-black text-text-secondary">
              +{row.members.length - 6}
            </div>
          )}
          {row.members.length === 0 && <span className="text-xs font-bold text-warning">구성 편린 미설정</span>}
        </div>

        <div className="flex flex-wrap gap-1.5">
          {row.rewards.map((reward) => (
            <span key={reward.effect_id} className="rounded-pill border border-gold/25 bg-gold/10 px-2.5 py-1 text-[10px] font-black text-gold">
              {reward.display_name} {effectValueText(reward.effect_value, reward.value_unit, reward.direction)}
            </span>
          ))}
          {row.rewards.length === 0 && <span className="text-xs font-bold text-warning">버프 미설정</span>}
        </div>
      </div>
    </article>
  );
}

function CollectionEditorModal({
  row,classroomId,characters,students,effects,onClose,onSaved,
}: {
  row: TeacherCharacterCollectionRow | 'NEW' | null;
  classroomId: number;
  characters: TeacherCharacterRow[];
  students: TeacherCharacterStudentRow[];
  effects: TeacherBuffEffectRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<CollectionForm>(blankForm());
  const [memberSearch, setMemberSearch] = useState('');
  const [preview, setPreview] = useState<TeacherCollectionPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [inlineError, setInlineError] = useState('');
  const { call, isLoading } = useRpcCall();

  useEffect(() => {
    if (!row) return;
    setInlineError('');
    setMemberSearch('');
    setPreview(null);
    setPreviewError('');

    if (row === 'NEW') {
      setForm(blankForm());
      void (async () => {
        const result = await characterC4BRpc.suggestUid(supabase, classroomId);
        if (result.success === false) {
          setInlineError(result.error);
        } else {
          setForm((current) => ({ ...current, uid: result.data ?? '' }));
        }
      })();
    } else {
      setForm(formFromRow(row));
    }
  }, [classroomId, row]);

  const selectedSet = useMemo(() => new Set(form.characterIds), [form.characterIds]);
  const visibleCharacters = useMemo(() => {
    const needle = memberSearch.trim().toLocaleLowerCase('ko-KR');
    return characters.filter((character) => {
      if (!needle) return true;
      return [character.character_uid,character.name,character.epithet]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase('ko-KR').includes(needle));
    });
  }, [characters, memberSearch]);

  const localCompleteCount = useMemo(() => {
    if (form.characterIds.length === 0) return 0;
    return students.filter((student) => {
      const owned = new Set(student.owned_character_ids);
      return form.characterIds.every((characterId) => owned.has(characterId));
    }).length;
  }, [form.characterIds, students]);

  const selectedRewards = useMemo(() => new Map(form.rewards.map((reward) => [reward.effect_id, reward])), [form.rewards]);

  if (!row) return null;

  const toggleCharacter = (characterId: number) => {
    setPreview(null);
    setForm((current) => ({
      ...current,
      characterIds: current.characterIds.includes(characterId)
        ? current.characterIds.filter((id) => id !== characterId)
        : [...current.characterIds, characterId],
    }));
  };

  const toggleEffect = (effect: TeacherBuffEffectRow) => {
    setForm((current) => ({
      ...current,
      rewards: current.rewards.some((reward) => reward.effect_id === effect.id)
        ? current.rewards.filter((reward) => reward.effect_id !== effect.id)
        : [...current.rewards, { effect_id: effect.id, effect_value: defaultEffectValue(effect) }],
    }));
  };

  const updateEffectValue = (effectId: number, value: number) => {
    setForm((current) => ({
      ...current,
      rewards: current.rewards.map((reward) => reward.effect_id === effectId ? { ...reward, effect_value: value } : reward),
    }));
  };

  const runPreview = async () => {
    setPreviewLoading(true);
    setPreviewError('');
    const result = await characterC4BRpc.preview(supabase, classroomId, form.characterIds);
    setPreviewLoading(false);
    if (result.success === false) {
      setPreviewError(result.error);
      return;
    }
    setPreview(result.data ?? null);
  };

  const save = async () => {
    setInlineError('');
    if (form.isActive) {
      const inactiveRequired = form.characterIds
        .map((id) => characters.find((item) => item.id === id))
        .filter((item): item is TeacherCharacterRow => Boolean(item && !item.is_active));
      if (inactiveRequired.length > 0) {
        setInlineError(`활성 콜렉션에는 Master 비활성 편린을 넣을 수 없습니다: ${inactiveRequired.map((item) => item.name).join(', ')}`);
        return;
      }
    }
    for (const reward of form.rewards) {
      const effect = effects.find((item) => item.id === reward.effect_id);
      if (!effect) continue;
      if (!(reward.effect_value > 0) || reward.effect_value > effect.cap_value) {
        setInlineError(`${effect.display_name} 효과값은 0보다 크고 CAP ${formatNumber(effect.cap_value)} 이하여야 합니다.`);
        return;
      }
    }

    const collectionId = row === 'NEW' ? null : row.id;
    const result = await call(
      () => characterC4BRpc.save(supabase, {
        p_classroom_id: classroomId,
        p_collection_id: collectionId,
        p_collection_uid: form.uid.trim(),
        p_name: form.name.trim(),
        p_description: nullableText(form.description),
        p_collection_class: form.collectionClass,
        p_is_active: form.isActive,
        p_is_visible: form.isVisible,
        p_sort_order: Number(form.sortOrder) || 0,
        p_character_ids: form.characterIds,
        p_rewards: form.rewards,
      }),
      {
        successTitle: row === 'NEW' ? '콜렉션 생성 완료' : '콜렉션 저장 완료',
        successDescription: form.name.trim() || form.uid.trim(),
      },
    );
    if (result !== null) onSaved();
  };

  const guidance = classGuidance(form.collectionClass, form.characterIds.length);

  return (
    <Modal isOpen={true} onClose={isLoading ? () => undefined : onClose} title={row === 'NEW' ? '새 편린 콜렉션' : `콜렉션 편집 · ${row.name}`} emoji="🧩" size="full">
      <div className="grid min-h-0 gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <div className="space-y-4">
          <section className="rounded-card-lg border border-line bg-bg-card p-4">
            <div className="mb-3 text-sm font-black text-white">1. 기본 정보</div>
            <div className="grid gap-3">
              <Field label="콜렉션 UID">
                <input value={form.uid} onChange={(event) => setForm({ ...form, uid: event.target.value.toUpperCase() })} className="input-admin font-mono" placeholder="COLL-001" />
              </Field>
              <Field label="콜렉션 이름">
                <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="input-admin" placeholder="예: 별을 읽는 자들" />
              </Field>
              <Field label="설명">
                <textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} rows={3} className="input-admin resize-none" placeholder="학생에게 공개할 콜렉션 설명" />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="분류">
                  <select value={form.collectionClass} onChange={(event) => setForm({ ...form, collectionClass: event.target.value as CharacterCollectionClass })} className="input-admin">
                    <option value="SMALL">소형</option>
                    <option value="STANDARD">일반</option>
                    <option value="LARGE">대형</option>
                  </select>
                </Field>
                <Field label="정렬 순서">
                  <input type="number" min={0} value={form.sortOrder} onChange={(event) => setForm({ ...form, sortOrder: event.target.value })} className="input-admin" />
                </Field>
              </div>
              <div className="rounded-card-md border border-line bg-bg-deep p-3 text-[11px] font-bold">
                <div className={guidance.ok ? 'text-success' : 'text-warning'}>{guidance.text}</div>
                <div className="mt-1 text-text-muted">권장 범위는 안내용이며 DB에서 강제하지 않습니다.</div>
              </div>
              <label className="flex items-center justify-between rounded-card-md border border-line bg-bg-deep px-3 py-2.5">
                <span><span className="block text-xs font-black text-white">활성</span><span className="text-[10px] font-bold text-text-muted">자동 완성·버프 계산 대상</span></span>
                <input type="checkbox" checked={form.isActive} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} />
              </label>
              <label className="flex items-center justify-between rounded-card-md border border-line bg-bg-deep px-3 py-2.5">
                <span><span className="block text-xs font-black text-white">학생 공개</span><span className="text-[10px] font-bold text-text-muted">학생 콜렉션 UI 노출 여부</span></span>
                <input type="checkbox" checked={form.isVisible} onChange={(event) => setForm({ ...form, isVisible: event.target.checked })} />
              </label>
            </div>
          </section>

          <section className="rounded-card-lg border border-line bg-bg-card p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-black text-white">완성 인원 미리보기</div>
                <div className="mt-0.5 text-[10px] font-bold text-text-muted">현재 학생 편린 보유권 기준</div>
              </div>
              <button type="button" onClick={() => void runPreview()} disabled={previewLoading} className="btn-secondary">
                {previewLoading ? '계산 중…' : '서버 확인'}
              </button>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="rounded-card-md bg-bg-deep p-3 text-center"><div className="text-xl font-black text-white">{localCompleteCount}</div><div className="text-[10px] font-bold text-text-muted">즉시 예상 완성</div></div>
              <div className="rounded-card-md bg-bg-deep p-3 text-center"><div className="text-xl font-black text-white">{students.length}</div><div className="text-[10px] font-bold text-text-muted">현재 학생</div></div>
            </div>
            {preview && (
              <div className="mt-2 rounded-card-md border border-success/30 bg-success-bg px-3 py-2 text-xs font-black text-success">
                서버 판정: {preview.complete_students} / {preview.total_students}명 완성 · 필요 {preview.required_count}종
              </div>
            )}
            {previewError && <div className="mt-2 rounded-card-md border border-danger/30 bg-danger-bg px-3 py-2 text-xs font-bold text-danger">{previewError}</div>}
          </section>
        </div>

        <div className="space-y-4">
          <section className="rounded-card-lg border border-line bg-bg-card p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <div>
                <div className="text-sm font-black text-white">2. 구성 편린</div>
                <div className="mt-0.5 text-[10px] font-bold text-text-muted">선택 {form.characterIds.length}종 · 한 편린은 다른 콜렉션에도 다시 사용할 수 있습니다.</div>
              </div>
              <input value={memberSearch} onChange={(event) => setMemberSearch(event.target.value)} placeholder="UID · 이름 · 이명 검색" className="input-admin md:w-72" />
            </div>

            {form.characterIds.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5 rounded-card-md border border-brand-primary/20 bg-brand-primary/5 p-2">
                {form.characterIds.map((id, index) => {
                  const character = characters.find((item) => item.id === id);
                  if (!character) return null;
                  return (
                    <button key={id} type="button" onClick={() => toggleCharacter(id)} className="rounded-pill border border-brand-primary/30 bg-brand-primary/15 px-2.5 py-1 text-[10px] font-black text-white hover:border-danger/50">
                      {index + 1}. {character.name} ×
                    </button>
                  );
                })}
              </div>
            )}

            <div className="mt-3 grid max-h-[360px] gap-2 overflow-y-auto pr-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {visibleCharacters.map((character) => {
                const selected = selectedSet.has(character.id);
                return (
                  <button
                    key={character.id}
                    type="button"
                    onClick={() => toggleCharacter(character.id)}
                    className={cn(
                      'flex min-h-[72px] items-center gap-3 rounded-card-md border p-2.5 text-left transition-all',
                      selected ? 'border-brand-primary/60 bg-brand-primary/15' : 'border-line bg-bg-deep hover:border-brand-primary/30',
                    )}
                  >
                    <CharacterThumb character={character} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-mono text-[9px] font-black text-text-muted">{character.character_uid}</div>
                      <div className="truncate text-xs font-black text-white">{character.name}</div>
                      <div className="mt-1 flex gap-1">
                        <Badge label={selected ? '선택' : '추가'} tone={selected ? 'success' : 'muted'} />
                        {!character.is_active && <Badge label="Master 비활성" tone="warning" />}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="rounded-card-lg border border-line bg-bg-card p-4">
            <div>
              <div className="text-sm font-black text-white">3. 완성 버프</div>
              <div className="mt-0.5 text-[10px] font-bold text-text-muted">효과는 중첩되며, 학생별 최종 적용값은 Effect Catalog CAP에서 자동 제한됩니다.</div>
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {effects.map((effect) => {
                const reward = selectedRewards.get(effect.id);
                const checked = Boolean(reward);
                return (
                  <div key={effect.id} className={cn('rounded-card-md border p-3', checked ? 'border-gold/35 bg-gold/5' : 'border-line bg-bg-deep', !effect.is_active && 'opacity-50')}>
                    <label className="flex cursor-pointer items-start gap-3">
                      <input type="checkbox" checked={checked} disabled={!effect.is_active} onChange={() => toggleEffect(effect)} className="mt-1" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-xs font-black text-white">{effect.display_name}</span>
                          <Badge label={`CAP ${formatEffectCap(effect)}`} tone="warning" />
                        </div>
                        <div className="mt-1 line-clamp-2 text-[10px] font-semibold text-text-muted">{effect.description || effect.effect_code}</div>
                      </div>
                    </label>
                    {checked && reward && (
                      <div className="mt-2 flex items-center gap-2 border-t border-line pt-2">
                        <span className="text-[10px] font-black text-text-secondary">이 콜렉션 효과</span>
                        <input
                          type="number"
                          min={effect.value_unit === 'GOLD' ? 1 : 0.1}
                          max={effect.cap_value}
                          step={effect.value_unit === 'GOLD' ? 1 : 0.1}
                          value={reward.effect_value}
                          onChange={(event) => updateEffectValue(effect.id, Number(event.target.value))}
                          className="w-24 rounded-card-md border border-line bg-bg-base px-2 py-1.5 text-right text-xs font-black text-white outline-none focus:border-gold/50"
                        />
                        <span className="text-[10px] font-black text-gold">{effect.value_unit === 'GOLD' ? 'GOLD' : '%p'}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {inlineError && <div className="rounded-card-md border border-danger/40 bg-danger-bg px-4 py-3 text-xs font-bold text-danger">{inlineError}</div>}

          <div className="sticky bottom-0 flex items-center justify-between gap-3 rounded-card-lg border border-line bg-bg-base/95 p-3 backdrop-blur-card">
            <div className="min-w-0 text-[10px] font-bold text-text-muted">
              <span className="text-white">{form.characterIds.length}종</span> 편린 · <span className="text-gold">{form.rewards.length}개</span> 버프 · 활성 시 구성/버프가 모두 필요합니다.
            </div>
            <div className="flex flex-shrink-0 gap-2">
              <button type="button" onClick={onClose} disabled={isLoading} className="btn-secondary">취소</button>
              <button type="button" onClick={() => void save()} disabled={isLoading} className="btn-primary">{isLoading ? '저장 중…' : '콜렉션 저장'}</button>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function CharacterThumb({ character }: { character: TeacherCharacterRow }) {
  const url = character.card_image_url || character.resource_url || character.full_image_url;
  if (character.resource_kind === 'EMOJI') {
    return <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-card-md border border-line bg-bg-card text-2xl">{character.emoji || '✦'}</div>;
  }
  return (
    <div className="h-12 w-12 flex-shrink-0 overflow-hidden rounded-card-md border border-line bg-bg-card">
      {url ? <img src={url} alt="" className="h-full w-full object-contain" /> : <div className="flex h-full items-center justify-center text-xl">✦</div>}
    </div>
  );
}

function MemberMini({ member }: { member: TeacherCharacterCollectionRow['members'][number] }) {
  const url = member.card_image_url || member.resource_url;
  return (
    <div title={member.name} className="h-10 w-10 flex-shrink-0 overflow-hidden rounded-full border border-line bg-bg-deep">
      {member.resource_kind === 'EMOJI'
        ? <div className="flex h-full items-center justify-center text-lg">{member.emoji || '✦'}</div>
        : url ? <img src={url} alt={member.name} className="h-full w-full object-contain" /> : <div className="flex h-full items-center justify-center">✦</div>}
    </div>
  );
}

function MiniStat({ emoji,label,value,accent = 'brand' }: { emoji: string; label: string; value: number | string; accent?: 'brand'|'success'|'gold'|'bv' }) {
  const tone = accent === 'success' ? 'text-success' : accent === 'gold' ? 'text-gold' : accent === 'bv' ? 'text-bv' : 'text-brand-primary';
  return (
    <div className="rounded-card-lg border border-line bg-bg-card p-3">
      <div className="flex items-center gap-2"><span>{emoji}</span><span className="text-[10px] font-black text-text-muted">{label}</span></div>
      <div className={cn('mt-1 text-xl font-black', tone)}>{value}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block"><span className="mb-1 block text-[10px] font-black text-text-secondary">{label}</span>{children}</label>;
}

function Badge({ label, tone }: { label: string; tone: 'success'|'warning'|'info'|'muted' }) {
  const cls = tone === 'success' ? 'border-success/30 bg-success-bg text-success'
    : tone === 'warning' ? 'border-warning/30 bg-warning-bg text-warning'
      : tone === 'info' ? 'border-bv/30 bg-bv/10 text-bv'
        : 'border-line bg-bg-deep text-text-muted';
  return <span className={cn('rounded-pill border px-2 py-0.5 text-[9px] font-black', cls)}>{label}</span>;
}

function blankForm(): CollectionForm {
  return { uid: '', name: '', description: '', collectionClass: 'STANDARD', isActive: false, isVisible: true, sortOrder: '0', characterIds: [], rewards: [] };
}

function formFromRow(row: TeacherCharacterCollectionRow): CollectionForm {
  return {
    uid: row.collection_uid,
    name: row.name,
    description: row.description ?? '',
    collectionClass: row.collection_class,
    isActive: row.is_active,
    isVisible: row.is_visible,
    sortOrder: String(row.sort_order),
    characterIds: row.members.map((member) => member.character_id),
    rewards: row.rewards.map((reward) => ({ effect_id: reward.effect_id, effect_value: Number(reward.effect_value) })),
  };
}

function filterLabel(filter: CollectionFilter): string {
  if (filter === 'ALL') return '전체';
  if (filter === 'ACTIVE') return '활성';
  if (filter === 'DRAFT') return '비활성/초안';
  return classLabel(filter);
}

function classLabel(value: CharacterCollectionClass | 'SMALL'|'STANDARD'|'LARGE'): string {
  return value === 'SMALL' ? '소형' : value === 'LARGE' ? '대형' : '일반';
}

function classGuidance(value: CharacterCollectionClass, count: number): { ok: boolean; text: string } {
  const [min,max] = value === 'SMALL' ? [3,3] : value === 'STANDARD' ? [4,5] : [6,8];
  if (count === 0) return { ok: false, text: `${classLabel(value)} 권장 구성: ${min === max ? `${min}종` : `${min}~${max}종`}` };
  const ok = count >= min && count <= max;
  return { ok, text: `${classLabel(value)} · 현재 ${count}종 / 권장 ${min === max ? `${min}종` : `${min}~${max}종`} ${ok ? '✓' : ''}` };
}

function defaultEffectValue(effect: TeacherBuffEffectRow): number {
  if (effect.value_unit === 'GOLD') return Math.min(10, Number(effect.cap_value));
  if (effect.effect_code === 'SAVINGS_INTEREST_BONUS_PP') return Math.min(0.5, Number(effect.cap_value));
  return Math.min(1, Number(effect.cap_value));
}

function formatEffectCap(effect: TeacherBuffEffectRow): string {
  return `${formatNumber(effect.cap_value)}${effect.value_unit === 'GOLD' ? 'G' : '%p'}`;
}

function effectValueText(value: number, unit: string, direction: string): string {
  const sign = direction === 'REDUCTION' ? '-' : '+';
  return `${sign}${formatNumber(value)}${unit === 'GOLD' ? 'G' : '%p'}`;
}

function formatNumber(value: number): string {
  return Number(value).toLocaleString('ko-KR', { maximumFractionDigits: 2 });
}

function nullableText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

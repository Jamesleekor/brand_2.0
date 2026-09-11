import { useQuery } from '@tanstack/react-query';
import { Modal, LoadingSpinner, EmptyState } from '@/components/shared/components';
import { resolveAssetUrl } from '@/lib/assets/asset_urls';
import { supabase } from '@/lib/supabase/client';
import { getClassroomRankingV2CollectionDetail } from '@/lib/rpc/ranking_v2_rpc';
import { formatNumber } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';

type DetailMode = 'SHARDS' | 'COLLECTIONS';

export function RankingCollectionDetailModal({
  studentId,
  mode,
  onClose,
}: {
  studentId: number | null;
  mode: DetailMode;
  onClose: () => void;
}) {
  const query = useQuery({
    queryKey: ['ranking-v2-collection-detail', studentId],
    enabled: studentId !== null,
    staleTime: 30_000,
    queryFn: () => getClassroomRankingV2CollectionDetail(supabase, studentId!),
  });

  const data = query.data;
  const titleName = data?.student.brand_name || data?.student.name || '학생';

  return (
    <Modal
      isOpen={studentId !== null}
      onClose={onClose}
      title={`${titleName}의 ${mode === 'SHARDS' ? '편린 컬렉션' : '완성 콜렉션'}`}
      emoji={mode === 'SHARDS' ? '💎' : '📚'}
      size="full"
    >
      <div className="mx-auto w-full max-w-6xl">
        {query.isLoading ? (
          <div className="flex min-h-[280px] items-center justify-center"><LoadingSpinner size="lg" /></div>
        ) : query.isError ? (
          <div className="rounded-card-md border border-danger/30 bg-danger-bg p-4 text-sm font-bold text-danger">
            상세 수집 정보를 불러오지 못했습니다. 다시 열어주세요.
          </div>
        ) : !data ? (
          <EmptyState emoji="💎" title="수집 정보가 없어요" />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <SummaryCard label="보유 편린" value={`${formatNumber(data.summary.owned_count)}종`} />
              <SummaryCard label="한정판" value={`${formatNumber(data.summary.limited_count)} / ${formatNumber(data.summary.limited_total)}`} />
              <SummaryCard label="수집 가치" value={`${formatNumber(data.summary.collection_value)} 💎`} />
              <SummaryCard label="완성 콜렉션" value={`${formatNumber(data.summary.completed_collection_count)}개`} />
            </div>

            {mode === 'SHARDS' ? (
              <section className="mt-6">
                <div className="flex flex-wrap items-end justify-between gap-2">
                  <div>
                    <div className="text-[10px] font-black tracking-[0.18em] text-crystal-100">OWNED SHARDS</div>
                    <h3 className="mt-1 font-display text-xl font-black text-white">보유 편린 전체</h3>
                  </div>
                  <div className="text-xs font-bold text-text-muted">한정판 → 수집 가치 높은 순 → 이름순</div>
                </div>
                {data.characters.length === 0 ? (
                  <EmptyState emoji="🧩" title="아직 보유한 편린이 없어요" />
                ) : (
                  <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
                    {data.characters.map((character) => (
                      <CharacterCard key={character.character_id} character={character} />
                    ))}
                  </div>
                )}
              </section>
            ) : (
              <section className="mt-6">
                <div>
                  <div className="text-[10px] font-black tracking-[0.18em] text-bv-100">COMPLETED COLLECTIONS</div>
                  <h3 className="mt-1 font-display text-xl font-black text-white">완성한 콜렉션</h3>
                </div>
                {data.collections.length === 0 ? (
                  <EmptyState emoji="📚" title="아직 완성한 콜렉션이 없어요" />
                ) : (
                  <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {data.collections.map((collection, index) => (
                      <article key={collection.collection_id} className="rounded-card-md border border-line bg-bg-deep p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-[10px] font-black tracking-[0.12em] text-bv-100">{collection.collection_class}</div>
                            <div className="mt-1 truncate text-base font-black text-white">{collection.name}</div>
                          </div>
                          {index === 0 && <span className="shrink-0 rounded-pill border border-gold/25 bg-gold/10 px-2 py-1 text-[9px] font-black text-gold">최근 완성</span>}
                        </div>
                        {collection.description && <p className="mt-2 line-clamp-3 text-xs font-bold leading-5 text-text-secondary">{collection.description}</p>}
                        <div className="mt-3 border-t border-line pt-2 text-[11px] font-bold text-text-muted">
                          필요 편린 {formatNumber(collection.required_count)}종
                          {collection.completed_at && <> · {formatDate(collection.completed_at)} 완성</>}
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-card-md border border-line bg-bg-deep p-3 text-center">
      <div className="text-[10px] font-black text-text-muted sm:text-xs">{label}</div>
      <div className="mt-1 font-display text-lg font-black text-white sm:text-xl">{value}</div>
    </div>
  );
}

function CharacterCard({ character }: { character: Awaited<ReturnType<typeof getClassroomRankingV2CollectionDetail>>['characters'][number] }) {
  const imageUrl = getCharacterImageUrl(character);
  return (
    <article className={cn('overflow-hidden rounded-card-md border bg-bg-card', character.is_limited ? 'border-gold/45 shadow-[0_0_18px_rgba(255,217,61,0.08)]' : 'border-line')}>
      <div className="relative aspect-square bg-bg-deep p-2">
        {imageUrl ? (
          <img src={imageUrl} alt={character.name} className="h-full w-full object-contain" loading="lazy" />
        ) : character.emoji ? (
          <div className="flex h-full w-full items-center justify-center text-4xl">{character.emoji}</div>
        ) : (
          <div className="flex h-full w-full items-center justify-center font-display text-2xl font-black text-text-muted">{character.name.slice(0, 1)}</div>
        )}
        {character.is_limited && <span className="absolute right-1.5 top-1.5 rounded-pill border border-gold/35 bg-bg-deep/90 px-1.5 py-0.5 text-[8px] font-black text-gold">EVENT</span>}
      </div>
      <div className="p-2.5">
        <div className="truncate text-xs font-black text-white sm:text-sm">{character.name}</div>
        <div className={cn('mt-1 text-[10px] font-black', character.is_limited ? 'text-gold' : 'text-crystal-100')}>
          {character.is_limited ? '한정판 · 가치 0' : `${formatNumber(character.collection_value)} 💎`}
        </div>
      </div>
    </article>
  );
}

function getCharacterImageUrl(character: Awaited<ReturnType<typeof getClassroomRankingV2CollectionDetail>>['characters'][number]) {
  if (character.resource_kind === 'EMOJI') return null;
  const raw = character.avatar_image_url || character.card_image_url || character.resource_url || character.full_image_url;
  return raw ? resolveAssetUrl(raw, 'character') : null;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' });
}

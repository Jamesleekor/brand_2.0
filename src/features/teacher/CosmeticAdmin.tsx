// =====================================================================
// B.R.A.N.D 2.0 — 교사 꾸미기 관리
// 2026-09-17
// =====================================================================

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { EmptyState, LoadingSpinner, useRpcCall } from '@/components/shared/components';
import { TeacherShell } from '@/components/teacher/TeacherShell';
import { FontPreview } from '@/features/font/FontPreview';
import { isTeacherOnlyFont } from '@/features/font/fontCatalog';
import { supabase } from '@/lib/supabase/client';
import type { RpcResult } from '@/lib/rpc/student_rpc';
import { useClassroomId } from '@/stores/auth_store';
import { resolveAssetUrl } from '@/lib/assets/asset_urls';
import { formatNumber } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';

type CosmeticCategory = 'background' | 'font' | 'effect';
type CategoryFilter = 'ALL' | CosmeticCategory;

interface CosmeticAdminItem {
  item_id: number;
  item_uid: string;
  category: CosmeticCategory;
  name: string;
  description: string | null;
  resource_url: string | null;
  is_active: boolean;
  owned_count: number;
}

interface CosmeticAdminStudent {
  student_id: number;
  name: string;
  brand_name: string | null;
}

interface CosmeticAdminOwnership {
  ownership_id: number;
  student_id: number;
  item_id: number;
  is_equipped: boolean;
  obtained_via: string | null;
}

interface CosmeticAdminPricing {
  item_id: number;
  value_token: string;
  price: number;
}

interface CosmeticAdminBoard {
  items: CosmeticAdminItem[];
  students: CosmeticAdminStudent[];
  ownerships: CosmeticAdminOwnership[];
  pricings: CosmeticAdminPricing[];
}

const CATEGORIES: { value: CategoryFilter; label: string; emoji: string }[] = [
  { value: 'ALL', label: '전체', emoji: '🎨' },
  { value: 'background', label: '배경/CG', emoji: '🌄' },
  { value: 'font', label: '폰트', emoji: '🔤' },
  { value: 'effect', label: '효과', emoji: '✨' },
];

async function rpcResult<T>(
  name: 'teacher_get_cosmetic_grant_board' | 'teacher_grant_cosmetic_item' | 'teacher_revoke_cosmetic_item',
  params: Record<string, unknown>,
): Promise<RpcResult<T>> {
  const { data, error } = await supabase.rpc(name as any, params as any);
  if (error) return { success: false, type: 'SERVER', error: error.message, code: error.code };
  return { success: true, data: data as T };
}

function categoryMeta(category: CosmeticCategory) {
  return CATEGORIES.find((entry) => entry.value === category) ?? CATEGORIES[0];
}

function formatPricing(pricing: CosmeticAdminPricing): string {
  const icon = pricing.value_token === 'CRYSTAL'
    ? '💎'
    : pricing.value_token === 'GOLD'
      ? '🪙'
      : pricing.value_token === 'BV'
        ? '⭐'
        : '◈';
  return `${icon} ${formatNumber(pricing.price)} ${pricing.value_token}`;
}

export default function CosmeticAdmin() {
  const classroomId = useClassroomId();
  const queryClient = useQueryClient();
  const { call, isLoading: isMutating } = useRpcCall();

  const [category, setCategory] = useState<CategoryFilter>('ALL');
  const [itemSearch, setItemSearch] = useState('');
  const [studentSearch, setStudentSearch] = useState('');
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null);

  const query = useQuery<CosmeticAdminBoard>({
    queryKey: ['teacher-cosmetic-grant-board', classroomId],
    enabled: classroomId !== null,
    queryFn: async () => {
      if (!classroomId) throw new Error('학급 정보를 찾을 수 없습니다.');

      const result = await rpcResult<Omit<CosmeticAdminBoard, 'pricings'>>('teacher_get_cosmetic_grant_board', {
        p_classroom_id: classroomId,
      });
      if (result.success === false) throw new Error(result.error);

      const itemIds = result.data.items.map((item) => item.item_id);
      let pricings: CosmeticAdminPricing[] = [];

      if (itemIds.length > 0) {
        const { data: pricingRows, error: pricingError } = await supabase
          .from('cosmetic_item_pricings')
          .select('item_id,value_token,price,is_active')
          .in('item_id', itemIds)
          .eq('is_active', true);

        if (!pricingError) {
          pricings = (pricingRows ?? []).map((row: any) => ({
            item_id: Number(row.item_id),
            value_token: String(row.value_token ?? ''),
            price: Number(row.price ?? 0),
          }));
        }
      }

      return { ...result.data, pricings };
    },
  });

  const filteredItems = useMemo(() => {
    const needle = itemSearch.trim().toLocaleLowerCase('ko-KR');
    return (query.data?.items ?? []).filter((item) => {
      if (category !== 'ALL' && item.category !== category) return false;
      if (!needle) return true;
      return [item.name, item.item_uid, item.description]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase('ko-KR').includes(needle));
    });
  }, [category, itemSearch, query.data?.items]);

  const selectedItem = useMemo(() => {
    if (filteredItems.length === 0) return null;
    return filteredItems.find((item) => item.item_id === selectedItemId) ?? filteredItems[0];
  }, [filteredItems, selectedItemId]);

  const pricingByItem = useMemo(() => {
    const map = new Map<number, CosmeticAdminPricing[]>();
    for (const pricing of query.data?.pricings ?? []) {
      const list = map.get(pricing.item_id) ?? [];
      list.push(pricing);
      map.set(pricing.item_id, list);
    }
    return map;
  }, [query.data?.pricings]);

  const ownershipByStudent = useMemo(() => {
    const map = new Map<number, CosmeticAdminOwnership>();
    if (!selectedItem) return map;
    for (const ownership of query.data?.ownerships ?? []) {
      if (ownership.item_id === selectedItem.item_id) {
        map.set(ownership.student_id, ownership);
      }
    }
    return map;
  }, [query.data?.ownerships, selectedItem]);

  const studentRows = useMemo(() => {
    const needle = studentSearch.trim().toLocaleLowerCase('ko-KR');
    return (query.data?.students ?? []).filter((student) => {
      if (!needle) return true;
      return [student.name, student.brand_name]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase('ko-KR').includes(needle));
    });
  }, [query.data?.students, studentSearch]);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['teacher-cosmetic-grant-board', classroomId] });
  };

  const grant = async (student: CosmeticAdminStudent) => {
    if (!classroomId || !selectedItem) return;
    await call(
      () => rpcResult('teacher_grant_cosmetic_item', {
        p_classroom_id: classroomId,
        p_student_id: student.student_id,
        p_item_id: selectedItem.item_id,
      }),
      {
        successTitle: `${student.name}에게 ${selectedItem.name} 지급 완료`,
        onSuccess: () => void refresh(),
      },
    );
  };

  const revoke = async (student: CosmeticAdminStudent, ownership: CosmeticAdminOwnership) => {
    if (!classroomId || !selectedItem) return;
    const warning = ownership.is_equipped
      ? `${student.name} 학생이 현재 "${selectedItem.name}"을(를) 장착 중입니다.\n그래도 회수할까요?`
      : `${student.name} 학생에게서 "${selectedItem.name}"을(를) 회수할까요?`;
    if (!confirm(warning)) return;

    await call(
      () => rpcResult('teacher_revoke_cosmetic_item', {
        p_classroom_id: classroomId,
        p_student_id: student.student_id,
        p_item_id: selectedItem.item_id,
      }),
      {
        successTitle: `${student.name}의 ${selectedItem.name}을(를) 회수했습니다`,
        onSuccess: () => void refresh(),
      },
    );
  };

  if (!classroomId) {
    return <TeacherShell><EmptyState emoji="🎨" title="학급 정보를 찾을 수 없습니다" /></TeacherShell>;
  }

  if (query.isLoading) {
    return (
      <TeacherShell>
        <div className="flex min-h-[520px] items-center justify-center">
          <LoadingSpinner size="lg" />
        </div>
      </TeacherShell>
    );
  }

  if (query.isError || !query.data) {
    return (
      <TeacherShell>
        <div className="rounded-card-lg border border-danger/40 bg-danger-bg p-6">
          <h1 className="font-display text-xl text-white">꾸미기 관리 데이터를 불러오지 못했습니다</h1>
          <p className="mt-2 break-all text-sm text-text-primary">
            {query.error instanceof Error ? query.error.message : '알 수 없는 오류'}
          </p>
          <button type="button" onClick={() => void query.refetch()} className="btn-secondary mt-4">
            다시 불러오기
          </button>
        </div>
      </TeacherShell>
    );
  }

  const totalOwned = selectedItem
    ? query.data.ownerships.filter((ownership) => ownership.item_id === selectedItem.item_id).length
    : 0;

  return (
    <TeacherShell>
      <div className="space-y-5 pb-8">
        <div>
          <div className="text-[10px] font-black uppercase tracking-[0.2em] text-crystal">COSMETIC · TEACHER MANAGEMENT</div>
          <h1 className="mt-1 font-display text-2xl text-white">🎨 꾸미기 관리</h1>
          <p className="mt-1 max-w-3xl text-sm font-bold leading-relaxed text-text-secondary">
            일반 시장과 분리된 배경/CG · 폰트 · 효과의 보유 현황을 확인하고 학생별로 직접 지급하거나 회수합니다.
          </p>
        </div>

        <section className="rounded-card-lg border border-line bg-bg-card p-3">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {CATEGORIES.map((entry) => (
                <button
                  key={entry.value}
                  type="button"
                  onClick={() => setCategory(entry.value)}
                  className={cn(
                    'flex-shrink-0 rounded-pill border px-3 py-2 text-xs font-black transition-all',
                    category === entry.value
                      ? 'border-brand-primary/50 bg-brand-primary/20 text-white'
                      : 'border-line bg-bg-deep text-text-secondary hover:text-white',
                  )}
                >
                  {entry.emoji} {entry.label}
                </button>
              ))}
            </div>
            <input
              value={itemSearch}
              onChange={(event) => setItemSearch(event.target.value)}
              placeholder="꾸미기 아이템 검색"
              className="w-full rounded-card-md border border-line bg-bg-deep px-3 py-2.5 text-sm font-bold text-white outline-none focus:border-brand-primary/60 xl:w-80"
            />
          </div>
        </section>

        {filteredItems.length === 0 ? (
          <div className="rounded-card-lg border border-line bg-bg-card">
            <EmptyState emoji="🎨" title="이 조건에 맞는 꾸미기 아이템이 없습니다" />
          </div>
        ) : (
          <div className="grid gap-4 xl:grid-cols-[360px_1fr]">
            <section className="space-y-2 rounded-card-lg border border-line bg-bg-card p-3">
              <div className="mb-1 flex items-center justify-between px-1">
                <h2 className="font-display text-lg text-white">꾸미기 목록</h2>
                <span className="text-[10px] font-black text-text-muted">{filteredItems.length}개</span>
              </div>

              <div className="max-h-[720px] space-y-2 overflow-y-auto pr-1">
                {filteredItems.map((item) => {
                  const meta = categoryMeta(item.category);
                  const teacherOnly = isTeacherOnlyFont(item.item_uid);
                  const itemPricings = pricingByItem.get(item.item_id) ?? [];
                  const selected = selectedItem?.item_id === item.item_id;

                  return (
                    <button
                      key={item.item_id}
                      type="button"
                      onClick={() => setSelectedItemId(item.item_id)}
                      className={cn(
                        'w-full rounded-card-md border p-3 text-left transition-all',
                        selected
                          ? 'border-brand-primary/60 bg-brand-primary/10'
                          : 'border-line bg-bg-deep hover:border-brand-primary/30',
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-[10px] font-black text-text-muted">{meta.emoji} {meta.label}</div>
                          <div className="mt-0.5 truncate text-sm font-black text-white">{item.name}</div>
                          <div className="mt-1 truncate text-[9px] font-bold text-text-muted">{item.item_uid}</div>
                        </div>
                        <span className={cn(
                          'shrink-0 rounded-pill border px-2 py-1 text-[9px] font-black',
                          item.is_active
                            ? 'border-success/40 bg-success-bg text-success'
                            : 'border-warning/40 bg-warning/10 text-warning',
                        )}>
                          {item.is_active ? '활성' : '비활성'}
                        </span>
                      </div>

                      <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] font-black">
                        <span className="rounded-pill border border-line bg-bg-card px-2 py-1 text-text-secondary">
                          보유 {item.owned_count}명
                        </span>
                        {teacherOnly ? (
                          <span className="rounded-pill border border-danger/35 bg-danger-bg px-2 py-1 text-danger">
                            교사 지급 전용
                          </span>
                        ) : itemPricings.length > 0 ? (
                          itemPricings.slice(0, 2).map((pricing) => (
                            <span key={`${pricing.item_id}-${pricing.value_token}-${pricing.price}`} className="rounded-pill border border-crystal/25 bg-crystal/5 px-2 py-1 text-crystal">
                              {formatPricing(pricing)}
                            </span>
                          ))
                        ) : (
                          <span className="rounded-pill border border-line bg-bg-card px-2 py-1 text-text-muted">
                            가격 미설정
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>

            {selectedItem && (
              <div className="space-y-4">
                <section className="rounded-card-lg border border-crystal/25 bg-bg-card p-4">
                  <div className="grid gap-4 md:grid-cols-[220px_1fr] md:items-center">
                    <div className="overflow-hidden rounded-card-md border border-line bg-bg-deep">
                      {selectedItem.category === 'font' ? (
                        <div className="flex h-36 flex-col justify-center p-4">
                          <div className="font-system text-[9px] font-black uppercase tracking-[0.15em] text-text-muted">FONT PREVIEW</div>
                          <FontPreview
                            itemUid={selectedItem.item_uid}
                            className="mt-3 block break-keep text-center text-xl leading-relaxed text-white"
                          />
                        </div>
                      ) : selectedItem.resource_url ? (
                        <img
                          src={resolveAssetUrl(selectedItem.resource_url, selectedItem.category as any)}
                          alt={selectedItem.name}
                          className="h-44 w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-36 items-center justify-center text-5xl">
                          {categoryMeta(selectedItem.category).emoji}
                        </div>
                      )}
                    </div>

                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="font-display text-xl text-white">{selectedItem.name}</h2>
                        <span className="rounded-pill border border-line bg-bg-deep px-2.5 py-1 text-[10px] font-black text-text-secondary">
                          {categoryMeta(selectedItem.category).label}
                        </span>
                        <span className={cn(
                          'rounded-pill border px-2.5 py-1 text-[10px] font-black',
                          selectedItem.is_active
                            ? 'border-success/40 bg-success-bg text-success'
                            : 'border-warning/40 bg-warning/10 text-warning',
                        )}>
                          {selectedItem.is_active ? '학생 상점 공개 중' : '학생 상점 비공개'}
                        </span>
                      </div>

                      <p className="mt-2 text-sm font-bold leading-relaxed text-text-secondary">
                        {selectedItem.description || '설명이 등록되지 않은 꾸미기 아이템입니다.'}
                      </p>

                      <div className="mt-3 flex flex-wrap gap-2 text-xs font-black">
                        <span className="rounded-pill border border-line bg-bg-deep px-3 py-1.5 text-text-secondary">
                          보유 {totalOwned}명
                        </span>
                        <span className="rounded-pill border border-line bg-bg-deep px-3 py-1.5 text-text-secondary">
                          미보유 {Math.max(0, query.data.students.length - totalOwned)}명
                        </span>
                        {isTeacherOnlyFont(selectedItem.item_uid) ? (
                          <span className="rounded-pill border border-danger/40 bg-danger-bg px-3 py-1.5 text-danger">
                            품절 · 교사 지급 전용
                          </span>
                        ) : (
                          <span className="rounded-pill border border-crystal/30 bg-crystal/5 px-3 py-1.5 text-crystal">
                            {(pricingByItem.get(selectedItem.item_id) ?? []).length > 0
                              ? (pricingByItem.get(selectedItem.item_id) ?? []).map(formatPricing).join(' · ')
                              : '가격 정보 없음'}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </section>

                <section className="rounded-card-lg border border-line bg-bg-card p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h2 className="font-display text-lg text-white">학생별 지급 현황</h2>
                      <p className="mt-1 text-xs font-bold text-text-secondary">
                        보유 중인 학생은 회수할 수 있고, 미보유 학생은 즉시 지급할 수 있습니다.
                      </p>
                    </div>
                    <input
                      value={studentSearch}
                      onChange={(event) => setStudentSearch(event.target.value)}
                      placeholder="학생 이름 검색"
                      className="w-full rounded-card-md border border-line bg-bg-deep px-3 py-2.5 text-sm font-bold text-white outline-none focus:border-brand-primary/60 sm:w-64"
                    />
                  </div>

                  <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                    {studentRows.map((student) => {
                      const ownership = ownershipByStudent.get(student.student_id) ?? null;
                      return (
                        <div key={student.student_id} className="flex items-center justify-between gap-3 rounded-card-md border border-line bg-bg-deep p-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-black text-white">{student.name}</div>
                            <div className="mt-0.5 truncate text-[10px] font-bold text-text-muted">
                              {student.brand_name || '브랜드명 미설정'}
                            </div>
                            {ownership?.is_equipped && (
                              <div className="mt-1 text-[10px] font-black text-crystal">현재 장착 중</div>
                            )}
                            {ownership && (
                              <div className="mt-0.5 text-[9px] font-bold text-text-muted">
                                {ownership.obtained_via || '획득 경로 미상'}
                              </div>
                            )}
                          </div>

                          {ownership ? (
                            <button
                              type="button"
                              disabled={isMutating}
                              onClick={() => void revoke(student, ownership)}
                              className="shrink-0 rounded-pill border border-success/40 bg-success-bg px-3 py-1.5 text-xs font-black text-success disabled:opacity-50"
                            >
                              보유 · 회수
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={isMutating}
                              onClick={() => void grant(student)}
                              className="shrink-0 rounded-pill border border-crystal/40 bg-crystal/10 px-3 py-1.5 text-xs font-black text-crystal disabled:opacity-50"
                            >
                              지급하기
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
              </div>
            )}
          </div>
        )}
      </div>
    </TeacherShell>
  );
}

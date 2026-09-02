import { useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { EmptyState, LoadingSpinner, Modal, useRpcCall } from '@/components/shared/components';
import { StatCard, TeacherShell } from '@/components/teacher/TeacherShell';
import {
  inventoryMarketRpc,
  type TeacherMarketBoard,
  type TeacherMarketItem,
} from '@/lib/rpc/inventory_market_rpc';
import type { MarketItemType, MarketPricingMode, MarketUseMode } from '@/lib/zod_schemas/inventory_market_schemas';
import { supabase } from '@/lib/supabase/client';
import { useClassroomId } from '@/stores/auth_store';
import { resolveAssetUrl } from '@/lib/assets/asset_urls';
import { formatNumber } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';
import { randomBoxRpc, type TeacherRandomBoxManualReward } from '@/lib/rpc/random_box_rpc';

const TYPE_META: Record<MarketItemType, { label: string; emoji: string }> = {
  SNACK: { label: '간식', emoji: '🍪' },
  CONSUMABLE: { label: '꾸미기 아이템', emoji: '🎨' },
  TICKET: { label: '이용권', emoji: '🎟️' },
  AUCTION_PASS: { label: '경매 아이템', emoji: '⚡' },
  SPECIAL: { label: '특별 아이템', emoji: '🎁' },
};

const USE_META: Record<MarketUseMode, string> = {
  BAKERY_FULFILLMENT: '제과점 수령',
  IMMEDIATE: '즉시 사용',
  AUCTION_SUPER_PASS: '경매 SUPER PASS',
  MANUAL: '수동 처리',
  NONE: '사용 없음',
};

type Filter = 'ALL' | 'ACTIVE' | 'ARCHIVED' | MarketItemType;

type GrantStudent = {
  id: number;
  name: string;
  brandName: string | null;
};

type ItemForm = {
  name: string;
  description: string;
  imageUrl: string;
  itemType: MarketItemType;
  useMode: MarketUseMode;
  pricingMode: MarketPricingMode;
  basePrice: string;
  baseStock: string;
  currentStock: string;
  weeklyLimit: string;
  maxMultiplier: string;
  curveExponent: string;
  isSellable: boolean;
  isUsable: boolean;
  isActive: boolean;
  isArchived: boolean;
};

export default function MarketInventoryAdmin() {
  const classroomId = useClassroomId();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Filter>('ALL');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<TeacherMarketItem | 'NEW' | null>(null);
  const [granting, setGranting] = useState<TeacherMarketItem | null>(null);
  const [manualReward, setManualReward] = useState<TeacherRandomBoxManualReward | null>(null);

  const query = useQuery<TeacherMarketBoard>({
    queryKey: ['inventory-market-teacher-board', classroomId],
    queryFn: async () => {
      if (!classroomId) return { classroom_id: 0, items: [] };
      const result = await inventoryMarketRpc.teacherBoard(supabase, classroomId);
      if (result.success === false) throw new Error(result.error);
      return result.data;
    },
    enabled: classroomId !== null,
  });

  const randomBoxQueue = useQuery({
    queryKey: ['teacher-random-box-manual-rewards', classroomId],
    enabled: classroomId !== null,
    queryFn: async () => {
      if (!classroomId) return { classroom_id: 0, pending_count: 0, items: [] };
      const result = await randomBoxRpc.teacherManualBoard(supabase, classroomId);
      if (result.success === false) throw new Error(result.error);
      return result.data;
    },
    staleTime: 5_000,
    refetchInterval: 15_000,
  });

  const studentsQuery = useQuery<GrantStudent[]>({
    queryKey: ['inventory-market-grant-students', classroomId],
    enabled: classroomId !== null,
    queryFn: async () => {
      if (!classroomId) return [];
      const { data, error } = await supabase
        .from('students')
        .select('id,name,brand_name,role')
        .eq('classroom_id', classroomId)
        .in('role', ['STUDENT', 'STUDENT_LEADER', 'GUARD'])
        .is('transferred_at', null)
        .order('name', { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []).map((student) => ({
        id: Number(student.id),
        name: student.name,
        brandName: student.brand_name,
      }));
    },
    staleTime: 30_000,
  });

  const rows = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase('ko-KR');
    return (query.data?.items ?? []).filter((item) => {
      if (filter === 'ACTIVE' && (!item.is_active || item.is_archived)) return false;
      if (filter === 'ARCHIVED' && !item.is_archived) return false;
      if (filter !== 'ALL' && filter !== 'ACTIVE' && filter !== 'ARCHIVED' && item.item_type !== filter) return false;
      if (!needle) return true;
      return [item.name, item.description, TYPE_META[item.item_type].label, USE_META[item.use_mode]]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase('ko-KR').includes(needle));
    });
  }, [filter, query.data?.items, search]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['inventory-market-teacher-board'] });

  if (!classroomId) return <TeacherShell><EmptyState emoji="🏪" title="학급 정보를 찾을 수 없습니다" /></TeacherShell>;
  if (query.isError) return <TeacherShell><div className="rounded-card-lg border border-danger/40 bg-danger-bg p-6"><h1 className="font-display text-xl text-white">시장 운영 데이터를 불러오지 못했습니다</h1><p className="mt-2 break-all text-sm text-text-primary">{query.error instanceof Error ? query.error.message : '알 수 없는 오류'}</p><button type="button" onClick={() => void query.refetch()} className="btn-secondary mt-4">다시 불러오기</button></div></TeacherShell>;
  if (query.isLoading || !query.data) return <TeacherShell><div className="flex min-h-[520px] items-center justify-center"><LoadingSpinner size="lg" /></div></TeacherShell>;

  const active = query.data.items.filter((x) => x.is_active && !x.is_archived).length;
  const currentStock = query.data.items.filter((x) => !x.is_archived).reduce((sum, x) => sum + x.current_stock, 0);
  const owned = query.data.items.reduce((sum, x) => sum + x.inventory_owned_total, 0);
  const dynamic = query.data.items.filter((x) => x.pricing_mode === 'STOCK_DYNAMIC' && !x.is_archived).length;

  return (
    <TeacherShell>
      <div className="space-y-5 pb-8">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.2em] text-gold">Inventory + Market · I1-C</div>
            <h1 className="mt-1 font-display text-2xl text-white">🏪 시장 상품 운영</h1>
            <p className="mt-1 max-w-3xl text-sm font-bold leading-relaxed text-text-secondary">상품 이미지·종류·가격·재고·사용 방식과 시즌2 비선형 시세를 관리합니다. 화면의 삭제는 기록 보호를 위해 실제 DELETE가 아니라 보관(archive) 처리됩니다.</p>
          </div>
          <button type="button" onClick={() => setEditing('NEW')} className="btn-primary whitespace-nowrap">＋ 새 상품 추가</button>
        </div>

        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <StatCard emoji="🟢" label="판매 중" value={active} color="success" />
          <StatCard emoji="📦" label="현재 시장 재고" value={currentStock} color="gold" />
          <StatCard emoji="🎒" label="학생 인벤토리 보유" value={owned} color="crystal" />
          <StatCard emoji="📈" label="재고연동 시세" value={dynamic} color="bv" />
        </div>
        <div className="rounded-card-lg border border-gold/30 bg-gold/5 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-display text-lg text-amber-100">🎁 랜덤상자 수동 지급 대기</h2>
              <p className="mt-1 text-xs font-bold text-slate-300">편린 교환권·슈퍼패스 당첨만 표시됩니다. 실제 보상을 지급한 뒤 완료 처리하세요.</p>
            </div>
            <span className="rounded-pill border border-gold/35 bg-bg-deep px-3 py-1.5 text-xs font-black text-gold">대기 {randomBoxQueue.data?.pending_count ?? 0}건</span>
          </div>
          {randomBoxQueue.isError ? <div className="mt-3 text-xs font-bold text-warning">랜덤상자 대기 목록을 불러오지 못했습니다. 백엔드 POSTCHECK/배포 상태를 확인하세요.</div> : randomBoxQueue.isLoading ? <div className="mt-3"><LoadingSpinner size="sm" /></div> : (randomBoxQueue.data?.items ?? []).filter((row) => row.status === 'PENDING_MANUAL').length === 0 ? <div className="mt-3 rounded-card-md bg-bg-deep px-3 py-2 text-xs font-bold text-slate-400">현재 수동 지급 대기 보상이 없습니다.</div> : <div className="mt-3 grid gap-2 lg:grid-cols-2">{(randomBoxQueue.data?.items ?? []).filter((row) => row.status === 'PENDING_MANUAL').map((row) => <div key={row.opening_id} className="flex items-center justify-between gap-3 rounded-card-md border border-line bg-bg-deep p-3"><div className="min-w-0"><div className="font-black text-white">{row.student_name} · <span className="text-gold">{row.reward_label}</span></div><div className="mt-1 text-[10px] font-bold text-slate-400">당첨 {new Date(row.opened_at).toLocaleString('ko-KR')}</div></div><button type="button" onClick={() => setManualReward(row)} className="shrink-0 rounded-pill border border-success/40 bg-success-bg px-3 py-1.5 text-xs font-black text-success">지급 완료</button></div>)}</div>}
        </div>

        <div className="rounded-card-lg border border-line bg-bg-card p-3">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {(['ALL','ACTIVE','ARCHIVED','SNACK','CONSUMABLE','TICKET','AUCTION_PASS','SPECIAL'] as const).map((key) => (
                <button key={key} type="button" onClick={() => setFilter(key)} className={cn('flex-shrink-0 rounded-pill border px-3 py-2 text-xs font-black', filter === key ? 'border-brand-primary/50 bg-brand-primary/20 text-white' : 'border-line bg-bg-deep text-text-secondary')}>
                  {filterName(key)}
                </button>
              ))}
            </div>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="상품명 · 종류 · 사용방식 검색" className="w-full rounded-card-md border border-line bg-bg-deep px-3 py-2.5 text-sm font-bold text-white outline-none focus:border-brand-primary/60 xl:w-80" />
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="rounded-card-lg border border-line bg-bg-card"><EmptyState emoji="🏪" title="등록된 상품이 없습니다" description="새 상품 추가를 눌러 시즌2 시장을 구성하세요." /></div>
        ) : (
          <div className="grid gap-3 xl:grid-cols-2">
            {rows.map((item) => <AdminItemCard key={item.id} item={item} classroomId={classroomId} onEdit={() => setEditing(item)} onGrant={() => setGranting(item)} onRefresh={() => void refresh()} />)}
          </div>
        )}

        {editing && <MarketItemEditor classroomId={classroomId} item={editing === 'NEW' ? null : editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await refresh(); }} />}
        {manualReward && <RandomBoxManualRewardModal reward={manualReward} onClose={() => setManualReward(null)} onSaved={async () => { setManualReward(null); await queryClient.invalidateQueries({ queryKey: ['teacher-random-box-manual-rewards'] }); }} />}
        {granting && <InventoryGrantModal classroomId={classroomId} item={granting} students={studentsQuery.data ?? []} studentsLoading={studentsQuery.isLoading} studentsError={studentsQuery.isError ? (studentsQuery.error instanceof Error ? studentsQuery.error.message : '학생 목록을 불러오지 못했습니다.') : null} onClose={() => setGranting(null)} onSaved={async () => { setGranting(null); await refresh(); }} />}
      </div>
    </TeacherShell>
  );
}

function AdminItemCard({ item, classroomId, onEdit, onGrant, onRefresh }: { item: TeacherMarketItem; classroomId: number; onEdit: () => void; onGrant: () => void; onRefresh: () => void }) {
  const { call, isLoading } = useRpcCall();
  const rise = item.base_price_gold > 0 ? ((item.current_market_price_gold / item.base_price_gold) - 1) * 100 : 0;

  const adjust = async (delta: number) => {
    const result = await call(
      () => inventoryMarketRpc.teacherAdjustStock(supabase, { p_classroom_id: classroomId, p_item_id: item.id, p_delta: delta, p_reason: '교사 운영패널 빠른 재고 조정' }),
      { successTitle: `${item.name} 재고 ${delta > 0 ? '+' : ''}${delta}`, successDescription: '가격도 새 재고 기준으로 다시 계산됩니다.' },
    );
    if (result !== null) onRefresh();
  };

  const archive = async () => {
    if (!confirm(`${item.name}을 시장에서 삭제(보관)할까요?\n학생의 기존 인벤토리와 거래 기록은 유지됩니다.`)) return;
    await call(
      () => inventoryMarketRpc.teacherArchiveItem(supabase, { p_classroom_id: classroomId, p_item_id: item.id }),
      { successTitle: '상품을 보관했습니다' },
    );
    onRefresh();
  };

  return (
    <article className={cn('overflow-hidden rounded-card-lg border bg-bg-card', item.is_archived ? 'border-line opacity-65' : item.is_active ? 'border-line' : 'border-warning/35')}>
      <div className="flex min-h-[190px]">
        <div className="relative w-36 flex-shrink-0 bg-bg-deep sm:w-44">
          {item.image_url ? <img src={resolveAssetUrl(item.image_url, 'icon')} alt={item.name} className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center text-5xl">{TYPE_META[item.item_type].emoji}</div>}
          <div className="absolute left-2 top-2 rounded-pill bg-black/70 px-2 py-1 text-[10px] font-black text-white">{TYPE_META[item.item_type].emoji} {TYPE_META[item.item_type].label}</div>
          {item.is_archived && <div className="absolute inset-0 flex items-center justify-center bg-black/55"><span className="rounded-pill border border-white/20 bg-black/70 px-3 py-1 text-xs font-black text-white">보관됨</span></div>}
        </div>

        <div className="min-w-0 flex-1 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0"><h2 className="truncate text-base font-black text-white">{item.name}</h2><div className="mt-1 text-[10px] font-bold text-text-muted">{USE_META[item.use_mode]} · {item.pricing_mode === 'STOCK_DYNAMIC' ? `비선형 ×${Number(item.max_price_multiplier).toFixed(2)}` : '고정가'}</div></div>
            <span className={cn('rounded-pill px-2 py-1 text-[9px] font-black', item.is_archived ? 'bg-bg-deep text-text-muted' : item.is_active ? 'bg-success-bg text-success' : 'bg-warning-bg text-warning')}>{item.is_archived ? '보관' : item.is_active ? '판매중' : '판매중지'}</span>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <MiniStat label="기본가" value={`${formatNumber(item.base_price_gold)} G`} />
            <MiniStat label="현재가" value={`${formatNumber(item.current_market_price_gold)} G`} accent={rise > 0} />
            <MiniStat label="최고가" value={`${formatNumber(item.highest_price_gold)} G`} />
            <MiniStat label="재고" value={`${item.current_stock} / ${item.base_stock}`} />
          </div>

          <div className="mt-3 text-[10px] font-bold text-text-secondary">인벤토리 보유 {item.inventory_owned_total}개 · 보유 학생 {item.inventory_holder_count}명 · 기본가 대비 {rise >= 0 ? '+' : ''}{rise.toFixed(1)}%</div>

          <div className="mt-3 flex flex-wrap gap-1.5">
            <button type="button" disabled={isLoading || item.is_archived || item.current_stock < 5} onClick={() => void adjust(-5)} className="btn-secondary px-2.5 py-1.5 text-[10px]">-5</button>
            <button type="button" disabled={isLoading || item.is_archived || item.current_stock < 1} onClick={() => void adjust(-1)} className="btn-secondary px-2.5 py-1.5 text-[10px]">-1</button>
            <button type="button" disabled={isLoading || item.is_archived} onClick={() => void adjust(1)} className="btn-secondary px-2.5 py-1.5 text-[10px]">+1</button>
            <button type="button" disabled={isLoading || item.is_archived} onClick={() => void adjust(5)} className="btn-secondary px-2.5 py-1.5 text-[10px]">+5</button>
            <button type="button" disabled={isLoading} onClick={onGrant} className="rounded-pill border border-gold/40 bg-gold/10 px-3 py-1.5 text-[10px] font-black text-gold disabled:opacity-40">🎁 학생 지급</button>
            <button type="button" onClick={onEdit} className="btn-primary ml-auto px-3 py-1.5 text-[10px]">수정</button>
            {!item.is_archived && <button type="button" disabled={isLoading} onClick={() => void archive()} className="rounded-pill border border-danger/35 bg-danger-bg px-3 py-1.5 text-[10px] font-black text-danger">삭제(보관)</button>}
          </div>
        </div>
      </div>
    </article>
  );
}

function InventoryGrantModal({ classroomId, item, students, studentsLoading, studentsError, onClose, onSaved }: {
  classroomId: number;
  item: TeacherMarketItem;
  students: GrantStudent[];
  studentsLoading: boolean;
  studentsError: string | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const queryClient = useQueryClient();
  const { call, isLoading } = useRpcCall();
  const [studentId, setStudentId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [note, setNote] = useState('교사 운영패널 지급');
  const parsedQuantity = Number(quantity);
  const selected = students.find((student) => student.id === Number(studentId)) ?? null;
  const valid = !!selected && Number.isInteger(parsedQuantity) && parsedQuantity >= 1 && parsedQuantity <= 1000 && note.trim().length <= 500;

  const grant = async () => {
    if (!valid || !selected) return;
    const result = await call(
      () => inventoryMarketRpc.teacherGrantItem(supabase, {
        p_classroom_id: classroomId,
        p_student_id: selected.id,
        p_item_id: item.id,
        p_quantity: parsedQuantity,
        p_note: note.trim() || null,
      }),
      {
        successTitle: `${item.name} 지급 완료`,
        successDescription: `${selected.brandName || selected.name} · ${parsedQuantity}개`,
      },
    );
    if (result === null) return;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['inventory-market-teacher-board'] }),
      queryClient.invalidateQueries({ queryKey: ['inventory-my-bag'] }),
      queryClient.invalidateQueries({ queryKey: ['economy-history'] }),
    ]);
    await onSaved();
  };

  return (
    <Modal isOpen onClose={onClose} title="학생 인벤토리 지급" emoji="🎁">
      <div className="space-y-4">
        <div className="rounded-card-md border border-line bg-bg-deep p-3">
          <div className="text-[10px] font-black text-text-muted">지급 상품</div>
          <div className="mt-1 font-display text-base text-white">{TYPE_META[item.item_type].emoji} {item.name}</div>
          <div className="mt-1 text-xs text-text-secondary">교사 지급분은 구매가 환불 대상이 아닌 별도 지급 Lot으로 기록됩니다.</div>
        </div>

        {studentsError ? (
          <div className="rounded-card-md border border-danger/35 bg-danger-bg p-3 text-xs font-bold text-danger">{studentsError}</div>
        ) : (
          <Field label="학생 *">
            <select className="login-input" value={studentId} onChange={(e) => setStudentId(e.target.value)} disabled={studentsLoading || students.length === 0}>
              <option value="">{studentsLoading ? '학생 목록 불러오는 중…' : '학생을 선택하세요'}</option>
              {students.map((student) => <option key={student.id} value={student.id}>{student.name}{student.brandName ? ` · ${student.brandName}` : ''}</option>)}
            </select>
          </Field>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="지급 수량 (1~1000)"><input type="number" min={1} max={1000} className="login-input" value={quantity} onChange={(e) => setQuantity(e.target.value)} /></Field>
          <Field label="지급 메모"><input maxLength={500} className="login-input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        </div>

        <div className="rounded-card-sm border border-warning/25 bg-warning-bg p-2.5 text-[11px] font-bold text-text-secondary">시장 재고와 학생 GOLD는 변하지 않고, 선택한 학생의 인벤토리 보유수량만 증가합니다.</div>
        <button type="button" disabled={isLoading || !valid} onClick={() => void grant()} className="btn-primary w-full disabled:opacity-40">{isLoading ? '지급 중…' : '지급 확정'}</button>
      </div>
    </Modal>
  );
}

function RandomBoxManualRewardModal({ reward, onClose, onSaved }: { reward: TeacherRandomBoxManualReward; onClose: () => void; onSaved: () => Promise<void> }) {
  const { call, isLoading } = useRpcCall();
  const [note, setNote] = useState('');

  const complete = async () => {
    const result = await call(
      () => randomBoxRpc.teacherMarkDelivered(supabase, reward.opening_id, note),
      { successTitle: '랜덤상자 수동 보상을 지급 완료 처리했습니다' },
    );
    if (result) await onSaved();
  };

  return <Modal isOpen onClose={onClose} title="랜덤상자 수동 보상 지급" emoji="🎁">
    <div className="space-y-4">
      <div className="rounded-card-md border border-gold/30 bg-gold/5 p-3">
        <div className="font-black text-white">{reward.student_name}</div>
        <div className="mt-1 font-display text-lg text-gold">{reward.reward_label}</div>
        <div className="mt-2 text-xs font-bold leading-relaxed text-slate-300">이 버튼은 보상 자체를 자동 지급하지 않습니다. 학생에게 선택한 편린 또는 슈퍼패스를 실제로 지급한 뒤 완료 처리하세요.</div>
      </div>
      <Field label="지급 메모 (권장)"><input maxLength={500} className="login-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="예: CHAR-052 지급 / 급식 슈퍼패스 지급" /></Field>
      <button type="button" disabled={isLoading} onClick={() => void complete()} className="btn-primary w-full disabled:opacity-40">{isLoading ? '처리 중…' : '실제 지급 완료로 표시'}</button>
    </div>
  </Modal>;
}

function MiniStat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return <div className="rounded-card-sm border border-line bg-bg-deep px-2 py-2"><div className="text-[9px] font-black text-text-muted">{label}</div><div className={cn('mt-0.5 truncate font-mono text-xs font-black text-white', accent && 'text-gold')}>{value}</div></div>;
}

function MarketItemEditor({ classroomId, item, onClose, onSaved }: { classroomId: number; item: TeacherMarketItem | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const { call, isLoading } = useRpcCall();
  const [form, setForm] = useState<ItemForm>(() => item ? formFromItem(item) : blankForm());
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    const basePrice = Number(form.basePrice);
    const baseStock = Number(form.baseStock);
    const currentStock = Number(form.currentStock);
    const weeklyLimit = form.weeklyLimit.trim() ? Number(form.weeklyLimit) : null;
    const maxMultiplier = Number(form.maxMultiplier);
    const curveExponent = Number(form.curveExponent);

    if (!form.name.trim()) return setError('아이템 이름을 입력해주세요.');
    if (!Number.isInteger(basePrice) || basePrice < 1) return setError('기본 가격은 1 GOLD 이상의 정수여야 합니다.');
    if (!Number.isInteger(baseStock) || baseStock < 1) return setError('기준 재고는 1개 이상의 정수여야 합니다.');
    if (!Number.isInteger(currentStock) || currentStock < 0) return setError('현재 재고는 0개 이상의 정수여야 합니다.');
    if (weeklyLimit !== null && (!Number.isInteger(weeklyLimit) || weeklyLimit < 1)) return setError('주간 구매 제한은 1개 이상 또는 비워두기여야 합니다.');
    if (!(maxMultiplier >= 1 && maxMultiplier <= 1.5)) return setError('최대 가격 배율은 1.00~1.50 범위여야 합니다.');
    if (!(curveExponent > 0 && curveExponent <= 10)) return setError('가격곡선 지수는 0 초과 10 이하여야 합니다.');

    const result = await call(
      () => inventoryMarketRpc.teacherSaveItem(supabase, {
        p_classroom_id: classroomId,
        p_item_id: item?.id ?? null,
        p_payload: {
          name: form.name.trim(),
          description: form.description.trim() || null,
          image_url: form.imageUrl.trim() || null,
          item_type: form.itemType,
          use_mode: form.useMode,
          pricing_mode: form.pricingMode,
          base_price_gold: basePrice,
          base_stock: baseStock,
          current_stock: currentStock,
          weekly_purchase_limit: weeklyLimit,
          max_price_multiplier: maxMultiplier,
          curve_exponent: curveExponent,
          is_sellable: form.isSellable,
          is_usable: form.isUsable,
          is_active: form.isArchived ? false : form.isActive,
          is_archived: form.isArchived,
        },
      }),
      { successTitle: item ? '상품 설정을 저장했습니다' : '새 상품을 추가했습니다', onError: setError },
    );
    if (result !== null) await onSaved();
  };

  const changeType = (type: MarketItemType) => {
    setForm((prev) => {
      if (type === 'SNACK') return { ...prev, itemType: type, useMode: 'BAKERY_FULFILLMENT', isUsable: true };
      if (type === 'AUCTION_PASS') return { ...prev, itemType: type, useMode: 'AUCTION_SUPER_PASS', isUsable: true };
      return { ...prev, itemType: type };
    });
  };

  return (
    <Modal isOpen onClose={onClose} title={item ? '시장 상품 수정' : '새 시장 상품'} emoji="🏪" size="lg">
      <div className="space-y-5">
        {error && <div className="rounded-card-md border border-danger/40 bg-danger-bg px-3 py-2 text-xs font-bold text-danger">{error}</div>}

        <div className="grid gap-4 sm:grid-cols-[150px_1fr]">
          <div className="aspect-square overflow-hidden rounded-card-lg border border-line bg-bg-deep">
            {form.imageUrl.trim() ? <img src={resolveAssetUrl(form.imageUrl.trim(), 'icon')} alt="상품 미리보기" className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center text-6xl">{TYPE_META[form.itemType].emoji}</div>}
          </div>
          <div className="space-y-3">
            <Field label="상품 이름 *"><input className="login-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="예: 초코바" /></Field>
            <Field label="이미지 URL / asset 경로"><input className="login-input" value={form.imageUrl} onChange={(e) => setForm({ ...form, imageUrl: e.target.value })} placeholder="https://... 또는 /assets/..." /></Field>
            <Field label="설명"><textarea className="login-input min-h-20 resize-y" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="학생에게 보일 아이템 설명" /></Field>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="아이템 종류"><select className="login-input" value={form.itemType} onChange={(e) => changeType(e.target.value as MarketItemType)}>{Object.entries(TYPE_META).map(([value, meta]) => <option key={value} value={value}>{meta.emoji} {meta.label}</option>)}</select></Field>
          <Field label="사용 방식"><select className="login-input" value={form.useMode} onChange={(e) => setForm({ ...form, useMode: e.target.value as MarketUseMode })}>{Object.entries(USE_META).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
          <Field label="가격 방식"><select className="login-input" value={form.pricingMode} onChange={(e) => setForm({ ...form, pricingMode: e.target.value as MarketPricingMode })}><option value="STOCK_DYNAMIC">재고연동 비선형</option><option value="FIXED">고정 가격</option></select></Field>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="기본 가격"><input type="number" min={1} className="login-input" value={form.basePrice} onChange={(e) => setForm({ ...form, basePrice: e.target.value })} /></Field>
          <Field label="기준 재고"><input type="number" min={1} className="login-input" value={form.baseStock} onChange={(e) => setForm({ ...form, baseStock: e.target.value })} /></Field>
          <Field label="현재 재고"><input type="number" min={0} className="login-input" value={form.currentStock} onChange={(e) => setForm({ ...form, currentStock: e.target.value })} /></Field>
          <Field label="주간 구매 제한"><input type="number" min={1} className="login-input" value={form.weeklyLimit} onChange={(e) => setForm({ ...form, weeklyLimit: e.target.value })} placeholder="없음" /></Field>
        </div>

        <div className={cn('grid gap-3 rounded-card-md border border-line bg-bg-deep p-3 sm:grid-cols-2', form.pricingMode === 'FIXED' && 'opacity-55')}>
          <Field label="최대 가격 배율 (≤1.50)"><input disabled={form.pricingMode === 'FIXED'} type="number" min={1} max={1.5} step={0.05} className="login-input" value={form.maxMultiplier} onChange={(e) => setForm({ ...form, maxMultiplier: e.target.value })} /></Field>
          <Field label="비선형 곡선 지수"><input disabled={form.pricingMode === 'FIXED'} type="number" min={0.1} max={10} step={0.1} className="login-input" value={form.curveExponent} onChange={(e) => setForm({ ...form, curveExponent: e.target.value })} /></Field>
          <div className="sm:col-span-2 text-[10px] font-bold leading-relaxed text-text-muted">기본값 1.50 / 1.60. 재고가 충분할 때는 가격 변화가 작고, 품절에 가까워질수록 상승 속도가 빨라집니다.</div>
        </div>

        <div className="grid gap-2 sm:grid-cols-4">
          <Toggle checked={form.isSellable} onChange={(value) => setForm({ ...form, isSellable: value })} label="구매가 판매 가능" />
          <Toggle checked={form.isUsable} onChange={(value) => setForm({ ...form, isUsable: value })} label="사용 가능" />
          <Toggle checked={form.isActive} disabled={form.isArchived} onChange={(value) => setForm({ ...form, isActive: value })} label="시장 판매 활성" />
          <Toggle checked={!form.isArchived} onChange={(value) => setForm({ ...form, isArchived: !value, isActive: value ? true : false })} label="상품 유지(보관 해제)" />
        </div>

        {form.useMode === 'BAKERY_FULFILLMENT' && <div className="rounded-card-md border border-success/30 bg-success-bg p-3 text-xs font-bold text-text-secondary"><span className="font-black text-success">🍰 제과점 연동:</span> 학생이 사용하면 즉시 인벤토리에서 차감되고 수령 대기 기록이 생성됩니다. 제과점 운영 화면에서 수령 대기 목록을 확인하고 전달 완료 처리할 수 있습니다.</div>}
        {form.useMode === 'AUCTION_SUPER_PASS' && <div className="rounded-card-md border border-warning/30 bg-warning-bg p-3 text-xs font-bold text-text-secondary"><span className="font-black text-warning">⚡ SUPER PASS:</span> 학생 인벤토리의 일반 사용 버튼은 막히며, 경매 공개 후 SUPER PASS 신청 시 자동 예약됩니다. 낙찰자는 예약분이 소비되고, 비낙찰·취소 시 예약이 자동 해제됩니다.</div>}

        <button type="button" disabled={isLoading} onClick={() => void save()} className="btn-primary w-full disabled:opacity-40">{isLoading ? '저장 중…' : '저장'}</button>
      </div>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block"><span className="mb-1.5 block text-[10px] font-black text-text-muted">{label}</span>{children}</label>;
}

function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (value: boolean) => void; label: string; disabled?: boolean }) {
  return <button type="button" disabled={disabled} onClick={() => onChange(!checked)} className={cn('flex items-center justify-between gap-2 rounded-card-md border px-3 py-2.5 text-left text-xs font-black disabled:opacity-40', checked ? 'border-success/35 bg-success-bg text-success' : 'border-line bg-bg-deep text-text-secondary')}><span>{label}</span><span>{checked ? 'ON' : 'OFF'}</span></button>;
}

function blankForm(): ItemForm {
  return {
    name: '', description: '', imageUrl: '', itemType: 'SNACK', useMode: 'BAKERY_FULFILLMENT', pricingMode: 'STOCK_DYNAMIC',
    basePrice: '100', baseStock: '20', currentStock: '20', weeklyLimit: '', maxMultiplier: '1.5', curveExponent: '1.6',
    isSellable: true, isUsable: true, isActive: true, isArchived: false,
  };
}

function formFromItem(item: TeacherMarketItem): ItemForm {
  return {
    name: item.name,
    description: item.description ?? '',
    imageUrl: item.image_url ?? '',
    itemType: item.item_type,
    useMode: item.use_mode,
    pricingMode: item.pricing_mode,
    basePrice: String(item.base_price_gold),
    baseStock: String(item.base_stock),
    currentStock: String(item.current_stock),
    weeklyLimit: item.weekly_purchase_limit === null ? '' : String(item.weekly_purchase_limit),
    maxMultiplier: String(item.max_price_multiplier),
    curveExponent: String(item.curve_exponent),
    isSellable: item.is_sellable,
    isUsable: item.is_usable,
    isActive: item.is_active,
    isArchived: item.is_archived,
  };
}

function filterName(filter: Filter) {
  if (filter === 'ALL') return '전체';
  if (filter === 'ACTIVE') return '판매 중';
  if (filter === 'ARCHIVED') return '보관';
  return `${TYPE_META[filter].emoji} ${TYPE_META[filter].label}`;
}

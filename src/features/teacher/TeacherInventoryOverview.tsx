import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { EmptyState, LoadingSpinner } from '@/components/shared/components';
import { supabase } from '@/lib/supabase/client';
import type { TeacherMarketItem } from '@/lib/rpc/inventory_market_rpc';
import type { MarketItemType } from '@/lib/zod_schemas/inventory_market_schemas';
import type { StudentInventoryAdminStudent } from './StudentInventoryAdminModal';

type InventoryRow = {
  student_id: number;
  item_id: number;
  owned_quantity: number;
  reserved_quantity: number;
};
type Product = Pick<TeacherMarketItem, 'id' | 'name' | 'item_type' | 'is_archived'>;
type OverviewStudent = StudentInventoryAdminStudent & { isTestAccount?: boolean };
type CategoryFilter = 'ALL' | MarketItemType;

type Props = {
  classroomId: number;
  students: OverviewStudent[];
  studentsLoading: boolean;
  studentsError: string | null;
  items: TeacherMarketItem[];
};

const CATEGORY: { key: CategoryFilter; label: string }[] = [
  { key: 'ALL', label: '전체 종류' },
  { key: 'SNACK', label: '🍪 간식' },
  { key: 'CONSUMABLE', label: '🎨 꾸미기' },
  { key: 'TICKET', label: '🎟️ 이용권' },
  { key: 'AUCTION_PASS', label: '⚡ 경매 아이템' },
  { key: 'SPECIAL', label: '🎁 특별 아이템' },
];

const quantity = (row?: InventoryRow) => Number(row?.owned_quantity ?? 0);
const reserved = (row?: InventoryRow) => Number(row?.reserved_quantity ?? 0);
const keyFor = (studentId: number, itemId: number) => `${studentId}:${itemId}`;

/** 교사 전용 현황판. DB에서 읽기만 수행하며, 기존 학생/아이템 RLS가 학급 범위를 제한합니다. */
export default function TeacherInventoryOverview({ classroomId, students, studentsLoading, studentsError, items }: Props) {
  const [studentSearch, setStudentSearch] = useState('');
  const [itemSearch, setItemSearch] = useState('');
  const [studentId, setStudentId] = useState('ALL');
  const [category, setCategory] = useState<CategoryFilter>('ALL');
  const [includeArchived, setIncludeArchived] = useState(true);
  const [showEmptyItems, setShowEmptyItems] = useState(false);
  const [heldStudentsOnly, setHeldStudentsOnly] = useState(false);
  const [includeTestAccounts, setIncludeTestAccounts] = useState(false);
  const [view, setView] = useState<'MATRIX' | 'LIST'>('MATRIX');

  const inventoryQuery = useQuery<InventoryRow[]>({
    queryKey: ['teacher-inventory-overview', classroomId],
    enabled: classroomId > 0,
    staleTime: 15_000,
    refetchInterval: 30_000,
    queryFn: async () => {
      const result: InventoryRow[] = [];
      const pageSize = 500; // Supabase/PostgREST 기본 응답 행 수 제한을 넘겨도 전수 조회
      for (let offset = 0; ; offset += pageSize) {
        const { data, error } = await supabase
          .from('student_inventory')
          .select('id,student_id,item_id,owned_quantity,reserved_quantity')
          .eq('classroom_id', classroomId)
          .gt('owned_quantity', 0)
          .order('id', { ascending: true })
          .range(offset, offset + pageSize - 1);
        if (error) throw new Error(`통합 인벤토리 조회 실패: ${error.message}`);
        const page = data ?? [];
        for (const row of page) {
          result.push({
            student_id: Number(row.student_id),
            item_id: Number(row.item_id),
            owned_quantity: Number(row.owned_quantity),
            reserved_quantity: Number(row.reserved_quantity),
          });
        }
        if (page.length < pageSize) break;
        if (offset >= 100_000) throw new Error('인벤토리 조회 범위가 너무 큽니다. 관리자에게 문의하세요.');
      }
      return result;
    },
  });

  const model = useMemo(() => {
    const rows = inventoryQuery.data ?? [];
    const byKey = new Map<string, InventoryRow>();
    for (const row of rows) byKey.set(keyFor(row.student_id, row.item_id), row);

    // 보관된 상품도 보유할 수 있으므로 신규 판매 목록에 없더라도 누락하지 않습니다.
    const byProduct = new Map<number, Product>(items.map((item) => [item.id, item]));
    for (const row of rows) {
      if (!byProduct.has(row.item_id)) {
        byProduct.set(row.item_id, {
          id: row.item_id, name: `상품 #${row.item_id} (정보 없음)`, item_type: 'SPECIAL', is_archived: true,
        });
      }
    }

    const nameNeedle = studentSearch.trim().toLocaleLowerCase('ko-KR');
    const chosenStudents = students.filter((student) =>
      (includeTestAccounts || !student.isTestAccount) &&
      (studentId === 'ALL' || String(student.id) === studentId) &&
      (!nameNeedle || `${student.name} ${student.brandName ?? ''}`.toLocaleLowerCase('ko-KR').includes(nameNeedle)),
    );
    const itemNeedle = itemSearch.trim().toLocaleLowerCase('ko-KR');
    const candidates = [...byProduct.values()].filter((item) =>
      (category === 'ALL' || item.item_type === category) &&
      (includeArchived || !item.is_archived) &&
      (!itemNeedle || item.name.toLocaleLowerCase('ko-KR').includes(itemNeedle)),
    ).sort((a, b) => a.name.localeCompare(b.name, 'ko-KR'));

    const visibleItems = showEmptyItems ? candidates : candidates.filter((item) =>
      chosenStudents.some((student) => quantity(byKey.get(keyFor(student.id, item.id))) > 0),
    );
    const chosenRows = chosenStudents.map((student) => {
      const total = visibleItems.reduce((sum, item) => sum + quantity(byKey.get(keyFor(student.id, item.id))), 0);
      return { student, total };
    }).filter((row) => !heldStudentsOnly || row.total > 0);
    const totalQuantity = chosenRows.reduce((sum, row) => sum + row.total, 0);
    const reservedQuantity = chosenRows.reduce((sum, row) =>
      sum + visibleItems.reduce((subtotal, item) => subtotal + reserved(byKey.get(keyFor(row.student.id, item.id))), 0), 0);
    const holders = chosenRows.filter((row) => row.total > 0).length;
    const itemTotals = new Map(visibleItems.map((item) => [item.id,
      chosenRows.reduce((sum, row) => sum + quantity(byKey.get(keyFor(row.student.id, item.id))), 0),
    ]));
    const detail = chosenRows.flatMap(({ student }) => visibleItems.flatMap((item) => {
      const row = byKey.get(keyFor(student.id, item.id));
      return quantity(row) > 0 ? [{ student, item, owned: quantity(row), pending: reserved(row) }] : [];
    }));
    return { byKey, visibleItems, chosenRows, totalQuantity, reservedQuantity, holders, itemTotals, detail };
  }, [inventoryQuery.data, students, studentSearch, studentId, itemSearch, category, includeArchived, showEmptyItems, heldStudentsOnly, includeTestAccounts]);

  const exportCsv = () => {
    const columns = ['학생', '브랜드명', ...model.visibleItems.map((item) => item.name), '총수량'];
    const lines = [columns, ...model.chosenRows.map(({ student, total }) => [
      student.name, student.brandName ?? '',
      ...model.visibleItems.map((item) => String(quantity(model.byKey.get(keyFor(student.id, item.id))))),
      String(total),
    ])];
    const escapeCsv = (cell: string) => `"${cell.replace(/"/g, '""')}"`;
    const csv = '\uFEFF' + lines.map((line) => line.map((cell) => escapeCsv(String(cell))).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    const now = new Date();
    const fileDate = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
    anchor.download = `BRAND_인벤토리_전체현황_${fileDate}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="space-y-4 rounded-card-lg border border-gold/30 bg-bg-card p-4" aria-label="전체 학생 인벤토리 현황">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl text-white">📊 전체 학생 인벤토리 현황</h2>
          <p className="mt-1 text-xs font-bold leading-relaxed text-amber-100">읽기 전용 · 현재 재학 중인 학생의 간식/아이템 보유량 · 예약 수량은 보유량에 포함 · 테스트 계정 기본 제외</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void inventoryQuery.refetch()} disabled={inventoryQuery.isFetching} className="btn-secondary text-xs">↻ 새로고침</button>
          <button type="button" onClick={exportCsv} disabled={!inventoryQuery.data || studentsLoading} className="btn-secondary text-xs">⬇ CSV 내보내기</button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Summary label="표시 학생" value={`${model.chosenRows.length}명`} />
        <Summary label="보유 학생" value={`${model.holders}명`} />
        <Summary label="보유 품목" value={`${model.visibleItems.filter((item) => (model.itemTotals.get(item.id) ?? 0) > 0).length}종`} />
        <Summary label="전체 보유 수량" value={`${model.totalQuantity.toLocaleString('ko-KR')}개`} extra={`이 중 예약 ${model.reservedQuantity.toLocaleString('ko-KR')}개`} />
      </div>

      <div className="grid gap-3 rounded-card-md border border-line bg-bg-deep p-3 md:grid-cols-2 xl:grid-cols-4">
        <label className="space-y-1 text-xs font-black text-amber-100">
          <span>학생 이름 검색</span>
          <input className="login-input w-full" placeholder="학생명 또는 브랜드명" value={studentSearch} onChange={(e) => setStudentSearch(e.target.value)} />
        </label>
        <label className="space-y-1 text-xs font-black text-amber-100">
          <span>학생 선택</span>
          <select className="login-input w-full" value={studentId} onChange={(e) => setStudentId(e.target.value)}>
            <option value="ALL">전체 학생</option>
            {students.map((student) => <option key={student.id} value={student.id}>{student.name}{student.brandName ? ` (${student.brandName})` : ''}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-xs font-black text-amber-100">
          <span>상품 검색</span>
          <input className="login-input w-full" placeholder="간식 또는 아이템명" value={itemSearch} onChange={(e) => setItemSearch(e.target.value)} />
        </label>
        <label className="space-y-1 text-xs font-black text-amber-100">
          <span>상품 유형</span>
          <select className="login-input w-full" value={category} onChange={(e) => setCategory(e.target.value as CategoryFilter)}>
            {CATEGORY.map((type) => <option key={type.key} value={type.key}>{type.label}</option>)}
          </select>
        </label>
        <div className="flex flex-wrap gap-4 text-xs font-bold text-white md:col-span-2 xl:col-span-4">
          <label className="flex items-center gap-2"><input type="checkbox" checked={includeArchived} onChange={(e) => setIncludeArchived(e.target.checked)} />보관된 상품 포함</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={showEmptyItems} onChange={(e) => setShowEmptyItems(e.target.checked)} />보유량 0인 상품 표시</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={includeTestAccounts} onChange={(e) => setIncludeTestAccounts(e.target.checked)} />테스트 계정 포함</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={heldStudentsOnly} onChange={(e) => setHeldStudentsOnly(e.target.checked)} />보유 학생만 표시</label>
          <button type="button" onClick={() => { setStudentSearch(''); setItemSearch(''); setStudentId('ALL'); setCategory('ALL'); setIncludeArchived(true); setShowEmptyItems(false); setHeldStudentsOnly(false); setIncludeTestAccounts(false); }} className="rounded-pill border border-line px-3 py-1 font-black text-amber-100">필터 초기화</button>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-2">
          <button type="button" onClick={() => setView('MATRIX')} className={view === 'MATRIX' ? 'btn-primary text-xs' : 'btn-secondary text-xs'}>▦ 학생 × 상품</button>
          <button type="button" onClick={() => setView('LIST')} className={view === 'LIST' ? 'btn-primary text-xs' : 'btn-secondary text-xs'}>☷ 보유 내역</button>
        </div>
        <span className="text-xs font-bold text-amber-100">상품 {model.visibleItems.length}개 · 학생 {model.chosenRows.length}명</span>
      </div>

      {studentsError ? (
        <ErrorPanel error={studentsError} />
      ) : studentsLoading || inventoryQuery.isLoading ? (
        <div className="flex min-h-52 items-center justify-center"><LoadingSpinner size="lg" /></div>
      ) : inventoryQuery.isError ? (
        <div className="space-y-2"><ErrorPanel error={inventoryQuery.error instanceof Error ? inventoryQuery.error.message : '인벤토리 조회 중 오류가 발생했습니다.'} /><button type="button" onClick={() => void inventoryQuery.refetch()} className="btn-secondary">다시 시도</button></div>
      ) : model.chosenRows.length === 0 || model.visibleItems.length === 0 ? (
        <EmptyState emoji="🎒" title="해당하는 보유 내역이 없습니다" description="학생/상품 필터 또는 보유량 0인 상품 표시 옵션을 확인하세요." />
      ) : view === 'MATRIX' ? (
        <div className="max-h-[62vh] overflow-auto rounded-card-md border border-line" tabIndex={0} aria-label="학생별 상품 수량표 (가로 스크롤 가능)">
          <table className="min-w-max border-separate border-spacing-0 text-xs">
            <thead>
              <tr>
                <th scope="col" className="sticky left-0 top-0 z-30 w-36 min-w-36 border-b border-r border-line bg-bg-deep px-3 py-3 text-left font-black text-white">학생</th>
                <th scope="col" className="sticky left-36 top-0 z-30 min-w-16 border-b border-r border-line bg-bg-deep px-3 py-3 text-center font-black text-gold">합계</th>
                {model.visibleItems.map((item) => (
                  <th key={item.id} scope="col" title={item.name} className="sticky top-0 z-20 w-32 max-w-32 border-b border-r border-line bg-bg-deep px-2 py-2 text-center align-bottom font-black text-amber-100">
                    <div className="break-words leading-tight">{item.name}</div>
                    <div className="mt-1 text-[10px] text-gold">합계 {(model.itemTotals.get(item.id) ?? 0).toLocaleString('ko-KR')}</div>
                    {item.is_archived && <div className="mt-1 text-[10px] text-amber-200">보관</div>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {model.chosenRows.map(({ student, total }, index) => (
                <tr key={student.id} className={index % 2 === 0 ? 'bg-bg-card' : 'bg-bg-deep'}>
                  <th scope="row" className="sticky left-0 z-10 w-36 min-w-36 border-b border-r border-line bg-bg-card px-3 py-2 text-left font-black text-white">
                    <span className="block">{student.name}</span>
                    {student.brandName && <span className="block truncate text-[10px] font-bold text-amber-100">{student.brandName}</span>}
                  </th>
                  <td className="sticky left-36 z-10 border-b border-r border-line bg-bg-card px-3 py-2 text-center font-black text-gold">{total}</td>
                  {model.visibleItems.map((item) => {
                    const row = model.byKey.get(keyFor(student.id, item.id));
                    const count = quantity(row);
                    const pending = reserved(row);
                    return <td key={item.id} title={`${student.name} · ${item.name}: 보유 ${count}개, 예약 ${pending}개, 사용 가능 ${Math.max(0, count - pending)}개`} className={`border-b border-r border-line px-3 py-2 text-center font-black ${count > 0 ? 'bg-gold/10 text-gold' : 'text-amber-100/70'}`}>
                      {count > 0 ? <><span>{count}</span>{pending > 0 && <span className="block text-[10px] text-amber-100">예약 {pending}</span>}</> : '–'}
                    </td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="max-h-[62vh] overflow-auto rounded-card-md border border-line">
          <table className="w-full min-w-[640px] text-left text-xs">
            <thead className="sticky top-0 bg-bg-deep text-amber-100"><tr><th className="px-3 py-3">학생</th><th className="px-3 py-3">상품</th><th className="px-3 py-3 text-center">보유</th><th className="px-3 py-3 text-center">예약</th><th className="px-3 py-3 text-center">사용 가능</th></tr></thead>
            <tbody>{model.detail.map(({ student, item, owned, pending }) => (
              <tr key={`${student.id}-${item.id}`} className="border-t border-line text-white"><td className="px-3 py-2 font-black">{student.name}</td><td className="px-3 py-2">{item.name}{item.is_archived ? ' · 보관' : ''}</td><td className="px-3 py-2 text-center font-black text-gold">{owned}</td><td className="px-3 py-2 text-center">{pending}</td><td className="px-3 py-2 text-center">{Math.max(0, owned - pending)}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <p className="text-[11px] font-bold text-amber-100">이 현황은 시장 인벤토리의 현재 보유 수량을 기준으로 하며, 구매/사용 내역을 누적 합산하지 않습니다. 수량 변경은 기존 ‘학생 인벤토리’ 관리에서 진행하세요.</p>
    </section>
  );
}

function Summary({ label, value, extra }: { label: string; value: string; extra?: string }) {
  return <div className="rounded-card-md border border-line bg-bg-deep p-3"><div className="text-xs font-bold text-amber-100">{label}</div><div className="mt-1 text-xl font-black text-white">{value}</div>{extra && <div className="mt-1 text-xs font-bold text-gold">{extra}</div>}</div>;
}

function ErrorPanel({ error }: { error: string }) {
  return <div role="alert" className="rounded-card-md border border-danger/40 bg-danger-bg p-3 text-xs font-bold text-white">{error}</div>;
}

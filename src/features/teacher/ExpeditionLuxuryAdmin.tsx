import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useRpcCall } from '@/components/shared/components';
import { supabase } from '@/lib/supabase/client';
import type { RpcResult } from '@/lib/rpc/student_rpc';

type Price = { id: number; value_token: string; price: number };
type Item = {
  item_id: number;
  item_uid: string;
  name: string;
  category: string;
  luxury_group: string;
  is_active: boolean;
  pricings: Price[];
};
type Student = { student_id: number; name: string; brand_name: string | null };
type Ownership = { student_id: number; item_id: number; obtained_via: string };
type Board = { items: Item[]; students: Student[]; ownerships: Ownership[] };

async function rpc<T>(name: string, params: Record<string, unknown>): Promise<RpcResult<T>> {
  const { data, error } = await supabase.rpc(name as any, params as any);
  if (error) return { success: false, type: 'SERVER', error: error.message, code: error.code };
  return { success: true, data: data as T };
}

export function ExpeditionLuxuryAdmin({ classroomId }: { classroomId: number }) {
  const queryClient = useQueryClient();
  const { call, isLoading: busy } = useRpcCall();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [studentSearch, setStudentSearch] = useState('');
  const query = useQuery<Board>({
    queryKey: ['expedition-luxury-admin', classroomId],
    queryFn: async () => {
      const result = await rpc<Board>('teacher_get_expedition_luxury_admin_board', {
        p_classroom_id: classroomId,
      });
      if (result.success === false) throw new Error(result.error);
      return result.data;
    },
  });
  const items = query.data?.items ?? [];
  const selected = items.find((item) => item.item_id === selectedId) ?? items[0];
  const students = useMemo(() => (query.data?.students ?? []).filter((student) =>
    [student.name, student.brand_name].some((value) =>
      value?.toLocaleLowerCase('ko-KR').includes(studentSearch.trim().toLocaleLowerCase('ko-KR')))),
  [query.data?.students, studentSearch]);
  const owned = new Set((query.data?.ownerships ?? [])
    .filter((ownership) => ownership.item_id === selected?.item_id)
    .map((ownership) => ownership.student_id));
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['expedition-luxury-admin', classroomId] });
  };
  const savePrice = async (itemId: number, token: string, price: number) => {
    await call(() => rpc('teacher_set_cosmetic_price', {
      p_classroom_id: classroomId, p_item_id: itemId, p_value_token: token, p_price: price,
    }), { successTitle: '명품관 가격을 저장했습니다', onSuccess: () => void refresh() });
  };
  const resetPrice = async (itemId: number, pricingId: number | null) => {
    await call(() => rpc('teacher_reset_cosmetic_price', {
      p_classroom_id: classroomId, p_item_id: itemId, p_pricing_id: pricingId,
    }), { successTitle: pricingId === null ? '가격을 모두 초기화했습니다' : '가격 옵션을 삭제했습니다',
      onSuccess: () => void refresh() });
  };
  const grant = async (student: Student) => {
    if (!selected || owned.has(student.student_id)) return;
    await call(() => rpc('teacher_grant_expedition_luxury_item', {
      p_classroom_id: classroomId, p_item_id: selected.item_id, p_student_id: student.student_id,
    }), { successTitle: `${student.name}에게 ${selected.name} 지급 완료`,
      onSuccess: () => void refresh() });
  };

  return (
    <section className="rounded-card-xl border border-line bg-bg-card p-4">
      <h2 className="text-base font-black text-white">명품관 아이템 관리</h2>
      <p className="mt-1 text-xs font-bold text-text-secondary">
        가격 변경과 학생별 이벤트 지급을 관리합니다. 구매는 원정 명품관 개방 조건과 판매 기간을 만족할 때만 가능합니다.
      </p>
      <p className="mt-1 text-xs text-text-secondary">
        가격 옵션이 여러 개면 학생은 그중 하나를 선택해 구매합니다.
      </p>
      {query.isLoading && <p className="mt-4 text-sm text-text-secondary">명품관 목록을 불러오는 중…</p>}
      {query.isError && <div className="mt-4 text-sm text-danger">
        {query.error instanceof Error ? query.error.message : '명품관 목록을 불러오지 못했습니다.'}
        <button type="button" className="btn-secondary ml-2" onClick={() => void query.refetch()}>다시 시도</button>
      </div>}
      {selected && (
        <div className="mt-4 grid gap-4 lg:grid-cols-[230px_1fr]">
          <div className="max-h-96 space-y-2 overflow-y-auto">
            {items.map((item) => (
              <button type="button" key={item.item_id} onClick={() => setSelectedId(item.item_id)}
                className={`w-full rounded-card-md border p-3 text-left text-sm font-bold ${selected.item_id === item.item_id
                  ? 'border-brand-primary bg-brand-primary/10 text-white'
                  : 'border-line bg-bg-deep text-text-secondary'}`}>
                <span className="text-xs text-text-secondary">{item.luxury_group}등급</span>
                <span className="ml-2">{item.name}</span>
              </button>
            ))}
          </div>
          <div className="min-w-0 space-y-4">
            <div>
              <div className="font-black text-white">{selected.name}</div>
              <div className="text-xs text-text-secondary">
                {selected.item_uid} · 현재 가격: {selected.pricings.length
                  ? selected.pricings.map((price) => `${price.price.toLocaleString('ko-KR')} ${price.value_token}`).join(' · ')
                  : '미설정'}
              </div>
            </div>
            <LuxuryPriceEditor key={selected.item_id} item={selected}
              disabled={busy} onSave={savePrice} onReset={resetPrice} />
            <div className="border-t border-line pt-3">
              <h3 className="text-sm font-black text-white">학생별 지급</h3>
              <input value={studentSearch} onChange={(event) => setStudentSearch(event.target.value)}
                placeholder="학생 이름 검색"
                className="mt-2 w-full rounded-card-md border border-line bg-bg-deep px-3 py-2 text-sm text-white sm:w-72" />
              <div className="mt-3 grid max-h-64 gap-2 overflow-y-auto md:grid-cols-2">
                {students.map((student) => (
                  <div key={student.student_id}
                    className="flex items-center justify-between gap-2 rounded-card-md border border-line bg-bg-deep p-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-bold text-white">{student.name}</div>
                      <div className="truncate text-xs text-text-secondary">{student.brand_name || '브랜드명 미설정'}</div>
                    </div>
                    <button type="button" disabled={busy || owned.has(student.student_id)}
                      onClick={() => void grant(student)}
                      className="btn-secondary shrink-0 disabled:opacity-50">
                      {owned.has(student.student_id) ? '보유 중' : '지급'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function LuxuryPriceEditor({ item, disabled, onSave, onReset }: {
  item: Item;
  disabled: boolean;
  onSave: (itemId: number, token: string, price: number) => Promise<void>;
  onReset: (itemId: number, pricingId: number | null) => Promise<void>;
}) {
  const [token, setToken] = useState(item.pricings[0]?.value_token ?? 'GOLD');
  const [price, setPrice] = useState(item.pricings[0]?.price?.toString() ?? '');
  return (
    <div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs font-bold text-text-secondary">화폐
          <select value={token} onChange={(event) => {
            const next = event.target.value;
            setToken(next);
            setPrice(item.pricings.find((entry) => entry.value_token === next)?.price?.toString() ?? '');
          }} className="mt-1 block rounded-card-md border border-line bg-bg-deep px-3 py-2 text-white">
            <option value="GOLD">GOLD</option><option value="BV">BV</option>
            <option value="CRYSTAL">CRYSTAL</option>
          </select>
        </label>
        <label className="text-xs font-bold text-text-secondary">가격
          <input type="number" min="1" max="100000000" step="1" value={price}
            onChange={(event) => setPrice(event.target.value)}
            className="mt-1 block w-40 rounded-card-md border border-line bg-bg-deep px-3 py-2 text-white" />
        </label>
        <button type="button" className="btn-secondary"
          disabled={disabled || !Number.isInteger(Number(price)) || Number(price) < 1}
          onClick={() => void onSave(item.item_id, token, Number(price))}>가격 저장</button>
      </div>
      {item.pricings.length > 0 && (
        <div className="mt-4 space-y-2 border-t border-line pt-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-black text-white">현재 구매 옵션</span>
            <button type="button" disabled={disabled}
              onClick={() => {
                if (confirm(`"${item.name}"의 모든 가격 옵션을 초기화할까요?`)) {
                  void onReset(item.item_id, null).then(() => setPrice(''));
                }
              }}
              className="text-xs font-black text-danger disabled:opacity-50">전체 가격 초기화</button>
          </div>
          <div className="flex flex-wrap gap-2">
            {item.pricings.map((entry) => (
              <div key={entry.id}
                className="flex items-center gap-2 rounded-card-md border border-line bg-bg-deep px-3 py-2 text-xs text-text-primary">
                <span>{entry.price.toLocaleString('ko-KR')} {entry.value_token}</span>
                <button type="button" disabled={disabled}
                  onClick={() => void onReset(item.item_id, entry.id).then(() => {
                    if (token === entry.value_token) setPrice('');
                  })}
                  className="font-black text-danger disabled:opacity-50"
                  aria-label={`${entry.value_token} 가격 옵션 삭제`}>삭제</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { EmptyState, LoadingSpinner, Modal, useRpcCall } from '@/components/shared/components';
import {
  inventoryMarketRpc,
  type TeacherStudentInventoryBoard,
  type TeacherStudentInventoryItem,
} from '@/lib/rpc/inventory_market_rpc';
import { supabase } from '@/lib/supabase/client';
import { resolveAssetUrl } from '@/lib/assets/asset_urls';

export interface StudentInventoryAdminStudent {
  id: number;
  name: string;
  brandName: string | null;
}

interface StudentInventoryAdminModalProps {
  classroomId: number;
  students: StudentInventoryAdminStudent[];
  studentsLoading: boolean;
  studentsError: string | null;
  onClose: () => void;
}

export function StudentInventoryAdminModal({
  classroomId,
  students,
  studentsLoading,
  studentsError,
  onClose,
}: StudentInventoryAdminModalProps) {
  const [studentId, setStudentId] = useState('');
  const [revoking, setRevoking] = useState<{ item: TeacherStudentInventoryItem; restoreStock: boolean } | null>(null);
  const selectedStudentId = Number(studentId) || null;

  const inventoryQuery = useQuery<TeacherStudentInventoryBoard>({
    queryKey: ['teacher-student-inventory', classroomId, selectedStudentId],
    enabled: selectedStudentId !== null,
    queryFn: async () => {
      if (!selectedStudentId) throw new Error('학생을 선택해주세요.');
      const result = await inventoryMarketRpc.teacherStudentInventory(supabase, {
        p_classroom_id: classroomId,
        p_student_id: selectedStudentId,
      });
      if (result.success === false) throw new Error(result.error);
      return result.data;
    },
  });

  return (
    <>
      <Modal isOpen onClose={onClose} title="학생 인벤토리 관리" emoji="🎒" size="lg">
        <div className="space-y-4">
          <div className="rounded-card-md border border-warning/30 bg-warning-bg p-3 text-xs font-bold leading-relaxed text-text-secondary">
            <div className="font-black text-warning">교사 강제 회수/삭제</div>
            <div className="mt-1">예약 중인 수량은 안전을 위해 건드리지 않습니다. <b className="text-white">회수 → 재고</b>는 학생에게서 제거한 뒤 시장 재고를 복원하고, <b className="text-white">삭제</b>는 학생 인벤토리에서만 제거합니다.</div>
          </div>

          {studentsError ? (
            <div className="rounded-card-md border border-danger/35 bg-danger-bg p-3 text-xs font-bold text-danger">{studentsError}</div>
          ) : (
            <label className="block">
              <span className="mb-1.5 block text-[10px] font-black text-text-muted">학생 선택</span>
              <select
                value={studentId}
                onChange={(event) => setStudentId(event.target.value)}
                disabled={studentsLoading || students.length === 0}
                className="login-input"
              >
                <option value="">{studentsLoading ? '학생 목록 불러오는 중…' : '학생을 선택하세요'}</option>
                {students.map((student) => (
                  <option key={student.id} value={student.id}>
                    {student.name}{student.brandName ? ` · ${student.brandName}` : ''}
                  </option>
                ))}
              </select>
            </label>
          )}

          {!selectedStudentId ? (
            <div className="rounded-card-lg border border-line bg-bg-deep">
              <EmptyState emoji="👤" title="학생을 선택하세요" description="선택한 학생이 현재 보유한 인벤토리 물품만 표시됩니다." />
            </div>
          ) : inventoryQuery.isLoading ? (
            <div className="flex min-h-48 items-center justify-center"><LoadingSpinner size="lg" /></div>
          ) : inventoryQuery.isError ? (
            <div className="rounded-card-md border border-danger/35 bg-danger-bg p-3 text-xs font-bold text-danger">
              {inventoryQuery.error instanceof Error ? inventoryQuery.error.message : '인벤토리를 불러오지 못했습니다.'}
            </div>
          ) : (inventoryQuery.data?.items ?? []).length === 0 ? (
            <div className="rounded-card-lg border border-line bg-bg-deep">
              <EmptyState emoji="🎒" title="보유 물품이 없습니다" description="이 학생의 인벤토리는 현재 비어 있습니다." />
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {(inventoryQuery.data?.items ?? []).map((item) => (
                <TeacherInventoryItemCard
                  key={item.item_id}
                  item={item}
                  onRestore={() => setRevoking({ item, restoreStock: true })}
                  onDelete={() => setRevoking({ item, restoreStock: false })}
                />
              ))}
            </div>
          )}
        </div>
      </Modal>

      {revoking && selectedStudentId && (
        <TeacherInventoryRevokeModal
          classroomId={classroomId}
          studentId={selectedStudentId}
          studentName={inventoryQuery.data?.student.brand_name || inventoryQuery.data?.student.name || '선택 학생'}
          item={revoking.item}
          restoreStock={revoking.restoreStock}
          onClose={() => setRevoking(null)}
          onDone={async () => {
            setRevoking(null);
            await inventoryQuery.refetch();
          }}
        />
      )}
    </>
  );
}

function TeacherInventoryItemCard({
  item,
  onRestore,
  onDelete,
}: {
  item: TeacherStudentInventoryItem;
  onRestore: () => void;
  onDelete: () => void;
}) {
  const available = item.available_quantity;

  return (
    <div className="rounded-card-lg border border-line bg-bg-deep p-3">
      <div className="flex gap-3">
        <div className="h-16 w-16 flex-shrink-0 overflow-hidden rounded-card-md border border-line bg-bg-card">
          {item.image_url ? (
            <img src={resolveAssetUrl(item.image_url, 'icon')} alt={item.name} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-3xl">📦</div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-black text-white">{item.name}</div>
          <div className="mt-1 text-[10px] font-bold text-text-secondary">보유 {item.owned_quantity} · 예약 {item.reserved_quantity} · 회수 가능 {available}</div>
          <div className="mt-1 text-[10px] font-bold text-text-muted">현재 시장 재고 {item.current_stock}개</div>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={available < 1}
          onClick={onRestore}
          className="rounded-pill border border-success/40 bg-success-bg py-2 text-xs font-black text-success disabled:cursor-not-allowed disabled:opacity-35"
        >
          ↩ 회수 → 재고
        </button>
        <button
          type="button"
          disabled={available < 1}
          onClick={onDelete}
          className="rounded-pill border border-danger/40 bg-danger-bg py-2 text-xs font-black text-danger disabled:cursor-not-allowed disabled:opacity-35"
        >
          🗑 삭제
        </button>
      </div>
    </div>
  );
}

function TeacherInventoryRevokeModal({
  classroomId,
  studentId,
  studentName,
  item,
  restoreStock,
  onClose,
  onDone,
}: {
  classroomId: number;
  studentId: number;
  studentName: string;
  item: TeacherStudentInventoryItem;
  restoreStock: boolean;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const queryClient = useQueryClient();
  const { call, isLoading } = useRpcCall();
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState(restoreStock ? '교사 인벤토리 회수' : '잘못 지급된 물품 삭제');
  const maxQty = Math.max(0, item.available_quantity);

  const submit = async () => {
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > maxQty) return;
    const result = await call(
      () => inventoryMarketRpc.teacherRevokeItem(supabase, {
        p_classroom_id: classroomId,
        p_student_id: studentId,
        p_item_id: item.item_id,
        p_quantity: quantity,
        p_note: note.trim() || null,
        p_restore_stock: restoreStock,
      }),
      {
        successTitle: restoreStock ? `${item.name} 회수 완료` : `${item.name} 삭제 완료`,
        successDescription: restoreStock
          ? `${studentName}에게서 ${quantity}개를 회수하고 시장 재고에 ${quantity}개를 돌려놓았습니다.`
          : `${studentName}의 인벤토리에서 ${quantity}개를 제거했습니다. 시장 재고는 변하지 않습니다.`,
      },
    );
    if (!result) return;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['inventory-market-teacher-board'] }),
      queryClient.invalidateQueries({ queryKey: ['teacher-student-inventory'] }),
      queryClient.invalidateQueries({ queryKey: ['inventory-my-bag'] }),
      queryClient.invalidateQueries({ queryKey: ['inventory-item-history'] }),
      queryClient.invalidateQueries({ queryKey: ['economy-history'] }),
    ]);
    await onDone();
  };

  return (
    <Modal isOpen onClose={onClose} title={restoreStock ? '인벤토리 회수' : '인벤토리 삭제'} emoji={restoreStock ? '↩️' : '🗑️'}>
      <div className="space-y-4">
        <div className="rounded-card-md border border-line bg-bg-deep p-3">
          <div className="font-black text-white">{studentName} · {item.name}</div>
          <div className="mt-1 text-xs font-bold text-text-secondary">보유 {item.owned_quantity} · 예약 {item.reserved_quantity} · 처리 가능 {maxQty}</div>
        </div>

        <div className={restoreStock ? 'rounded-card-md border border-success/35 bg-success-bg p-3 text-xs font-bold text-text-secondary' : 'rounded-card-md border border-danger/35 bg-danger-bg p-3 text-xs font-bold text-text-secondary'}>
          {restoreStock
            ? `처리한 수량만큼 시장 재고가 다시 증가합니다. 현재 재고 ${item.current_stock} → ${item.current_stock + quantity}`
            : '시장 재고는 증가하지 않습니다. 과거에 재고 차감 없이 잘못 지급된 물품이나 완전히 삭제해야 하는 물품에 사용하세요.'}
        </div>

        <label className="block">
          <span className="mb-1.5 block text-[10px] font-black text-text-muted">수량 (최대 {maxQty})</span>
          <input
            type="number"
            min={1}
            max={maxQty}
            value={quantity}
            onChange={(event) => setQuantity(Math.max(1, Math.min(maxQty, Number(event.target.value) || 1)))}
            className="login-input"
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-[10px] font-black text-text-muted">처리 메모</span>
          <input value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} className="login-input" />
        </label>

        <button type="button" disabled={isLoading || maxQty < 1} onClick={() => void submit()} className="btn-primary w-full disabled:opacity-40">
          {isLoading ? '처리 중…' : restoreStock ? '회수 확정' : '삭제 확정'}
        </button>
      </div>
    </Modal>
  );
}

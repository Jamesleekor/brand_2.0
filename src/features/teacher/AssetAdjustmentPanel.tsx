import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  EmptyState,
  LoadingSpinner,
  Modal,
  useRpcCall,
} from '@/components/shared/components';
import { supabase } from '@/lib/supabase/client';
import { teacherRpc } from '@/lib/rpc/teacher_rpc';
import { formatNumber } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';

interface AssetStudent {
  id: number;
  name: string;
  brandName: string | null;
  cachedTier: string | null;
  gold: number;
  bv: number;
}

type AssetToken = 'BV' | 'GOLD' | 'BOTH';
type AdjustmentOperation = 'GRANT' | 'DEDUCT';

interface LastAdjustment {
  token: AssetToken;
  operation: AdjustmentOperation;
  amount?: number;
  bvAmount?: number;
  goldAmount?: number;
  reason: string;
  studentCount: number;
}

const isValidAmount = (value: number) => Number.isInteger(value) && value >= 1 && value <= 10_000_000;
const isValidNonNegativeAmount = (value: number) => Number.isInteger(value) && value >= 0 && value <= 10_000_000;

export function AssetAdjustmentPanel({ classroomId }: { classroomId: number | null }) {
  const queryClient = useQueryClient();
  const { call, isLoading: isSubmitting } = useRpcCall();
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [token, setToken] = useState<AssetToken>('BV');
  const [operation, setOperation] = useState<AdjustmentOperation>('GRANT');
  const [amountInput, setAmountInput] = useState('');
  const [bvAmountInput, setBvAmountInput] = useState('');
  const [goldAmountInput, setGoldAmountInput] = useState('');
  const [reason, setReason] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [lastAdjustment, setLastAdjustment] = useState<LastAdjustment | null>(null);

  const studentsQuery = useQuery<AssetStudent[]>({
    queryKey: ['teacher-asset-students', classroomId],
    queryFn: async () => {
      if (!classroomId) return [];

      const { data: studentRows, error: studentError } = await supabase
        .from('students')
        .select('id, name, brand_name, cached_tier, role')
        .eq('classroom_id', classroomId)
        .in('role', ['STUDENT', 'STUDENT_LEADER', 'GUARD'])
        .is('transferred_at', null)
        .order('name', { ascending: true });

      if (studentError) throw new Error(studentError.message);

      const studentIds = (studentRows ?? []).map((student) => Number(student.id));
      if (studentIds.length === 0) return [];

      const { data: walletRows, error: walletError } = await supabase
        .from('wallets')
        .select('student_id, gold, bv')
        .in('student_id', studentIds);

      if (walletError) throw new Error(walletError.message);

      const walletByStudentId = new Map(
        (walletRows ?? []).map((wallet) => [
          Number(wallet.student_id),
          { gold: Number(wallet.gold ?? 0), bv: Number(wallet.bv ?? 0) },
        ])
      );

      return (studentRows ?? []).map((student) => {
        const wallet = walletByStudentId.get(Number(student.id));
        return {
          id: Number(student.id),
          name: student.name,
          brandName: student.brand_name,
          cachedTier: student.cached_tier,
          gold: wallet?.gold ?? 0,
          bv: wallet?.bv ?? 0,
        };
      });
    },
    enabled: classroomId !== null,
    staleTime: 15_000,
  });

  const students = studentsQuery.data ?? [];
  const normalizedSearch = search.trim().toLocaleLowerCase('ko-KR');
  const visibleStudents = useMemo(() => {
    if (!normalizedSearch) return students;
    return students.filter((student) => {
      const haystack = `${student.name} ${student.brandName ?? ''} ${student.cachedTier ?? ''}`.toLocaleLowerCase('ko-KR');
      return haystack.includes(normalizedSearch);
    });
  }, [normalizedSearch, students]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedStudents = useMemo(
    () => students.filter((student) => selectedSet.has(student.id)),
    [selectedSet, students]
  );

  const amount = Number(amountInput);
  const bvAmount = Number(bvAmountInput || 0);
  const goldAmount = Number(goldAmountInput || 0);
  const validSingleAmount = isValidAmount(amount);
  const validCombinedAmount =
    isValidNonNegativeAmount(bvAmount) &&
    isValidNonNegativeAmount(goldAmount) &&
    (bvAmount > 0 || goldAmount > 0);
  const trimmedReason = reason.trim();
  const insufficientStudents = operation === 'DEDUCT' && token !== 'BOTH' && validSingleAmount
    ? selectedStudents.filter((student) => (token === 'BV' ? student.bv : student.gold) < amount)
    : [];

  const validAmount = token === 'BOTH' ? validCombinedAmount : validSingleAmount;
  const canOpenConfirm =
    selectedStudents.length > 0 &&
    validAmount &&
    trimmedReason.length >= 2 &&
    trimmedReason.length <= 200 &&
    insufficientStudents.length === 0 &&
    !isSubmitting;

  const allVisibleSelected =
    visibleStudents.length > 0 && visibleStudents.every((student) => selectedSet.has(student.id));

  const toggleStudent = (studentId: number) => {
    setSelectedIds((current) =>
      current.includes(studentId)
        ? current.filter((id) => id !== studentId)
        : [...current, studentId]
    );
  };

  const toggleAllVisible = () => {
    const visibleIds = visibleStudents.map((student) => student.id);
    setSelectedIds((current) => {
      const currentSet = new Set(current);
      if (visibleIds.every((id) => currentSet.has(id))) {
        return current.filter((id) => !visibleIds.includes(id));
      }
      visibleIds.forEach((id) => currentSet.add(id));
      return [...currentSet];
    });
  };

  const setTokenMode = (nextToken: AssetToken) => {
    setToken(nextToken);
    if (nextToken === 'BOTH') setOperation('GRANT');
  };

  const clearFormAfterSuccess = () => {
    setConfirmOpen(false);
    setSelectedIds([]);
    setAmountInput('');
    setBvAmountInput('');
    setGoldAmountInput('');
    setReason('');
  };

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['teacher-asset-students'] }),
      queryClient.invalidateQueries({ queryKey: ['teacher-dashboard'] }),
      queryClient.invalidateQueries({ queryKey: ['transactions'] }),
      queryClient.invalidateQueries({ queryKey: ['wallet'] }),
      queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
      queryClient.invalidateQueries({ queryKey: ['profile-detail'] }),
      queryClient.invalidateQueries({ queryKey: ['rankings'] }),
    ]);
  };

  const handleConfirm = async () => {
    if (!canOpenConfirm) return;

    if (token === 'BOTH') {
      const results = await call(
        () => teacherRpc.grantStudentAssetsCombined(supabase, {
          p_student_ids: selectedStudents.map((student) => student.id),
          p_bv_amount: bvAmount,
          p_gold_amount: goldAmount,
          p_reason: trimmedReason,
        }),
        {
          successTitle: 'BV + 골드 동시 지급 완료',
          successDescription: `${selectedStudents.length}명 · ${formatNumber(bvAmount)} BV + ${formatNumber(goldAmount)} 골드`,
        }
      );
      if (!results) return;
      setLastAdjustment({
        token: 'BOTH',
        operation: 'GRANT',
        bvAmount,
        goldAmount,
        reason: trimmedReason,
        studentCount: selectedStudents.length,
      });
    } else {
      const signedAmount = operation === 'GRANT' ? amount : -amount;
      const results = await call(
        () => teacherRpc.adjustStudentAssets(supabase, {
          p_student_ids: selectedStudents.map((student) => student.id),
          p_value_token: token,
          p_amount: signedAmount,
          p_reason: trimmedReason,
        }),
        {
          successTitle: operation === 'GRANT' ? '자산 지급 완료' : '자산 차감 완료',
          successDescription: `${selectedStudents.length}명 · ${formatNumber(amount)} ${token === 'BV' ? 'BV' : '골드'}`,
        }
      );
      if (!results) return;
      setLastAdjustment({
        token,
        operation,
        amount,
        reason: trimmedReason,
        studentCount: selectedStudents.length,
      });
    }

    clearFormAfterSuccess();
    await invalidate();
  };

  const totalSummary = token === 'BOTH'
    ? `+${formatNumber(bvAmount * selectedStudents.length)} BV · +${formatNumber(goldAmount * selectedStudents.length)} 골드`
    : `${operation === 'GRANT' ? '+' : '-'}${validSingleAmount ? formatNumber(amount * selectedStudents.length) : '0'} ${token === 'BV' ? 'BV' : '골드'}`;

  return (
    <section className="bg-bg-card backdrop-blur-card border border-line-brand rounded-card-lg overflow-hidden">
      <div className="p-4 border-b border-line bg-gradient-to-r from-brand-primary/10 via-transparent to-gold/10">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-display text-lg text-white tracking-tight flex items-center gap-2">
              <span>💳</span><span>학생 자산 지급·차감</span>
            </h2>
            <p className="text-xs text-text-secondary font-bold mt-1 break-keep">
              한 명 또는 여러 학생을 선택해 BV와 골드를 일괄 조정합니다. 모든 변경은 거래 기록에 남습니다.
            </p>
          </div>
          <div className="text-xs font-black text-text-secondary bg-bg-deep border border-line rounded-pill px-3 py-1.5 self-start sm:self-auto">
            선택 {selectedStudents.length}명 / 전체 {students.length}명
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.7fr)_minmax(330px,0.55fr)]">
        <div className="p-4 xl:border-r border-line">
          <div className="flex flex-col sm:flex-row gap-2 mb-3">
            <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="이름·브랜드명·티어 검색" className="login-input flex-1" />
            <div className="flex gap-2">
              <button type="button" onClick={toggleAllVisible} disabled={visibleStudents.length === 0} className="btn-secondary flex-1 sm:flex-none whitespace-nowrap">
                {allVisibleSelected ? '현재 목록 해제' : '현재 목록 전체 선택'}
              </button>
              <button type="button" onClick={() => setSelectedIds([])} disabled={selectedIds.length === 0} className="px-3 py-2 bg-bg-deep border border-line rounded-card-md text-xs font-extrabold text-text-secondary disabled:opacity-40">
                선택 초기화
              </button>
            </div>
          </div>

          {studentsQuery.isLoading ? (
            <div className="py-16 flex justify-center"><LoadingSpinner size="lg" /></div>
          ) : studentsQuery.isError ? (
            <div className="bg-danger-bg border border-danger/40 rounded-card-md p-4 text-sm text-danger font-bold">
              학생 자산을 불러오지 못했습니다: {studentsQuery.error instanceof Error ? studentsQuery.error.message : '알 수 없는 오류'}
            </div>
          ) : visibleStudents.length === 0 ? (
            <EmptyState emoji="🔍" title={students.length === 0 ? '활성 학생이 없습니다' : '검색 결과가 없습니다'} description={students.length === 0 ? '학급 학생과 지갑 데이터를 확인해주세요.' : '다른 이름이나 브랜드명으로 검색해보세요.'} />
          ) : (
            <div className="max-h-[540px] overflow-y-auto pr-1 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
              {visibleStudents.map((student) => {
                const selected = selectedSet.has(student.id);
                return (
                  <motion.button
                    type="button"
                    key={student.id}
                    whileTap={{ scale: 0.995 }}
                    onClick={() => toggleStudent(student.id)}
                    className={cn(
                      'w-full grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 p-3 rounded-card-md border text-left transition-all',
                      selected ? 'bg-brand-primary/15 border-brand-primary/60 shadow-bv-sm' : 'bg-bg-deep border-line hover:border-line-strong'
                    )}
                  >
                    <span className={cn('w-5 h-5 rounded-card-sm border flex items-center justify-center text-2xs font-black', selected ? 'bg-brand-primary border-brand-primary text-white' : 'bg-bg-card border-line-strong text-transparent')} aria-hidden>✓</span>
                    <span className="min-w-0">
                      <span className="block text-sm font-black text-text-primary truncate">
                        {student.name}{student.brandName ? ` (${student.brandName})` : ''}
                      </span>
                      <span className="block text-xs text-text-secondary font-bold truncate mt-0.5">
                        {student.cachedTier || '티어 정보 없음'}
                      </span>
                    </span>
                    <span className="text-right min-w-[92px]">
                      <span className="block text-xs font-black text-bv">⭐ {formatNumber(student.bv)} BV</span>
                      <span className="block text-xs font-black text-gold mt-0.5">🪙 {formatNumber(student.gold)}</span>
                    </span>
                  </motion.button>
                );
              })}
            </div>
          )}
        </div>

        <div className="p-4 bg-bg-deep/30 space-y-4">
          <div>
            <label className="block text-sm font-extrabold text-text-primary mb-2">자산 종류</label>
            <div className="grid grid-cols-3 gap-2">
              {([
                { value: 'BV', label: 'BV', emoji: '⭐', active: 'bg-bv/15 border-bv/60 text-bv' },
                { value: 'GOLD', label: '골드', emoji: '🪙', active: 'bg-gold/15 border-gold/60 text-gold' },
                { value: 'BOTH', label: 'BV+골드', emoji: '✨', active: 'bg-brand-primary/15 border-brand-primary/60 text-white' },
              ] as const).map((option) => (
                <button type="button" key={option.value} onClick={() => setTokenMode(option.value)} className={cn('py-2.5 rounded-card-md border text-sm font-black transition-all', token === option.value ? option.active : 'bg-bg-deep border-line text-text-secondary')}>
                  {option.emoji} {option.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-extrabold text-text-primary mb-2">처리 방식</label>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setOperation('GRANT')} className={cn('py-2.5 rounded-card-md border text-sm font-black transition-all', operation === 'GRANT' ? 'bg-success-bg border-success/60 text-success' : 'bg-bg-deep border-line text-text-secondary')}>➕ 지급</button>
              <button type="button" disabled={token === 'BOTH'} onClick={() => setOperation('DEDUCT')} title={token === 'BOTH' ? 'BV+골드 동시 처리는 지급만 지원합니다.' : undefined} className={cn('py-2.5 rounded-card-md border text-sm font-black transition-all disabled:opacity-35 disabled:cursor-not-allowed', operation === 'DEDUCT' ? 'bg-danger-bg border-danger/60 text-danger' : 'bg-bg-deep border-line text-text-secondary')}>➖ 차감</button>
            </div>
            {token === 'BOTH' && <p className="text-xs text-text-secondary mt-1.5">BV+골드는 두 자산을 하나의 DB 트랜잭션에서 동시에 지급합니다.</p>}
          </div>

          {token === 'BOTH' ? (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-sm font-extrabold text-text-primary mb-1.5">1인당 BV</label>
                <input type="number" min={0} max={10_000_000} step={1} value={bvAmountInput} onChange={(e) => setBvAmountInput(e.target.value)} placeholder="예: 5" className="login-input" />
              </div>
              <div>
                <label className="block text-sm font-extrabold text-text-primary mb-1.5">1인당 골드</label>
                <input type="number" min={0} max={10_000_000} step={1} value={goldAmountInput} onChange={(e) => setGoldAmountInput(e.target.value)} placeholder="예: 100" className="login-input" />
              </div>
              {(bvAmountInput || goldAmountInput) && !validCombinedAmount && <p className="col-span-2 text-xs text-danger font-bold">BV와 골드는 0~10,000,000 정수이며 둘 중 하나 이상은 1 이상이어야 합니다.</p>}
            </div>
          ) : (
            <div>
              <label htmlFor="asset-adjustment-amount" className="block text-sm font-extrabold text-text-primary mb-1.5">1인당 금액</label>
              <input id="asset-adjustment-amount" type="number" min={1} max={10_000_000} step={1} value={amountInput} onChange={(event) => setAmountInput(event.target.value)} placeholder="예: 100" className="login-input" />
              {amountInput && !validSingleAmount && <p className="text-xs text-danger font-bold mt-1.5">1 이상 10,000,000 이하의 정수를 입력해주세요.</p>}
            </div>
          )}

          <div>
            <label htmlFor="asset-adjustment-reason" className="block text-sm font-extrabold text-text-primary mb-1.5">지급·차감 사유</label>
            <textarea id="asset-adjustment-reason" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="예: 수업 참여 보상 / 규칙 위반 차감" rows={3} maxLength={200} className="w-full px-3 py-2.5 bg-bg-deep border border-line-strong rounded-card-md text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-brand-primary resize-none" />
            <div className="flex justify-between text-xs font-bold mt-1.5">
              <span className={trimmedReason.length > 0 && trimmedReason.length < 2 ? 'text-danger' : 'text-text-secondary'}>최소 2자</span>
              <span className="text-text-secondary">{reason.length}/200</span>
            </div>
          </div>

          {operation === 'DEDUCT' && insufficientStudents.length > 0 && (
            <div className="bg-danger-bg border border-danger/40 rounded-card-md p-3">
              <p className="text-xs font-extrabold text-danger mb-1">잔액이 부족한 학생이 있습니다.</p>
              <p className="text-xs text-text-primary font-bold break-keep">{insufficientStudents.slice(0, 4).map((student) => student.name).join(', ')}{insufficientStudents.length > 4 ? ` 외 ${insufficientStudents.length - 4}명` : ''}</p>
            </div>
          )}

          <div className="bg-bg-deep border border-line rounded-card-md p-3">
            <div className="flex justify-between text-sm font-bold text-text-secondary"><span>대상</span><span className="text-text-primary">{selectedStudents.length}명</span></div>
            <div className="flex justify-between gap-3 text-sm font-bold text-text-secondary mt-1.5"><span>총 변동량</span><span className={operation === 'GRANT' ? 'text-success text-right' : 'text-danger text-right'}>{totalSummary}</span></div>
          </div>

          <button type="button" onClick={() => setConfirmOpen(true)} disabled={!canOpenConfirm} className={cn('w-full py-3 rounded-card-md text-sm font-black transition-all', operation === 'GRANT' ? 'btn-primary' : 'btn-danger', !canOpenConfirm && 'opacity-50 cursor-not-allowed')}>
            {isSubmitting ? '처리 중...' : `${selectedStudents.length}명 ${operation === 'GRANT' ? '지급' : '차감'} 확인`}
          </button>
          <p className="text-xs text-text-secondary font-bold leading-relaxed break-keep">다중 처리는 전부 성공하거나 전부 취소됩니다. 한 학생이라도 잔액 또는 권한 검증에 실패하면 아무도 변경되지 않습니다.</p>
        </div>
      </div>

      {lastAdjustment && (
        <div className="border-t border-line p-4 bg-success-bg/40">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <p className="text-sm font-extrabold text-success">✅ 마지막 작업 완료</p>
              <p className="text-xs text-text-primary font-bold mt-0.5 break-keep">
                {lastAdjustment.token === 'BOTH'
                  ? `${lastAdjustment.studentCount}명에게 ${formatNumber(lastAdjustment.bvAmount ?? 0)} BV + ${formatNumber(lastAdjustment.goldAmount ?? 0)} 골드를 동시에 지급했습니다.`
                  : `${lastAdjustment.studentCount}명에게 ${formatNumber(lastAdjustment.amount ?? 0)} ${lastAdjustment.token === 'BV' ? 'BV' : '골드'}를 ${lastAdjustment.operation === 'GRANT' ? '지급' : '차감'}했습니다.`}
              </p>
              <p className="text-xs text-text-secondary font-bold mt-1">사유: {lastAdjustment.reason}</p>
            </div>
            <button type="button" onClick={() => setLastAdjustment(null)} className="text-xs font-black text-text-secondary hover:text-text-primary">결과 닫기</button>
          </div>
        </div>
      )}

      {confirmOpen && (
        <Modal isOpen onClose={() => { if (!isSubmitting) setConfirmOpen(false); }} title="자산 변경 최종 확인" emoji={operation === 'GRANT' ? '🎁' : '⚠️'} size="md">
          <div className="space-y-4">
            <div className={cn('rounded-card-md border p-4 text-center', operation === 'GRANT' ? 'bg-success-bg border-success/40' : 'bg-danger-bg border-danger/40')}>
              <div className="text-xs font-black uppercase tracking-widest text-text-secondary mb-1">실행할 작업</div>
              <div className={cn('font-display text-xl tracking-tight', operation === 'GRANT' ? 'text-success' : 'text-danger')}>
                {token === 'BOTH'
                  ? `${selectedStudents.length}명 · +${formatNumber(bvAmount)} BV + ${formatNumber(goldAmount)} 골드`
                  : `${selectedStudents.length}명 · ${operation === 'GRANT' ? '+' : '-'}${formatNumber(amount)} ${token === 'BV' ? 'BV' : '골드'}`}
              </div>
            </div>

            <div className="bg-bg-deep border border-line rounded-card-md p-3">
              <div className="text-xs font-black uppercase tracking-widest text-text-secondary mb-1">사유</div>
              <p className="text-sm text-text-primary font-bold break-keep">{trimmedReason}</p>
            </div>

            <div className="max-h-48 overflow-y-auto bg-bg-deep border border-line rounded-card-md divide-y divide-line">
              {selectedStudents.map((student) => (
                <div key={student.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-extrabold text-text-primary truncate">{student.name}{student.brandName ? ` (${student.brandName})` : ''}</p>
                    <p className="text-xs text-text-secondary font-bold truncate">{student.cachedTier || '티어 정보 없음'}</p>
                  </div>
                  {token === 'BOTH' ? (
                    <p className="text-xs font-mono font-bold text-right text-text-primary whitespace-nowrap">
                      BV {formatNumber(student.bv)} → {formatNumber(student.bv + bvAmount)}<br />
                      GOLD {formatNumber(student.gold)} → {formatNumber(student.gold + goldAmount)}
                    </p>
                  ) : (
                    <p className="text-xs font-mono font-bold text-text-secondary whitespace-nowrap">
                      {formatNumber(token === 'BV' ? student.bv : student.gold)} → <span className="text-text-primary">{formatNumber((token === 'BV' ? student.bv : student.gold) + (operation === 'GRANT' ? amount : -amount))}</span>
                    </p>
                  )}
                </div>
              ))}
            </div>

            <div className="bg-warning-bg border border-warning/30 rounded-card-md p-3">
              <p className="text-xs text-text-primary font-bold break-keep">실행 즉시 학생 지갑과 거래 기록에 반영됩니다. BV+골드 동시 지급은 한 DB 함수 안에서 원자적으로 처리됩니다.</p>
            </div>

            <div className="flex gap-2">
              <button type="button" onClick={() => setConfirmOpen(false)} disabled={isSubmitting} className="btn-secondary flex-1">취소</button>
              <button type="button" onClick={handleConfirm} disabled={isSubmitting} className={cn('flex-1', operation === 'GRANT' ? 'btn-primary' : 'btn-danger')}>{isSubmitting ? 'DB 처리 중...' : '확정 실행'}</button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}

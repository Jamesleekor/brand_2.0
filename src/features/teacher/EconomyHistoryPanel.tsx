import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { EmptyState, LoadingSpinner } from '@/components/shared/components';
import {
  inventoryMarketRpc,
  type EconomyHistoryKind,
  type TeacherEconomyHistoryRow,
  type TeacherHistoryVisibilityRow,
} from '@/lib/rpc/inventory_market_rpc';
import { supabase } from '@/lib/supabase/client';
import { formatDateTime, formatDelta, formatNumber } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';
import { useToastStore } from '@/stores/ui_store';

const PAGE_SIZE = 100;
const TEST_SCAN_PAGE_SIZE = 100;
const VISIBILITY_BATCH_SIZE = 200;

const KIND_FILTERS: { value: EconomyHistoryKind; label: string; emoji: string }[] = [
  { value: 'ALL', label: '전체', emoji: '📚' },
  { value: 'ASSET', label: '자산', emoji: '💰' },
  { value: 'PURCHASE', label: '구매', emoji: '🛒' },
  { value: 'SALE', label: '판매', emoji: '🪙' },
  { value: 'USE', label: '사용', emoji: '✨' },
  { value: 'INVENTORY', label: '기타 아이템', emoji: '📦' },
];

const KIND_META: Record<Exclude<EconomyHistoryKind, 'ALL'>, { label: string; emoji: string; cls: string }> = {
  ASSET: { label: '자산', emoji: '💰', cls: 'border-bv/30 bg-bv/10 text-bv' },
  PURCHASE: { label: '구매', emoji: '🛒', cls: 'border-danger/30 bg-danger-bg text-danger' },
  SALE: { label: '판매', emoji: '🪙', cls: 'border-success/30 bg-success-bg text-success' },
  USE: { label: '사용', emoji: '✨', cls: 'border-crystal/30 bg-crystal/10 text-crystal' },
  INVENTORY: { label: '아이템', emoji: '📦', cls: 'border-warning/30 bg-warning-bg text-warning' },
};

type LiveTestAgent = {
  id: number;
  name: string;
  brand_name: string | null;
};

export default function EconomyHistoryPanel({ classroomId }: { classroomId: number | null }) {
  const queryClient = useQueryClient();
  const showToast = useToastStore((state) => state.show);
  const [kind, setKind] = useState<EconomyHistoryKind>('ALL');
  const [studentId, setStudentId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(0);
  const [showHidden, setShowHidden] = useState(false);
  const [showTestRecords, setShowTestRecords] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set());
  const [historyBusy, setHistoryBusy] = useState<string | null>(null);

  useEffect(() => setPage(0), [kind, studentId, search, dateFrom, dateTo]);
  useEffect(() => setSelectedKeys(new Set()), [page, kind, studentId, search, dateFrom, dateTo, showHidden, showTestRecords]);

  const query = useQuery({
    queryKey: ['teacher-economy-history', classroomId, kind, studentId, search, dateFrom, dateTo, page],
    queryFn: async () => {
      if (!classroomId) return null;
      const result = await inventoryMarketRpc.teacherEconomyHistory(supabase, {
        p_classroom_id: classroomId,
        p_limit: PAGE_SIZE,
        p_offset: page * PAGE_SIZE,
        p_student_id: studentId,
        p_kind: kind,
        p_search: search.trim() || null,
        p_date_from: dateFrom || null,
        p_date_to: dateTo || null,
      });
      if (result.success === false) throw new Error(result.error);
      return result.data;
    },
    enabled: classroomId !== null,
    refetchInterval: 15_000,
  });

  const testAgentsQuery = useQuery<LiveTestAgent[]>({
    queryKey: ['teacher-live-test-agents', classroomId],
    enabled: classroomId !== null,
    staleTime: 30_000,
    queryFn: async () => {
      if (!classroomId) return [];
      const { data, error } = await supabase
        .from('students')
        .select('id,name,brand_name,is_test_account')
        .eq('classroom_id', classroomId)
        .eq('is_test_account', true)
        .is('transferred_at', null)
        .order('id', { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []).map((student) => ({
        id: Number(student.id),
        name: String(student.name),
        brand_name: student.brand_name ? String(student.brand_name) : null,
      }));
    },
  });

  const rawRows = query.data?.rows ?? [];
  const eventKeys = useMemo(() => rawRows.map((row) => row.event_key), [rawRows]);
  const eventKeySignature = useMemo(() => eventKeys.join('\u001f'), [eventKeys]);

  const visibilityQuery = useQuery({
    queryKey: ['teacher-history-visibility', classroomId, eventKeySignature],
    enabled: classroomId !== null && eventKeys.length > 0,
    queryFn: async () => {
      if (!classroomId || eventKeys.length === 0) return [] as TeacherHistoryVisibilityRow[];
      const result = await inventoryMarketRpc.teacherHistoryVisibility(supabase, {
        p_classroom_id: classroomId,
        p_event_keys: eventKeys,
      });
      if (result.success === false) throw new Error(result.error);
      return result.data.rows;
    },
    staleTime: 0,
  });

  const visibilityMap = useMemo(() => {
    const map = new Map<string, TeacherHistoryVisibilityRow>();
    for (const row of visibilityQuery.data ?? []) map.set(row.event_key, row);
    return map;
  }, [visibilityQuery.data]);

  const testAgentIds = useMemo(() => new Set((testAgentsQuery.data ?? []).map((agent) => agent.id)), [testAgentsQuery.data]);

  const rows = useMemo(() => rawRows.filter((row) => {
    const isTest = testAgentIds.has(row.student_id);
    const visibility = visibilityMap.get(row.event_key);
    const isHidden = visibility?.hidden === true;
    const isTestCleanupHidden = isHidden && visibility?.reason.startsWith('TEST_CLEANUP');

    if (isTest && !showTestRecords) return false;
    if (isHidden && !showHidden && !(isTest && showTestRecords && isTestCleanupHidden)) return false;
    return true;
  }), [rawRows, showHidden, showTestRecords, testAgentIds, visibilityMap]);

  const total = query.data?.total_count ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const selectedVisibleKeys = useMemo(
    () => Array.from(selectedKeys).filter((key) => visibilityMap.get(key)?.hidden !== true),
    [selectedKeys, visibilityMap],
  );
  const selectedHiddenKeys = useMemo(
    () => Array.from(selectedKeys).filter((key) => visibilityMap.get(key)?.hidden === true),
    [selectedKeys, visibilityMap],
  );
  const allDisplayedSelected = rows.length > 0 && rows.every((row) => selectedKeys.has(row.event_key));
  const hiddenOnRawPage = rawRows.filter((row) => visibilityMap.get(row.event_key)?.hidden === true).length;
  const testOnRawPage = rawRows.filter((row) => testAgentIds.has(row.student_id)).length;
  const visibilityUnavailable = visibilityQuery.isError;
  const metadataLoading = query.isSuccess && (testAgentsQuery.isLoading || (eventKeys.length > 0 && visibilityQuery.isLoading));

  async function setVisibility(keys: string[], hidden: boolean, reason: string) {
    if (!classroomId || keys.length === 0 || historyBusy) return false;
    setHistoryBusy(hidden ? 'hide' : 'restore');
    try {
      const result = await inventoryMarketRpc.teacherSetHistoryVisibility(supabase, {
        p_classroom_id: classroomId,
        p_event_keys: keys,
        p_hidden: hidden,
        p_reason: reason,
      });
      if (result.success === false) throw new Error(result.error);
      showToast({
        title: hidden ? '히스토리에서 숨겼어요' : '히스토리 표시를 복구했어요',
        description: `${result.data.updated_count}건 · 원본 거래/아이템 기록은 그대로 유지됩니다.`,
        variant: 'success',
      });
      setSelectedKeys(new Set());
      await queryClient.invalidateQueries({ queryKey: ['teacher-history-visibility'] });
      return true;
    } catch (error) {
      showToast({
        title: hidden ? '히스토리 숨김 실패' : '히스토리 복구 실패',
        description: error instanceof Error ? error.message : '알 수 없는 오류',
        variant: 'error',
        duration: 5000,
      });
      return false;
    } finally {
      setHistoryBusy(null);
    }
  }

  async function hideLiveTestHistory() {
    if (!classroomId || historyBusy) return;
    const agents = testAgentsQuery.data ?? [];
    if (agents.length === 0) {
      showToast({ title: '활성 테스트요원이 없습니다', variant: 'info' });
      return;
    }

    const rangeLabel = dateFrom || dateTo
      ? `${dateFrom || '처음'} ~ ${dateTo || '오늘'} 범위`
      : '전체 기간';
    if (!window.confirm(`🧪 Live Test Agent의 ${rangeLabel} 통합 히스토리를 일괄 숨길까요?\n원본 DB 기록은 삭제되지 않으며 언제든 복구할 수 있습니다.`)) return;

    setHistoryBusy('test-cleanup');
    try {
      const keys = new Set<string>();
      for (const agent of agents) {
        let offset = 0;
        let expectedTotal = Number.POSITIVE_INFINITY;
        while (offset < expectedTotal) {
          const result = await inventoryMarketRpc.teacherEconomyHistory(supabase, {
            p_classroom_id: classroomId,
            p_limit: TEST_SCAN_PAGE_SIZE,
            p_offset: offset,
            p_student_id: agent.id,
            p_kind: 'ALL',
            p_search: null,
            p_date_from: dateFrom || null,
            p_date_to: dateTo || null,
          });
          if (result.success === false) throw new Error(result.error);
          expectedTotal = result.data.total_count;
          for (const row of result.data.rows) keys.add(row.event_key);
          if (result.data.rows.length === 0) break;
          offset += result.data.rows.length;
        }
      }

      const allKeys = Array.from(keys);
      if (allKeys.length === 0) {
        showToast({ title: '숨길 테스트 기록이 없습니다', description: rangeLabel, variant: 'info' });
        return;
      }

      let updated = 0;
      const reason = `TEST_CLEANUP:${dateFrom || '*'}:${dateTo || '*'}`;
      for (let index = 0; index < allKeys.length; index += VISIBILITY_BATCH_SIZE) {
        const batch = allKeys.slice(index, index + VISIBILITY_BATCH_SIZE);
        const result = await inventoryMarketRpc.teacherSetHistoryVisibility(supabase, {
          p_classroom_id: classroomId,
          p_event_keys: batch,
          p_hidden: true,
          p_reason: reason,
        });
        if (result.success === false) throw new Error(result.error);
        updated += result.data.updated_count;
      }

      setShowTestRecords(false);
      setSelectedKeys(new Set());
      await queryClient.invalidateQueries({ queryKey: ['teacher-history-visibility'] });
      showToast({
        title: '🧪 테스트 기록 정리 완료',
        description: `${updated}건을 히스토리에서 숨겼습니다. 원본 로그는 보존됩니다.`,
        variant: 'success',
        duration: 4500,
      });
    } catch (error) {
      showToast({
        title: '테스트 기록 정리 실패',
        description: error instanceof Error ? error.message : '알 수 없는 오류',
        variant: 'error',
        duration: 6000,
      });
    } finally {
      setHistoryBusy(null);
    }
  }

  function toggleSelected(key: string) {
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleAllDisplayed() {
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (allDisplayedSelected) rows.forEach((row) => next.delete(row.event_key));
      else rows.forEach((row) => next.add(row.event_key));
      return next;
    });
  }

  if (!classroomId) return <EmptyState emoji="📚" title="학급 정보를 찾을 수 없습니다" />;

  return (
    <section className="space-y-4">
      <div className="rounded-card-lg border border-line bg-gradient-to-br from-bg-card to-bg-deep p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.2em] text-gold">AUDIT LEDGER</div>
            <h2 className="mt-1 font-display text-xl text-white">📚 통합 히스토리</h2>
            <p className="mt-1 max-w-3xl text-xs font-bold leading-relaxed text-text-secondary">
              BV·GOLD·CRYSTAL 변동과 시장 구매·판매·아이템 사용을 한 시간축에서 확인합니다. ‘숨김’은 화면 표시만 정리하며 원본 거래·아이템 로그는 절대 삭제하지 않습니다.
            </p>
          </div>
          <button type="button" onClick={() => void query.refetch()} className="btn-secondary whitespace-nowrap">
            ↻ 새로고침
          </button>
        </div>
      </div>

      <div className="rounded-card-lg border border-line bg-bg-card p-3">
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {KIND_FILTERS.map((filter) => (
            <button
              key={filter.value}
              type="button"
              onClick={() => setKind(filter.value)}
              className={cn(
                'flex-shrink-0 rounded-pill border px-3 py-2 text-xs font-black',
                kind === filter.value
                  ? 'border-brand-primary/50 bg-brand-primary/20 text-white'
                  : 'border-line bg-bg-deep text-text-secondary',
              )}
            >
              {filter.emoji} {filter.label}
            </button>
          ))}
        </div>

        <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-[180px_1fr_150px_150px]">
          <select
            value={studentId ?? ''}
            onChange={(e) => setStudentId(e.target.value ? Number(e.target.value) : null)}
            className="rounded-card-md border border-line bg-bg-deep px-3 py-2.5 text-sm font-bold text-white outline-none"
          >
            <option value="">전체 학생</option>
            {(query.data?.students ?? []).map((student) => (
              <option key={student.id} value={student.id}>{testAgentIds.has(student.id) ? '🧪 ' : ''}{student.name}{student.brand_name ? ` · ${student.brand_name}` : ''}</option>
            ))}
          </select>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="학생 · 브랜드 · 아이템 · 비고 검색"
            className="rounded-card-md border border-line bg-bg-deep px-3 py-2.5 text-sm font-bold text-white outline-none focus:border-brand-primary/60"
          />
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="rounded-card-md border border-line bg-bg-deep px-3 py-2 text-xs font-bold text-white outline-none" />
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="rounded-card-md border border-line bg-bg-deep px-3 py-2 text-xs font-bold text-white outline-none" />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line/70 pt-3">
          <ToggleButton active={showHidden} onClick={() => setShowHidden((value) => !value)} disabled={visibilityUnavailable}>
            👁 숨긴 기록 보기
          </ToggleButton>
          <ToggleButton active={showTestRecords} onClick={() => setShowTestRecords((value) => !value)} disabled={testAgentsQuery.isError}>
            🧪 테스트 기록 보기
          </ToggleButton>
          <button
            type="button"
            onClick={() => void hideLiveTestHistory()}
            disabled={historyBusy !== null || testAgentsQuery.isLoading || testAgentsQuery.isError || (testAgentsQuery.data?.length ?? 0) === 0}
            className="rounded-pill border border-warning/40 bg-warning-bg px-3 py-2 text-xs font-black text-warning disabled:opacity-40"
          >
            {historyBusy === 'test-cleanup' ? '정리 중...' : `🧪 테스트 기록 일괄 숨김${dateFrom || dateTo ? ' · 날짜범위' : ''}`}
          </button>

          {selectedVisibleKeys.length > 0 && (
            <button
              type="button"
              disabled={historyBusy !== null || visibilityUnavailable}
              onClick={() => {
                if (window.confirm(`선택한 ${selectedVisibleKeys.length}건을 히스토리에서 숨길까요?\n원본 기록은 삭제되지 않습니다.`)) {
                  void setVisibility(selectedVisibleKeys, true, 'BULK_HIDE');
                }
              }}
              className="rounded-pill border border-danger/35 bg-danger-bg px-3 py-2 text-xs font-black text-danger disabled:opacity-40"
            >
              선택 숨김 {selectedVisibleKeys.length}건
            </button>
          )}
          {selectedHiddenKeys.length > 0 && (
            <button
              type="button"
              disabled={historyBusy !== null || visibilityUnavailable}
              onClick={() => void setVisibility(selectedHiddenKeys, false, 'BULK_RESTORE')}
              className="rounded-pill border border-success/35 bg-success-bg px-3 py-2 text-xs font-black text-success disabled:opacity-40"
            >
              선택 복구 {selectedHiddenKeys.length}건
            </button>
          )}
        </div>

        <div className="mt-2 flex flex-wrap items-center justify-between gap-3 text-[10px] font-bold text-text-muted">
          <span>
            원본 {formatNumber(total)}건 · 현재 페이지 표시 {rows.length}/{rawRows.length}건
            {hiddenOnRawPage > 0 ? ` · 숨김 ${hiddenOnRawPage}` : ''}
            {testOnRawPage > 0 ? ` · 테스트 ${testOnRawPage}` : ''}
          </span>
          {(search || studentId || dateFrom || dateTo || kind !== 'ALL') && (
            <button
              type="button"
              className="text-text-secondary hover:text-white"
              onClick={() => { setKind('ALL'); setStudentId(null); setSearch(''); setDateFrom(''); setDateTo(''); }}
            >
              필터 초기화
            </button>
          )}
        </div>
      </div>

      {visibilityQuery.isError && (
        <div className="rounded-card-md border border-warning/40 bg-warning-bg p-3 text-xs font-bold text-warning">
          히스토리 숨김 정보를 불러오지 못했습니다. `20260903_03_history_visibility_overrides.sql` 적용 여부를 확인해주세요. 원본 히스토리는 계속 표시됩니다.
        </div>
      )}
      {testAgentsQuery.isError && (
        <div className="rounded-card-md border border-warning/40 bg-warning-bg p-3 text-xs font-bold text-warning">
          테스트요원 정보를 불러오지 못해 테스트 기록 자동 숨김이 비활성화되었습니다.
        </div>
      )}

      {query.isLoading || metadataLoading ? (
        <div className="flex min-h-[420px] items-center justify-center"><LoadingSpinner size="lg" /></div>
      ) : query.isError ? (
        <div className="rounded-card-lg border border-danger/40 bg-danger-bg p-5">
          <div className="font-black text-danger">히스토리를 불러오지 못했습니다.</div>
          <div className="mt-1 break-all text-xs text-text-secondary">{query.error instanceof Error ? query.error.message : '알 수 없는 오류'}</div>
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-card-lg border border-line bg-bg-card">
          <EmptyState emoji="📚" title={rawRows.length > 0 ? '현재 표시 설정에서 숨겨진 기록만 있습니다' : '조건에 맞는 기록이 없습니다'} />
        </div>
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-card-lg border border-line bg-bg-card lg:block">
            <div className="min-w-[1160px]">
              <div className="grid grid-cols-[42px_145px_165px_100px_145px_135px_minmax(230px,1fr)_72px] border-b border-line bg-bg-deep px-3 py-2 text-[10px] font-black text-text-muted">
                <div><input type="checkbox" aria-label="현재 표시 기록 전체 선택" checked={allDisplayedSelected} onChange={toggleAllDisplayed} /></div>
                <div>시간</div><div>학생 / 브랜드</div><div>구분</div><div>변동</div><div>변동 후 잔액</div><div>비고</div><div>관리</div>
              </div>
              {rows.map((row) => (
                <DesktopRow
                  key={row.event_key}
                  row={row}
                  selected={selectedKeys.has(row.event_key)}
                  hidden={visibilityMap.get(row.event_key)?.hidden === true}
                  testAgent={testAgentIds.has(row.student_id)}
                  busy={historyBusy !== null || visibilityUnavailable}
                  onSelect={() => toggleSelected(row.event_key)}
                  onHide={() => void setVisibility([row.event_key], true, 'MANUAL_HIDE')}
                  onRestore={() => void setVisibility([row.event_key], false, 'MANUAL_RESTORE')}
                />
              ))}
            </div>
          </div>

          <div className="space-y-2 lg:hidden">
            {rows.map((row) => (
              <MobileRow
                key={row.event_key}
                row={row}
                selected={selectedKeys.has(row.event_key)}
                hidden={visibilityMap.get(row.event_key)?.hidden === true}
                testAgent={testAgentIds.has(row.student_id)}
                busy={historyBusy !== null || visibilityUnavailable}
                onSelect={() => toggleSelected(row.event_key)}
                onHide={() => void setVisibility([row.event_key], true, 'MANUAL_HIDE')}
                onRestore={() => void setVisibility([row.event_key], false, 'MANUAL_RESTORE')}
              />
            ))}
          </div>

          <div className="flex items-center justify-center gap-3">
            <button type="button" disabled={page <= 0} onClick={() => setPage((p) => Math.max(0, p - 1))} className="btn-secondary disabled:opacity-35">이전</button>
            <span className="text-xs font-black text-text-secondary">{page + 1} / {pageCount}</span>
            <button type="button" disabled={page + 1 >= pageCount} onClick={() => setPage((p) => p + 1)} className="btn-secondary disabled:opacity-35">다음</button>
          </div>
          <p className="text-center text-[9px] font-bold text-text-muted">페이지 수는 삭제되지 않은 원본 감사원장 기준입니다. 숨긴 기록은 표시에서만 제외됩니다.</p>
        </>
      )}
    </section>
  );
}

function ToggleButton({ active, onClick, disabled, children }: { active: boolean; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'rounded-pill border px-3 py-2 text-xs font-black disabled:opacity-40',
        active ? 'border-brand-primary/50 bg-brand-primary/20 text-white' : 'border-line bg-bg-deep text-text-secondary',
      )}
    >
      {children}
    </button>
  );
}

type HistoryRowActionProps = {
  row: TeacherEconomyHistoryRow;
  selected: boolean;
  hidden: boolean;
  testAgent: boolean;
  busy: boolean;
  onSelect: () => void;
  onHide: () => void;
  onRestore: () => void;
};

function DesktopRow({ row, selected, hidden, testAgent, busy, onSelect, onHide, onRestore }: HistoryRowActionProps) {
  return (
    <div className={cn('grid grid-cols-[42px_145px_165px_100px_145px_135px_minmax(230px,1fr)_72px] items-center gap-0 border-b border-line/70 px-3 py-2.5 text-xs last:border-b-0', row.is_reversed && 'opacity-55', hidden && 'bg-bg-deep/60')}>
      <div><input type="checkbox" aria-label={`${row.student_name} 기록 선택`} checked={selected} onChange={onSelect} /></div>
      <div className="font-bold text-text-muted">{formatDateTime(row.occurred_at)}</div>
      <StudentCell row={row} testAgent={testAgent} hidden={hidden} />
      <KindBadge row={row} />
      <div><DeltaCell row={row} /></div>
      <div><BalanceCell row={row} /></div>
      <MemoCell row={row} />
      <HistoryAction hidden={hidden} busy={busy} onHide={onHide} onRestore={onRestore} />
    </div>
  );
}

function MobileRow({ row, selected, hidden, testAgent, busy, onSelect, onHide, onRestore }: HistoryRowActionProps) {
  return (
    <article className={cn('rounded-card-lg border border-line bg-bg-card p-3', row.is_reversed && 'opacity-55', hidden && 'bg-bg-deep/70')}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <input className="mt-1" type="checkbox" aria-label={`${row.student_name} 기록 선택`} checked={selected} onChange={onSelect} />
          <StudentCell row={row} testAgent={testAgent} hidden={hidden} />
        </div>
        <KindBadge row={row} />
      </div>
      <div className="mt-2 text-[10px] font-bold text-text-muted">{formatDateTime(row.occurred_at)}</div>
      <div className="mt-3 grid grid-cols-2 gap-2 rounded-card-md bg-bg-deep p-2.5">
        <div><div className="text-[9px] font-black text-text-muted">변동</div><div className="mt-0.5"><DeltaCell row={row} /></div></div>
        <div><div className="text-[9px] font-black text-text-muted">변동 후 잔액</div><div className="mt-0.5"><BalanceCell row={row} /></div></div>
      </div>
      <div className="mt-2"><MemoCell row={row} /></div>
      <div className="mt-3 flex justify-end"><HistoryAction hidden={hidden} busy={busy} onHide={onHide} onRestore={onRestore} /></div>
    </article>
  );
}

function HistoryAction({ hidden, busy, onHide, onRestore }: { hidden: boolean; busy: boolean; onHide: () => void; onRestore: () => void }) {
  return hidden ? (
    <button type="button" onClick={onRestore} disabled={busy} className="text-[10px] font-black text-success disabled:opacity-40">복구</button>
  ) : (
    <button type="button" onClick={onHide} disabled={busy} className="text-[10px] font-black text-danger disabled:opacity-40">숨김</button>
  );
}

function StudentCell({ row, testAgent = false, hidden = false }: { row: TeacherEconomyHistoryRow; testAgent?: boolean; hidden?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center gap-1">
        {testAgent && <span className="shrink-0 text-[10px]" title="Live Test Agent">🧪</span>}
        <div className="truncate font-black text-white">{row.student_name}</div>
        {hidden && <span className="shrink-0 rounded-pill border border-line px-1.5 py-0.5 text-[8px] font-black text-text-muted">숨김</span>}
      </div>
      <div className="truncate text-[10px] font-bold text-text-muted">{row.brand_name || '브랜드명 없음'}</div>
    </div>
  );
}

function KindBadge({ row }: { row: TeacherEconomyHistoryRow }) {
  const meta = KIND_META[row.kind];
  const label = row.raw_event_type === 'CONSUME_RESERVED' ? 'PASS 사용' : meta.label;
  return <span className={cn('inline-flex w-fit rounded-pill border px-2 py-1 text-[10px] font-black', meta.cls)}>{meta.emoji} {label}</span>;
}

function DeltaCell({ row }: { row: TeacherEconomyHistoryRow }) {
  if (row.kind === 'USE' || row.kind === 'INVENTORY') {
    return <span className={row.quantity_delta < 0 ? 'font-black text-danger' : 'font-black text-success'}>{formatDelta(row.quantity_delta)}개</span>;
  }
  if (!row.value_token) return <span className="text-text-muted">—</span>;
  return (
    <div>
      <div className={cn('font-black', row.asset_delta >= 0 ? 'text-success' : 'text-danger')}>{formatDelta(row.asset_delta)} {row.value_token}</div>
      {row.quantity > 0 && row.item_name && <div className="mt-0.5 text-[10px] font-bold text-text-muted">{row.item_name} ×{row.quantity}</div>}
    </div>
  );
}

function BalanceCell({ row }: { row: TeacherEconomyHistoryRow }) {
  if (row.balance_after === null || !row.value_token) return <span className="text-text-muted">—</span>;
  return <span className="font-black text-text-primary">{formatNumber(row.balance_after)} {row.value_token}</span>;
}

function MemoCell({ row }: { row: TeacherEconomyHistoryRow }) {
  return (
    <div className="min-w-0">
      <div className="break-words font-bold text-text-secondary">{row.memo || row.item_name || row.source_type}</div>
      <div className="mt-0.5 flex flex-wrap gap-2 text-[9px] font-bold text-text-muted">
        <span>{row.source_type}</span>
        {row.tax_amount > 0 && <span>세금 {formatNumber(row.tax_amount)}</span>}
        {row.is_reversed && <span className="text-danger">취소된 원거래</span>}
      </div>
    </div>
  );
}

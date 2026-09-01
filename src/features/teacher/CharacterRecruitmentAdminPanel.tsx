import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { EmptyState, LoadingSpinner, Modal, useRpcCall } from '@/components/shared/components';
import {
  characterS1Rpc,
  type TeacherCharacterRecruitmentBoard,
  type TeacherCharacterRecruitmentRow,
} from '@/lib/rpc/character_s1_rpc';
import type { CharacterRecruitmentMode } from '@/lib/zod_schemas/character_s1_schemas';
import { supabase } from '@/lib/supabase/client';
import { cn } from '@/lib/utils/cn';

type RecruitmentFilter = 'ALL' | 'ACTIVE' | 'UNCONFIGURED' | 'CRYSTAL' | 'FREE' | 'SPECIAL';

export function CharacterRecruitmentAdminPanel({ classroomId }: { classroomId: number }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<RecruitmentFilter>('ALL');
  const [editing, setEditing] = useState<TeacherCharacterRecruitmentRow | null>(null);

  const query = useQuery<TeacherCharacterRecruitmentBoard>({
    queryKey: ['character-s1-recruitment-admin', classroomId],
    queryFn: async () => {
      const result = await characterS1Rpc.teacherBoard(supabase, classroomId);
      if (result.success === false) throw new Error(result.error);
      return result.data ?? { characters: [], configured_offers: 0, active_self_offers: 0 };
    },
  });

  const rows = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase('ko-KR');
    return (query.data?.characters ?? []).filter((row) => {
      const mode = row.offer?.acquisition_mode;
      if (filter === 'ACTIVE' && !row.offer?.is_active) return false;
      if (filter === 'UNCONFIGURED' && row.offer) return false;
      if (filter === 'CRYSTAL' && mode !== 'CRYSTAL') return false;
      if (filter === 'FREE' && mode !== 'FREE') return false;
      if (filter === 'SPECIAL' && mode !== 'TEACHER_ONLY' && mode !== 'EVENT_ONLY') return false;
      if (!needle) return true;
      return [
        row.character_uid,
        row.name,
        row.epithet,
        row.source_condition_text,
        mode ? modeLabel(mode) : '미설정',
      ]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase('ko-KR').includes(needle));
    });
  }, [filter, query.data?.characters, search]);

  const crystalCount = (query.data?.characters ?? []).filter((row) => row.offer?.acquisition_mode === 'CRYSTAL').length;
  const specialCount = (query.data?.characters ?? []).filter(
    (row) => row.offer?.acquisition_mode === 'TEACHER_ONLY' || row.offer?.acquisition_mode === 'EVENT_ONLY',
  ).length;

  if (query.isLoading || !query.data) {
    return <div className="flex min-h-[420px] items-center justify-center"><LoadingSpinner size="lg" /></div>;
  }

  if (query.isError) {
    return (
      <div className="rounded-card-lg border border-danger/40 bg-danger-bg p-6 text-center">
        <div className="text-3xl">⚠️</div>
        <h2 className="mt-2 font-display text-lg text-white">영입 설정을 불러오지 못했습니다</h2>
        <p className="mt-2 break-all text-xs text-text-primary">
          {query.error instanceof Error ? query.error.message : '알 수 없는 오류'}
        </p>
        <p className="mt-2 text-xs font-bold text-warning">Character S1 DB APPLY가 먼저 필요합니다.</p>
      </div>
    );
  }

  return (
    <section className="space-y-4">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <RecruitmentStat label="설정 완료" value={`${query.data.configured_offers} / ${query.data.characters.length}`} emoji="⚙️" />
        <RecruitmentStat label="학생 직접 영입 활성" value={query.data.active_self_offers} emoji="✦" tone="success" />
        <RecruitmentStat label="크리스탈 영입 설정" value={crystalCount} emoji="💎" tone="crystal" />
        <RecruitmentStat label="특별 영입 경로" value={specialCount} emoji="🎟️" tone="bv" />
      </div>

      <div className="rounded-card-lg border border-line bg-bg-card p-3">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex gap-1.5 overflow-x-auto">
            {(['ALL','ACTIVE','UNCONFIGURED','CRYSTAL','FREE','SPECIAL'] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={cn(
                  'flex-shrink-0 rounded-pill border px-3 py-2 text-xs font-black transition-all',
                  filter === key
                    ? 'border-brand-primary/50 bg-brand-primary/20 text-white'
                    : 'border-line bg-bg-deep text-text-secondary hover:text-white',
                )}
              >
                {filterLabel(key)}
              </button>
            ))}
          </div>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="UID · 편린 · 조건 · 영입방식 검색"
            className="w-full rounded-card-md border border-line bg-bg-deep px-3 py-2 text-xs font-bold text-text-primary outline-none focus:border-brand-primary/60 xl:w-80"
          />
        </div>
        <p className="mt-2 text-[10px] font-bold leading-relaxed text-text-muted">
          Season 1 가격은 자동 이관하지 않습니다. Season 2 영입가를 편린별로 직접 설정하세요.
          크리스탈/무료 직접 영입을 활성화하려면 먼저 해당 편린의 영입 조건 정책이 ACTIVE여야 합니다.
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-card-lg border border-line bg-bg-card">
          <EmptyState emoji="✦" title="조건에 맞는 편린이 없습니다" description="검색어나 필터를 바꿔보세요." />
        </div>
      ) : (
        <div className="overflow-hidden rounded-card-lg border border-line bg-bg-card">
          <div className="hidden border-b border-line bg-bg-deep/55 px-4 py-2 text-[10px] font-black uppercase tracking-wide text-text-muted lg:grid lg:grid-cols-[56px_minmax(180px,1.2fr)_minmax(230px,1.5fr)_150px_135px_130px_auto] lg:gap-3">
            <span />
            <span>편린</span>
            <span>영입 조건</span>
            <span>영입 방식</span>
            <span>가격</span>
            <span>학생 현황</span>
            <span />
          </div>
          <div className="divide-y divide-line">
            {rows.map((row) => (
              <RecruitmentRow key={row.character_id} row={row} onEdit={() => setEditing(row)} />
            ))}
          </div>
        </div>
      )}

      <RecruitmentOfferModal
        classroomId={classroomId}
        row={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          void queryClient.invalidateQueries({ queryKey: ['character-s1-recruitment-admin', classroomId] });
          void queryClient.invalidateQueries({ queryKey: ['character-c3-admin-board', classroomId] });
        }}
      />
    </section>
  );
}

function RecruitmentRow({ row, onEdit }: { row: TeacherCharacterRecruitmentRow; onEdit: () => void }) {
  const offer = row.offer;
  const mode = offer?.acquisition_mode ?? null;
  const policyReady = row.policy_status === 'ACTIVE' && row.policy_is_recruitable;
  return (
    <div className="grid gap-3 px-3 py-3 hover:bg-bg-deep/35 lg:grid-cols-[56px_minmax(180px,1.2fr)_minmax(230px,1.5fr)_150px_135px_130px_auto] lg:items-center lg:px-4">
      <CharacterThumb row={row} />

      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-[10px] font-black text-text-muted">{row.character_uid}</span>
          {!row.is_active && <MiniBadge label="Master 비활성" tone="muted" />}
          {offer?.is_active && <MiniBadge label="경로 활성" tone="success" />}
          {!offer && <MiniBadge label="가격 미설정" tone="warning" />}
        </div>
        <div className="mt-0.5 truncate text-sm font-black text-white">{row.name}</div>
        <div className="truncate text-[11px] font-semibold text-text-secondary">{row.epithet ?? '이명 없음'}</div>
      </div>

      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <MiniBadge
            label={policyReady ? '조건 정책 ACTIVE' : row.policy_status === 'DRAFT' ? '조건 초안' : '조건 비활성'}
            tone={policyReady ? 'success' : row.policy_status === 'DRAFT' ? 'warning' : 'muted'}
          />
          <span className="text-[10px] font-black text-brand-primary">{row.eligible_students}/{row.total_students}명 조건 달성</span>
        </div>
        <p className="mt-1 truncate text-xs font-bold text-text-primary">
          {row.source_condition_text || (policyReady ? '조건 없음' : '영입 조건 준비 중')}
        </p>
      </div>

      <div>
        {mode ? (
          <MiniBadge
            label={modeLabel(mode)}
            tone={mode === 'CRYSTAL' ? 'crystal' : mode === 'FREE' ? 'success' : mode === 'UNAVAILABLE' ? 'muted' : 'info'}
          />
        ) : (
          <span className="text-xs font-bold text-warning">미설정</span>
        )}
      </div>

      <div>
        <div className="text-[10px] font-black text-text-muted">Season 2 기본가</div>
        <div className={cn('mt-0.5 text-sm font-black', mode === 'CRYSTAL' ? 'text-crystal' : 'text-text-secondary')}>
          {mode === 'CRYSTAL' ? `💎 ${formatGold(offer?.base_price_crystal ?? 0)} 크리스탈` : mode === 'FREE' ? '무료' : '—'}
        </div>
      </div>

      <div>
        <div className="text-[10px] font-black text-text-muted">지금 직접 영입 가능</div>
        <div className="mt-0.5 text-sm font-black text-brand-primary">{row.self_recruitable_students}명</div>
        <div className="mt-0.5 text-[10px] font-bold text-text-muted">보유 {row.owned_students}명</div>
      </div>

      <div className="lg:text-right">
        <button type="button" onClick={onEdit} className="btn-secondary px-3 py-2 text-[11px]">
          영입 설정
        </button>
      </div>
    </div>
  );
}

function RecruitmentOfferModal({
  classroomId,
  row,
  onClose,
  onSaved,
}: {
  classroomId: number;
  row: TeacherCharacterRecruitmentRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { call, isLoading } = useRpcCall();
  const [mode, setMode] = useState<CharacterRecruitmentMode>('UNAVAILABLE');
  const [price, setPrice] = useState('0');
  const [active, setActive] = useState(false);
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (!row) return;
    setMode(row.offer?.acquisition_mode ?? 'UNAVAILABLE');
    setPrice(String(row.offer?.base_price_crystal ?? 0));
    setActive(row.offer?.is_active ?? false);
    setNotes(row.offer?.notes ?? '');
  }, [row]);

  if (!row) return null;

  const policyReady = row.policy_status === 'ACTIVE' && row.policy_is_recruitable;
  const selfMode = mode === 'CRYSTAL' || mode === 'FREE';
  const invalidPolicy = selfMode && active && !policyReady;

  const selectMode = (next: CharacterRecruitmentMode) => {
    setMode(next);
    if (next !== 'CRYSTAL') setPrice('0');
    if (next === 'UNAVAILABLE') setActive(false);
  };

  const save = async () => {
    await call(
      () => characterS1Rpc.teacherSetOffer(supabase, {
        p_classroom_id: classroomId,
        p_character_id: row.character_id,
        p_acquisition_mode: mode,
        p_base_price_crystal: mode === 'CRYSTAL' ? Math.max(0, Math.trunc(Number(price) || 0)) : 0,
        p_is_active: active,
        p_notes: notes.trim() || null,
      }),
      {
        successTitle: `${row.name} 영입 설정 저장 완료`,
        onSuccess: onSaved,
      },
    );
  };

  return (
    <Modal isOpen={Boolean(row)} onClose={onClose} title="편린 영입 설정" size="lg">
      <div className="space-y-4">
        <div className="flex items-center gap-3 rounded-card-lg border border-line bg-bg-deep p-3">
          <CharacterThumb row={row} className="h-16 w-16" />
          <div className="min-w-0">
            <div className="font-mono text-[10px] font-black text-text-muted">{row.character_uid}</div>
            <div className="truncate font-display text-xl text-white">{row.name}</div>
            <div className="truncate text-xs font-semibold text-text-secondary">{row.epithet || 'B.R.A.N.D 편린'}</div>
          </div>
        </div>

        <div className={cn(
          'rounded-card-lg border p-3',
          policyReady ? 'border-success/30 bg-success-bg' : 'border-warning/35 bg-warning/10',
        )}>
          <div className={cn('text-xs font-black', policyReady ? 'text-success' : 'text-warning')}>
            {policyReady ? '✓ 학생 영입 조건 정책 사용 가능' : '⚠ 학생 직접 영입 전 조건 정책을 먼저 활성화하세요'}
          </div>
          <p className="mt-1 text-xs font-semibold text-text-secondary">
            {row.source_condition_text || (policyReady ? '조건 없음' : '현재 영입 정책이 ACTIVE 상태가 아닙니다.')}
          </p>
          <p className="mt-1 text-[10px] font-bold text-text-muted">
            현재 조건 달성 {row.eligible_students} / {row.total_students}명
          </p>
        </div>

        <div>
          <label className="text-xs font-black text-text-secondary">영입 방식</label>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
            {(['CRYSTAL','FREE','TEACHER_ONLY','EVENT_ONLY','UNAVAILABLE'] as const).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => selectMode(item)}
                className={cn(
                  'rounded-card-md border px-2 py-2.5 text-[11px] font-black transition',
                  mode === item
                    ? 'border-brand-primary/50 bg-brand-primary/15 text-white'
                    : 'border-line bg-bg-deep text-text-secondary hover:text-white',
                )}
              >
                {modeLabel(item)}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[10px] font-bold leading-relaxed text-text-muted">
            크리스탈/무료는 학생이 조건 충족 후 직접 영입합니다. 교사 지급/이벤트 전용은 학생에게 획득 경로만 안내하고 직접 버튼은 열지 않습니다.
          </p>
        </div>

        {mode === 'CRYSTAL' && (
          <div>
            <label className="text-xs font-black text-text-secondary">Season 2 기본 영입가 (크리스탈)</label>
            <input
              type="number"
              min={1}
              max={10_000_000}
              step={1}
              value={price}
              onChange={(event) => setPrice(event.target.value)}
              className="mt-1.5 w-full rounded-card-md border border-line bg-bg-deep px-3 py-2.5 text-sm font-black text-gold outline-none focus:border-brand-primary/60"
            />
            <p className="mt-1.5 text-[10px] font-bold text-text-muted">
              이 값은 기본 영입가입니다. 학생의 콜렉션 상점 할인 버프가 있으면 서버가 최종 영입가를 자동 계산해 적용합니다.
            </p>
          </div>
        )}

        {mode === 'FREE' && (
          <div className="rounded-card-md border border-success/25 bg-success-bg p-3 text-xs font-bold text-success">
            조건을 충족한 학생은 크리스탈 차감 없이 바로 영입할 수 있습니다.
          </div>
        )}

        <label className={cn(
          'flex items-center justify-between gap-3 rounded-card-lg border p-3',
          mode === 'UNAVAILABLE' ? 'cursor-not-allowed border-line bg-bg-deep/50 opacity-60' : 'border-line bg-bg-deep',
        )}>
          <div>
            <div className="text-xs font-black text-text-primary">영입 경로 활성화</div>
            <div className="mt-0.5 text-[10px] font-bold text-text-muted">
              끄면 설정은 보존하지만 학생에게는 준비 중 상태로 표시됩니다.
            </div>
          </div>
          <input
            type="checkbox"
            checked={active}
            disabled={mode === 'UNAVAILABLE'}
            onChange={(event) => setActive(event.target.checked)}
            className="h-5 w-5"
          />
        </label>

        {invalidPolicy && (
          <div className="rounded-card-md border border-danger/35 bg-danger-bg p-3 text-xs font-black text-danger">
            크리스탈/무료 학생 직접 영입을 활성화하려면 먼저 편린 Master의 「조건 편집」에서 정책을 ACTIVE · 영입 가능으로 저장해야 합니다.
          </div>
        )}

        <div>
          <label className="text-xs font-black text-text-secondary">운영 메모</label>
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={3}
            maxLength={1000}
            placeholder="예: 시즌2 기본 판매가 / 특정 이벤트 종료 후 중지 예정"
            className="mt-1.5 w-full resize-none rounded-card-md border border-line bg-bg-deep px-3 py-2 text-xs font-semibold text-text-primary outline-none focus:border-brand-primary/60"
          />
        </div>

        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <button type="button" onClick={onClose} className="btn-secondary">취소</button>
          <button
            type="button"
            disabled={isLoading || invalidPolicy}
            onClick={() => void save()}
            className="btn-primary disabled:opacity-50"
          >
            {isLoading ? '저장 중...' : '영입 설정 저장'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function CharacterThumb({
  row,
  className,
}: {
  row: Pick<TeacherCharacterRecruitmentRow,'name'|'resource_kind'|'resource_url'|'emoji'|'card_image_url'|'full_image_url'>;
  className?: string;
}) {
  const image = row.card_image_url || row.full_image_url || row.resource_url;
  return (
    <div className={cn('h-14 w-14 flex-shrink-0 overflow-hidden rounded-card-md border border-line bg-bg-deep',className)}>
      {row.resource_kind === 'EMOJI' ? (
        <div className="flex h-full w-full items-center justify-center text-3xl">{row.emoji || '✦'}</div>
      ) : image ? (
        <img src={image} alt={row.name} className="h-full w-full object-contain" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-2xl text-text-muted">✦</div>
      )}
    </div>
  );
}

function RecruitmentStat({
  label,value,emoji,tone='primary',
}: {
  label: string;
  value: string | number;
  emoji: string;
  tone?: 'primary' | 'success' | 'crystal' | 'bv';
}) {
  const toneClass = {
    primary: 'text-brand-primary',
    success: 'text-success',
    crystal: 'text-crystal',
    bv: 'text-bv',
  }[tone];
  return (
    <div className="rounded-card-lg border border-line bg-bg-card p-3">
      <div className="flex items-center gap-2 text-[10px] font-black text-text-muted"><span>{emoji}</span>{label}</div>
      <div className={cn('mt-1 text-xl font-black',toneClass)}>{value}</div>
    </div>
  );
}

function MiniBadge({ label, tone }: { label: string; tone: 'success'|'warning'|'crystal'|'info'|'muted' }) {
  const styles = {
    success: 'border-success/30 bg-success/10 text-success',
    warning: 'border-warning/30 bg-warning/10 text-warning',
    crystal: 'border-crystal/30 bg-crystal/10 text-crystal',
    info: 'border-brand-primary/30 bg-brand-primary/10 text-brand-primary',
    muted: 'border-line bg-bg-deep text-text-secondary',
  };
  return <span className={cn('inline-flex rounded-pill border px-2 py-0.5 text-[9px] font-black',styles[tone])}>{label}</span>;
}

function modeLabel(mode: CharacterRecruitmentMode) {
  return {
    CRYSTAL: '크리스탈 영입',
    FREE: '무료 영입',
    TEACHER_ONLY: '교사 지급',
    EVENT_ONLY: '이벤트 전용',
    UNAVAILABLE: '미설정/중지',
  }[mode];
}

function filterLabel(filter: RecruitmentFilter) {
  return {
    ALL: '전체',
    ACTIVE: '활성 경로',
    UNCONFIGURED: '미설정',
    CRYSTAL: '크리스탈',
    FREE: '무료',
    SPECIAL: '특별 영입',
  }[filter];
}

function formatGold(value: number) {
  return Number(value).toLocaleString('ko-KR');
}

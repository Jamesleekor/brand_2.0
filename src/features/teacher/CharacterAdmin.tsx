import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { EmptyState, LoadingSpinner, Modal, useRpcCall } from '@/components/shared/components';
import { StatCard, TeacherShell } from '@/components/teacher/TeacherShell';
import { characterC3Rpc, type TeacherCharacterAdminBoard, type TeacherCharacterRow, type TeacherCharacterStudentRow } from '@/lib/rpc/character_c3_rpc';
import type { CharacterRequirementGroupInput, CharacterRequirementInput } from '@/lib/zod_schemas/character_c3_schemas';
import { supabase } from '@/lib/supabase/client';
import { useClassroomId } from '@/stores/auth_store';
import { formatRelativeTime } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';
import { CharacterCollectionAdminPanel } from './CharacterCollectionAdminPanel';
import { CharacterRecruitmentAdminPanel } from './CharacterRecruitmentAdminPanel';

// =====================================================================
// B.R.A.N.D 2.0 — Character Core C3 Teacher Operations UI
// 편린 Master / 영입 조건 / 학생 보유 / 영입 이력
// =====================================================================

type TabKey = 'MASTER' | 'RECRUITMENT' | 'COLLECTIONS' | 'STUDENTS' | 'EVENTS';
type MasterFilter = 'ALL' | 'ACTIVE' | 'INACTIVE' | 'DRAFT';

type MasterForm = {
  uid: string;
  name: string;
  epithet: string;
  description: string;
  resourceKind: 'EMOJI' | 'IMAGE' | 'ANIMATED_IMAGE';
  resourceUrl: string;
  emoji: string;
  fullImageUrl: string;
  cardImageUrl: string;
  avatarImageUrl: string;
  isActive: boolean;
  sortOrder: string;
};

type PolicyForm = {
  status: 'DRAFT' | 'ACTIVE' | 'INACTIVE';
  isRecruitable: boolean;
  requirementMode: 'NONE' | 'GROUPS';
  sourceConditionText: string;
  notes: string;
  groups: CharacterRequirementGroupInput[];
};

const TIER_NAMES = [
  '새싹','브론즈','빛나는 브론즈','거친 실버','성장한 실버','진화한 실버','은빛 극점',
  '금 광석','제련된 골드','정련된 골드','태양의 황금','루비 원석','연마된 루비','각성한 루비',
  '홍염의 정점','다이아 원석','세공된 다이아','무결 다이아','영원의 결정','마스터','천상의 마스터','그랜드마스터',
] as const;

const GRADES = ['희귀','유니크','에픽','히든','유일','초월'] as const;

export default function CharacterAdmin() {
  const classroomId = useClassroomId();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<TabKey>('MASTER');
  const [search, setSearch] = useState('');
  const [masterFilter, setMasterFilter] = useState<MasterFilter>('ALL');
  const [masterEditing, setMasterEditing] = useState<TeacherCharacterRow | 'NEW' | null>(null);
  const [policyEditing, setPolicyEditing] = useState<TeacherCharacterRow | null>(null);
  const [studentId, setStudentId] = useState<number | null>(null);

  const boardQuery = useQuery<TeacherCharacterAdminBoard>({
    queryKey: ['character-c3-admin-board', classroomId],
    queryFn: async () => {
      if (!classroomId) return { characters: [], students: [], events: [] };
      const result = await characterC3Rpc.board(supabase, classroomId, 150);
      if (result.success === false) throw new Error(result.error);
      return result.data ?? { characters: [], students: [], events: [] };
    },
    enabled: classroomId !== null,
  });

  const board = boardQuery.data;
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['character-c3-admin-board'] });

  useEffect(() => {
    if (!studentId && board?.students[0]) setStudentId(board.students[0].id);
  }, [board?.students, studentId]);

  const filteredCharacters = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase('ko-KR');
    return (board?.characters ?? []).filter((row) => {
      if (masterFilter === 'ACTIVE' && !row.is_active) return false;
      if (masterFilter === 'INACTIVE' && row.is_active) return false;
      if (masterFilter === 'DRAFT' && row.policy?.status !== 'DRAFT') return false;
      if (!needle) return true;
      return [row.character_uid,row.name,row.epithet,row.policy?.source_condition_text]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase('ko-KR').includes(needle));
    });
  }, [board?.characters, masterFilter, search]);

  const totalOwned = useMemo(
    () => (board?.students ?? []).reduce((sum, student) => sum + Number(student.owned_count ?? 0), 0),
    [board?.students],
  );
  const draftCount = useMemo(
    () => (board?.characters ?? []).filter((character) => character.policy?.status === 'DRAFT').length,
    [board?.characters],
  );
  const equippedCount = useMemo(
    () => (board?.students ?? []).filter((student) => student.equipped_character_id !== null).length,
    [board?.students],
  );

  return (
    <TeacherShell>
      <div className="space-y-5 pb-10">
        <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-1 text-xs font-black uppercase tracking-[0.16em] text-brand-primary">Character Core · C3–C4 · S1</div>
            <h1 className="font-display text-2xl text-brand-gradient tracking-tight">✦ 편린 운영</h1>
            <p className="mt-1 text-sm font-semibold text-text-secondary">
              편린 Master, 영입 가격·경로, 콜렉션·버프, 학생 보유권과 영입 이력을 한 곳에서 관리합니다.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void boardQuery.refetch()}
            className="btn-secondary self-start lg:self-auto"
          >
            ↻ 새로고침
          </button>
        </header>

        {boardQuery.isLoading || !board ? (
          <div className="flex min-h-[420px] items-center justify-center"><LoadingSpinner size="lg" /></div>
        ) : boardQuery.isError ? (
          <div className="rounded-card-lg border border-danger/40 bg-danger-bg p-6 text-center">
            <div className="text-3xl">⚠️</div>
            <h2 className="mt-2 font-display text-lg text-white">편린 운영 데이터를 불러오지 못했습니다</h2>
            <p className="mt-2 break-all text-xs text-text-primary">
              {boardQuery.error instanceof Error ? boardQuery.error.message : '알 수 없는 오류'}
            </p>
            <p className="mt-2 text-xs font-bold text-warning">C3 DB migration이 먼저 적용되어 있어야 합니다.</p>
          </div>
        ) : (
          <>
            <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard emoji="✦" label="편린 Master" value={board.characters.length} color="bv" />
              <StatCard emoji="⏳" label="정책 초안" value={draftCount} color={draftCount ? 'gold' : 'success'} />
              <StatCard emoji="🎒" label="전체 보유권" value={totalOwned} color="crystal" />
              <StatCard emoji="👤" label="장착 학생" value={`${equippedCount} / ${board.students.length}`} color="success" />
            </section>

            <nav className="flex gap-1 rounded-card-lg border border-line bg-bg-card p-1.5">
              <TabButton active={tab === 'MASTER'} onClick={() => setTab('MASTER')} label="편린 Master" icon="✦" />
              <TabButton active={tab === 'RECRUITMENT'} onClick={() => setTab('RECRUITMENT')} label="영입 설정" icon="🪙" />
              <TabButton active={tab === 'COLLECTIONS'} onClick={() => setTab('COLLECTIONS')} label="콜렉션 관리" icon="🧩" />
              <TabButton active={tab === 'STUDENTS'} onClick={() => setTab('STUDENTS')} label="학생 보유" icon="🎒" />
              <TabButton active={tab === 'EVENTS'} onClick={() => setTab('EVENTS')} label="영입 기록" icon="🧾" />
            </nav>

            {tab === 'MASTER' && (
              <MasterPanel
                rows={filteredCharacters}
                totalRows={board.characters.length}
                search={search}
                setSearch={setSearch}
                filter={masterFilter}
                setFilter={setMasterFilter}
                onCreate={() => setMasterEditing('NEW')}
                onEdit={setMasterEditing}
                onPolicy={setPolicyEditing}
              />
            )}

            {tab === 'RECRUITMENT' && classroomId !== null && (
              <CharacterRecruitmentAdminPanel classroomId={classroomId} />
            )}

            {tab === 'COLLECTIONS' && classroomId !== null && (
              <CharacterCollectionAdminPanel
                classroomId={classroomId}
                characters={board.characters}
                students={board.students}
              />
            )}

            {tab === 'STUDENTS' && (
              <StudentOwnershipPanel
                board={board}
                selectedStudentId={studentId}
                onSelectStudent={setStudentId}
                onChanged={refresh}
              />
            )}

            {tab === 'EVENTS' && <EventsPanel board={board} />}
          </>
        )}
      </div>

      <MasterEditorModal
        row={masterEditing}
        classroomId={classroomId}
        onClose={() => setMasterEditing(null)}
        onSaved={() => {
          setMasterEditing(null);
          refresh();
        }}
      />

      <PolicyEditorModal
        row={policyEditing}
        classroomId={classroomId}
        onClose={() => setPolicyEditing(null)}
        onSaved={() => {
          setPolicyEditing(null);
          refresh();
        }}
      />
    </TeacherShell>
  );
}

function TabButton({ active, onClick, label, icon }: { active: boolean; onClick: () => void; label: string; icon: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex flex-1 items-center justify-center gap-2 rounded-card-md px-3 py-2.5 text-xs font-black transition-all',
        active ? 'bg-brand-primary/20 text-white shadow-brand-sm' : 'text-text-secondary hover:bg-bg-deep hover:text-white',
      )}
    >
      <span>{icon}</span><span>{label}</span>
    </button>
  );
}

function MasterPanel({
  rows,totalRows,search,setSearch,filter,setFilter,onCreate,onEdit,onPolicy,
}: {
  rows: TeacherCharacterRow[];
  totalRows: number;
  search: string;
  setSearch: (value: string) => void;
  filter: MasterFilter;
  setFilter: (value: MasterFilter) => void;
  onCreate: () => void;
  onEdit: (row: TeacherCharacterRow) => void;
  onPolicy: (row: TeacherCharacterRow) => void;
}) {
  return (
    <section className="space-y-3">
      <div className="flex flex-col gap-3 rounded-card-lg border border-line bg-bg-card p-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex gap-1.5 overflow-x-auto">
          {(['ALL','ACTIVE','INACTIVE','DRAFT'] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={cn(
                'flex-shrink-0 rounded-pill border px-3 py-2 text-xs font-black',
                filter === key ? 'border-brand-primary/50 bg-brand-primary/20 text-white' : 'border-line bg-bg-deep text-text-secondary',
              )}
            >
              {key === 'ALL' ? '전체' : key === 'ACTIVE' ? 'Master 활성' : key === 'INACTIVE' ? 'Master 비활성' : '정책 초안'}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="UID · 이름 · 조건 검색"
            className="min-w-0 flex-1 rounded-card-md border border-line bg-bg-deep px-3 py-2 text-xs font-bold text-text-primary outline-none focus:border-brand-primary/60 lg:w-64"
          />
          <button type="button" onClick={onCreate} className="btn-primary whitespace-nowrap">+ 새 편린</button>
        </div>
      </div>

      <div className="overflow-hidden rounded-card-lg border border-line bg-bg-card">
        <div className="border-b border-line px-4 py-2 text-[11px] font-bold text-text-muted">
          {rows.length} / {totalRows}종 표시 · 조건 충족 인원은 현재 학생 데이터로 즉시 계산됩니다.
        </div>
        {rows.length === 0 ? (
          <EmptyState emoji="✦" title="조건에 맞는 편린이 없습니다" description="검색어나 필터를 바꿔보세요." />
        ) : (
          <div className="divide-y divide-line">
            {rows.map((row) => (
              <CharacterAdminRow key={row.id} row={row} onEdit={() => onEdit(row)} onPolicy={() => onPolicy(row)} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function CharacterAdminRow({ row, onEdit, onPolicy }: { row: TeacherCharacterRow; onEdit: () => void; onPolicy: () => void }) {
  const policy = row.policy;
  const pct = row.total_students > 0 ? Math.round((row.eligible_students / row.total_students) * 100) : 0;
  return (
    <div className="grid gap-3 px-3 py-3 hover:bg-bg-deep/35 lg:grid-cols-[56px_minmax(190px,1.3fr)_minmax(240px,1.5fr)_140px_120px_auto] lg:items-center lg:px-4">
      <CharacterThumb row={row} />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-[10px] font-black text-text-muted">{row.character_uid}</span>
          {!row.is_active && <Badge label="Master 비활성" tone="muted" />}
          {policy?.status === 'DRAFT' && <Badge label="정책 초안" tone="warning" />}
          {policy?.status === 'INACTIVE' && <Badge label="영입 중지" tone="muted" />}
        </div>
        <div className="mt-0.5 truncate text-sm font-black text-white">{row.name}</div>
        <div className="truncate text-[11px] font-semibold text-text-secondary">{row.epithet ?? '이명 없음'}</div>
      </div>
      <div className="min-w-0">
        <div className="text-[10px] font-black uppercase tracking-wide text-text-muted">현재 영입 조건</div>
        <div className="mt-0.5 truncate text-xs font-bold text-text-primary">
          {policy?.status === 'DRAFT' ? '영입 정책 준비 중' : policy?.source_condition_text || (policy?.requirement_mode === 'NONE' ? '조건 없음' : '조건 설명 미입력')}
        </div>
        <div className="mt-1 flex gap-1.5">
          <Badge label={policy?.is_recruitable ? '영입 가능' : '영입 불가'} tone={policy?.is_recruitable ? 'success' : 'muted'} />
          {policy?.is_source_baseline && <Badge label="기존 기준" tone="info" />}
        </div>
      </div>
      <div>
        <div className="text-[10px] font-black text-text-muted">조건 충족</div>
        <div className="mt-0.5 text-sm font-black text-brand-primary">{row.eligible_students} / {row.total_students}</div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-pill bg-bg-deep">
          <div className="h-full rounded-pill bg-brand-primary" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <div className="flex gap-3 lg:block">
        <div>
          <div className="text-[10px] font-black text-text-muted">보유</div>
          <div className="text-sm font-black text-crystal">{row.owned_students}명</div>
        </div>
        <div className="lg:mt-1">
          <div className="text-[10px] font-black text-text-muted">장착</div>
          <div className="text-xs font-black text-gold">{row.equipped_students}명</div>
        </div>
      </div>
      <div className="flex gap-1.5 lg:justify-end">
        <button type="button" onClick={onPolicy} className="btn-secondary px-3 py-2 text-[11px]">조건 편집</button>
        <button type="button" onClick={onEdit} className="btn-secondary px-3 py-2 text-[11px]">Master 수정</button>
      </div>
    </div>
  );
}

function CharacterThumb({ row, className }: { row: Pick<TeacherCharacterRow,'name'|'resource_kind'|'resource_url'|'emoji'|'card_image_url'|'full_image_url'>; className?: string }) {
  const imageUrl = row.card_image_url || row.full_image_url || row.resource_url;
  return (
    <div className={cn('h-14 w-14 overflow-hidden rounded-card-md border border-line bg-bg-deep', className)}>
      {row.resource_kind === 'EMOJI' ? (
        <div className="flex h-full w-full items-center justify-center text-3xl">{row.emoji || '✦'}</div>
      ) : imageUrl ? (
        <img src={imageUrl} alt={row.name} className="h-full w-full object-contain" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-xl text-text-muted">✦</div>
      )}
    </div>
  );
}

function StudentOwnershipPanel({
  board,selectedStudentId,onSelectStudent,onChanged,
}: {
  board: TeacherCharacterAdminBoard;
  selectedStudentId: number | null;
  onSelectStudent: (id: number) => void;
  onChanged: () => void;
}) {
  const [characterSearch, setCharacterSearch] = useState('');
  const [reason, setReason] = useState('');
  const [ownedOnly, setOwnedOnly] = useState(false);
  const selected = board.students.find((student) => student.id === selectedStudentId) ?? board.students[0] ?? null;
  const { call, isLoading } = useRpcCall();
  const ownedSet = useMemo(() => new Set(selected?.owned_character_ids ?? []), [selected?.owned_character_ids]);
  const characters = useMemo(() => {
    const needle = characterSearch.trim().toLocaleLowerCase('ko-KR');
    return board.characters.filter((character) => {
      if (ownedOnly && !ownedSet.has(character.id)) return false;
      if (!needle) return true;
      return [character.character_uid,character.name,character.epithet].filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase('ko-KR').includes(needle));
    });
  }, [board.characters, characterSearch, ownedOnly, ownedSet]);

  const mutate = async (character: TeacherCharacterRow, owned: boolean) => {
    if (!selected || isLoading) return;
    const action = owned ? '회수' : '지급';
    if (!confirm(`${selected.name} 학생의 「${character.name}」 편린을 ${action}할까요?`)) return;
    const note = reason.trim() || `C3 교사 직접 ${action}`;
    const options = {
      successTitle: `편린 ${action} 완료`,
      successDescription: `${selected.name} · ${character.name}`,
      onSuccess: () => {
        setReason('');
        onChanged();
      },
    };

    if (owned) {
      await call(() => characterC3Rpc.revoke(supabase, selected.id, character.id, note), options);
    } else {
      await call(() => characterC3Rpc.grant(supabase, selected.id, character.id, note), options);
    }
  };

  return (
    <section className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
      <div className="overflow-hidden rounded-card-lg border border-line bg-bg-card">
        <div className="border-b border-line p-3">
          <div className="text-xs font-black text-white">학생 선택</div>
          <div className="mt-0.5 text-[10px] font-bold text-text-muted">보유 수와 현재 장착 편린을 확인합니다.</div>
        </div>
        <div className="max-h-[620px] overflow-y-auto p-2">
          {board.students.map((student) => {
            const equipped = board.characters.find((character) => character.id === student.equipped_character_id);
            return (
              <button
                key={student.id}
                type="button"
                onClick={() => onSelectStudent(student.id)}
                className={cn(
                  'mb-1 w-full rounded-card-md border px-3 py-2.5 text-left transition-all',
                  selected?.id === student.id ? 'border-brand-primary/50 bg-brand-primary/15' : 'border-transparent hover:border-line hover:bg-bg-deep',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-black text-white">{student.name}</div>
                    <div className="truncate text-[10px] font-bold text-text-secondary">{student.brand_name ?? '브랜드명 없음'}</div>
                  </div>
                  <Badge label={`${student.owned_count}종`} tone="info" />
                </div>
                <div className="mt-1 truncate text-[10px] font-bold text-gold">장착: {equipped?.name ?? '없음'}</div>
              </button>
            );
          })}
        </div>
      </div>

      {!selected ? (
        <EmptyState emoji="🎒" title="학생이 없습니다" />
      ) : (
        <div className="space-y-3">
          <div className="rounded-card-lg border border-line bg-bg-card p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="font-display text-lg text-white">{selected.name} · 편린 보유 관리</h2>
                <p className="text-xs font-bold text-text-secondary">
                  보유 {selected.owned_count}종 · 장착 {board.characters.find((character) => character.id === selected.equipped_character_id)?.name ?? '없음'}
                </p>
              </div>
              <label className="flex items-center gap-2 text-xs font-black text-text-secondary">
                <input type="checkbox" checked={ownedOnly} onChange={(event) => setOwnedOnly(event.target.checked)} />
                보유 편린만
              </label>
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-[1fr_1fr]">
              <input
                value={characterSearch}
                onChange={(event) => setCharacterSearch(event.target.value)}
                placeholder="편린 검색"
                className="rounded-card-md border border-line bg-bg-deep px-3 py-2 text-xs font-bold text-text-primary outline-none focus:border-brand-primary/60"
              />
              <input
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="지급/회수 사유 (선택)"
                className="rounded-card-md border border-line bg-bg-deep px-3 py-2 text-xs font-bold text-text-primary outline-none focus:border-brand-primary/60"
              />
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {characters.map((character) => {
              const owned = ownedSet.has(character.id);
              const equipped = selected.equipped_character_id === character.id;
              return (
                <div key={character.id} className={cn('rounded-card-lg border bg-bg-card p-3', equipped ? 'border-gold/50' : owned ? 'border-success/35' : 'border-line')}>
                  <div className="flex gap-3">
                    <CharacterThumb row={character} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[10px] font-black text-text-muted">{character.character_uid}</div>
                      <div className="truncate text-sm font-black text-white">{character.name}</div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <Badge label={owned ? '보유' : '미보유'} tone={owned ? 'success' : 'muted'} />
                        {equipped && <Badge label="장착 중" tone="warning" />}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={isLoading}
                    onClick={() => void mutate(character, owned)}
                    className={cn(
                      'mt-3 w-full rounded-card-md border px-3 py-2 text-xs font-black disabled:opacity-50',
                      owned ? 'border-danger/30 bg-danger-bg text-danger' : 'border-success/30 bg-success-bg text-success',
                    )}
                  >
                    {owned ? '편린 회수' : '편린 지급'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

function EventsPanel({ board }: { board: TeacherCharacterAdminBoard }) {
  const [search, setSearch] = useState('');
  const [type, setType] = useState('ALL');
  const rows = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase('ko-KR');
    return board.events.filter((event) => {
      if (type !== 'ALL' && event.event_type !== type) return false;
      if (!needle) return true;
      return [event.student_name,event.brand_name,event.character_name,event.character_uid,event.reason]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase('ko-KR').includes(needle));
    });
  }, [board.events, search, type]);

  return (
    <section className="overflow-hidden rounded-card-lg border border-line bg-bg-card">
      <div className="flex flex-col gap-2 border-b border-line p-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-sm font-black text-white">영입·지급·회수 이력</h2>
          <p className="text-[10px] font-bold text-text-muted">최근 {board.events.length}건 · audit 기록은 학생 보유 상태와 별도로 보존됩니다.</p>
        </div>
        <div className="flex gap-2">
          <select value={type} onChange={(event) => setType(event.target.value)} className="rounded-card-md border border-line bg-bg-deep px-2 py-2 text-xs font-bold text-text-primary">
            <option value="ALL">전체 유형</option>
            <option value="RECRUIT">영입</option>
            <option value="TEACHER_GRANT">교사 지급</option>
            <option value="RESTORE">재지급</option>
            <option value="REVOKE">회수</option>
            <option value="MIGRATION">이관</option>
          </select>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="학생·편린·사유 검색" className="min-w-0 rounded-card-md border border-line bg-bg-deep px-3 py-2 text-xs font-bold text-text-primary outline-none" />
        </div>
      </div>
      {rows.length === 0 ? (
        <EmptyState emoji="🧾" title="표시할 영입 기록이 없습니다" description="학생에게 편린을 지급하거나 회수하면 여기에 기록됩니다." />
      ) : (
        <div className="divide-y divide-line">
          {rows.map((event) => (
            <div key={event.id} className="grid gap-2 px-4 py-3 md:grid-cols-[130px_1fr_1fr_minmax(180px,1.5fr)] md:items-center">
              <div>
                <Badge label={eventTypeLabel(event.event_type)} tone={event.event_type === 'REVOKE' ? 'danger' : 'info'} />
                <div className="mt-1 text-[10px] font-bold text-text-muted">{formatRelativeTime(event.created_at)}</div>
              </div>
              <div>
                <div className="text-xs font-black text-white">{event.student_name}</div>
                <div className="text-[10px] font-bold text-text-muted">{event.brand_name ?? '브랜드명 없음'}</div>
              </div>
              <div>
                <div className="text-xs font-black text-text-primary">{event.character_name}</div>
                <div className="font-mono text-[10px] font-bold text-text-muted">{event.character_uid}</div>
              </div>
              <div className="text-xs font-semibold text-text-secondary">{event.reason || '사유 없음'}</div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function MasterEditorModal({
  row,classroomId,onClose,onSaved,
}: {
  row: TeacherCharacterRow | 'NEW' | null;
  classroomId: number | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { call, isLoading } = useRpcCall();
  const [form, setForm] = useState<MasterForm>(() => blankMasterForm());
  const isNew = row === 'NEW';

  useEffect(() => {
    if (!row) return;
    if (row === 'NEW') {
      setForm(blankMasterForm());
      void call(() => characterC3Rpc.suggestUid(supabase), {
        silent: true,
        onSuccess: (uid) => setForm((current) => ({ ...current, uid })),
      });
      return;
    }
    setForm(masterFormFromRow(row));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row]);

  const save = async () => {
    if (!row || !classroomId) return;
    const common = {
      p_name: form.name.trim(),
      p_epithet: form.epithet.trim() || null,
      p_description: form.description.trim() || null,
      p_resource_kind: form.resourceKind,
      p_resource_url: form.resourceUrl.trim() || null,
      p_emoji: form.emoji.trim() || null,
      p_full_image_url: form.fullImageUrl.trim() || null,
      p_card_image_url: form.cardImageUrl.trim() || null,
      p_avatar_image_url: form.avatarImageUrl.trim() || null,
      p_is_active: form.isActive,
      p_sort_order: Math.max(0, Math.trunc(Number(form.sortOrder) || 0)),
    } as const;

    if (row === 'NEW') {
      await call(
        () => characterC3Rpc.createCharacter(supabase, {
          ...common,
          p_classroom_id: classroomId,
          p_character_uid: form.uid.trim().toUpperCase(),
        }),
        {
          successTitle: '새 편린 생성 완료',
          successDescription: form.name.trim(),
          onSuccess: onSaved,
        },
      );
      return;
    }

    await call(
      () => characterC3Rpc.updateCharacter(supabase, { ...common, p_character_id: row.id }),
      {
        successTitle: '편린 Master 수정 완료',
        successDescription: form.name.trim(),
        onSuccess: onSaved,
      },
    );
  };

  return (
    <Modal isOpen={row !== null} onClose={onClose} title={isNew ? '새 편린 Master' : '편린 Master 수정'} emoji="✦" size="lg">
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="UID" help={isNew ? '생성 후 변경할 수 없습니다.' : '기존 UID는 수정하지 않습니다.'}>
            <input disabled={!isNew} value={form.uid} onChange={(event) => setForm((value) => ({ ...value, uid: event.target.value }))} className="input-admin disabled:opacity-60" />
          </Field>
          <Field label="정렬 순서">
            <input type="number" min={0} value={form.sortOrder} onChange={(event) => setForm((value) => ({ ...value, sortOrder: event.target.value }))} className="input-admin" />
          </Field>
          <Field label="편린 이름">
            <input value={form.name} onChange={(event) => setForm((value) => ({ ...value, name: event.target.value }))} className="input-admin" placeholder="아스텔" />
          </Field>
          <Field label="이명">
            <input value={form.epithet} onChange={(event) => setForm((value) => ({ ...value, epithet: event.target.value }))} className="input-admin" placeholder="은하수의 마법사" />
          </Field>
        </div>
        <Field label="설명">
          <textarea value={form.description} onChange={(event) => setForm((value) => ({ ...value, description: event.target.value }))} className="input-admin min-h-20 resize-y" placeholder="편린 도감에서 사용할 간단한 설명" />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="리소스 종류">
            <select value={form.resourceKind} onChange={(event) => setForm((value) => ({ ...value, resourceKind: event.target.value as MasterForm['resourceKind'] }))} className="input-admin">
              <option value="IMAGE">IMAGE</option><option value="ANIMATED_IMAGE">ANIMATED IMAGE</option><option value="EMOJI">EMOJI</option>
            </select>
          </Field>
          {form.resourceKind === 'EMOJI' ? (
            <Field label="이모지"><input value={form.emoji} onChange={(event) => setForm((value) => ({ ...value, emoji: event.target.value }))} className="input-admin" placeholder="🐉" /></Field>
          ) : (
            <Field label="기본 이미지 URL"><input value={form.resourceUrl} onChange={(event) => setForm((value) => ({ ...value, resourceUrl: event.target.value }))} className="input-admin" /></Field>
          )}
        </div>
        {form.resourceKind !== 'EMOJI' && (
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="전체 이미지 URL" help="비우면 기본 URL 사용"><input value={form.fullImageUrl} onChange={(event) => setForm((value) => ({ ...value, fullImageUrl: event.target.value }))} className="input-admin" /></Field>
            <Field label="카드 이미지 URL" help="비우면 기본 URL 사용"><input value={form.cardImageUrl} onChange={(event) => setForm((value) => ({ ...value, cardImageUrl: event.target.value }))} className="input-admin" /></Field>
            <Field label="아바타 이미지 URL" help="랭킹/헤더 전용 crop"><input value={form.avatarImageUrl} onChange={(event) => setForm((value) => ({ ...value, avatarImageUrl: event.target.value }))} className="input-admin" /></Field>
          </div>
        )}
        <label className="flex items-center gap-2 rounded-card-md border border-line bg-bg-deep p-3 text-xs font-black text-text-primary">
          <input type="checkbox" checked={form.isActive} onChange={(event) => setForm((value) => ({ ...value, isActive: event.target.checked }))} />
          Master 활성 — 끄면 학생 편린 도감에서도 숨겨집니다.
        </label>
        <div className="rounded-card-md border border-warning/25 bg-warning-bg p-3 text-[11px] font-bold text-text-primary">
          가격과 실제 상점 판매 설정은 Character Master가 아니라 이후 Shop Core에서 관리합니다.
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary">취소</button>
          <button type="button" disabled={isLoading} onClick={() => void save()} className="btn-primary disabled:opacity-50">{isLoading ? '저장 중…' : '저장'}</button>
        </div>
      </div>
    </Modal>
  );
}

function PolicyEditorModal({
  row,classroomId,onClose,onSaved,
}: {
  row: TeacherCharacterRow | null;
  classroomId: number | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { call, isLoading } = useRpcCall();
  const [form, setForm] = useState<PolicyForm>(() => blankPolicyForm());

  useEffect(() => {
    if (row) setForm(policyFormFromRow(row));
  }, [row]);

  const setMode = (mode: PolicyForm['requirementMode']) => {
    setForm((value) => ({
      ...value,
      requirementMode: mode,
      groups: mode === 'NONE' ? [] : value.groups.length ? value.groups : [newRequirementGroup()],
    }));
  };

  const addGroup = () => setForm((value) => ({ ...value, groups: [...value.groups,newRequirementGroup()] }));
  const removeGroup = (groupIndex: number) => setForm((value) => ({ ...value, groups: value.groups.filter((_, index) => index !== groupIndex) }));
  const addRequirement = (groupIndex: number) => setForm((value) => ({
    ...value,
    groups: value.groups.map((group,index) => index === groupIndex ? { ...group, requirements: [...group.requirements,newRequirement()] } : group),
  }));
  const updateRequirement = (groupIndex: number, reqIndex: number, patch: Partial<CharacterRequirementInput>) => setForm((value) => ({
    ...value,
    groups: value.groups.map((group,index) => index === groupIndex ? {
      ...group,
      requirements: group.requirements.map((req,rIndex) => rIndex === reqIndex ? { ...req,...patch } : req),
    } : group),
  }));
  const removeRequirement = (groupIndex: number, reqIndex: number) => setForm((value) => ({
    ...value,
    groups: value.groups.map((group,index) => index === groupIndex ? { ...group, requirements: group.requirements.filter((_,rIndex) => rIndex !== reqIndex) } : group),
  }));

  const derivedText = useMemo(() => buildPolicyText(form), [form]);

  const save = async () => {
    if (!row || !classroomId) return;
    await call(
      () => characterC3Rpc.setPolicy(supabase, {
        p_classroom_id: classroomId,
        p_character_id: row.id,
        p_status: form.status,
        p_is_recruitable: form.isRecruitable,
        p_requirement_mode: form.requirementMode,
        p_source_condition_text: form.sourceConditionText.trim() || derivedText || null,
        p_groups: form.requirementMode === 'NONE' ? [] : form.groups,
        p_notes: form.notes.trim() || null,
      }),
      {
        successTitle: '영입 정책 저장 완료',
        successDescription: `${row.name} · ${form.sourceConditionText.trim() || derivedText || '조건 없음'}`,
        onSuccess: onSaved,
      },
    );
  };

  return (
    <Modal isOpen={row !== null} onClose={onClose} title={`${row?.name ?? ''} · 영입 조건`} emoji="🔐" size="full">
      <div className="mx-auto max-w-4xl space-y-4">
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="정책 상태">
            <select value={form.status} onChange={(event) => {
              const status = event.target.value as PolicyForm['status'];
              setForm((value) => ({ ...value, status, isRecruitable: status === 'ACTIVE' ? true : value.isRecruitable }));
            }} className="input-admin">
              <option value="ACTIVE">ACTIVE · 운영</option><option value="DRAFT">DRAFT · 준비</option><option value="INACTIVE">INACTIVE · 중지</option>
            </select>
          </Field>
          <Field label="조건 방식">
            <select value={form.requirementMode} onChange={(event) => setMode(event.target.value as PolicyForm['requirementMode'])} className="input-admin">
              <option value="NONE">조건 없음</option><option value="GROUPS">조건 그룹</option>
            </select>
          </Field>
          <Field label="현재 충족 인원">
            <div className="input-admin flex items-center text-brand-primary">{row?.eligible_students ?? 0} / {row?.total_students ?? 0}명</div>
          </Field>
        </div>

        <label className="flex items-center gap-2 rounded-card-md border border-line bg-bg-deep p-3 text-xs font-black text-text-primary">
          <input
            type="checkbox"
            checked={form.isRecruitable}
            disabled={form.status === 'ACTIVE'}
            onChange={(event) => setForm((value) => ({ ...value, isRecruitable: event.target.checked }))}
          />
          영입 가능 상태
          {form.status === 'ACTIVE' && <span className="text-[10px] font-bold text-text-muted">ACTIVE 정책은 자동으로 ON입니다.</span>}
        </label>

        {form.requirementMode === 'GROUPS' ? (
          <div className="space-y-3">
            <div className="rounded-card-md border border-bv/30 bg-bv/10 p-3 text-xs font-bold text-text-primary">
              <b>그룹끼리는 OR</b>, 같은 그룹 안 조건끼리는 <b>AND</b>입니다. 예: (업적 40개 AND 유니크 8개) <b>OR</b> (에픽 3개).
            </div>
            {form.groups.map((group, groupIndex) => (
              <div key={groupIndex} className="rounded-card-lg border border-line bg-bg-card p-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-black text-brand-primary">조건 그룹 {String.fromCharCode(65 + groupIndex)}</div>
                    <div className="text-[10px] font-bold text-text-muted">이 그룹 안의 모든 조건을 동시에 충족해야 합니다.</div>
                  </div>
                  {form.groups.length > 1 && <button type="button" onClick={() => removeGroup(groupIndex)} className="text-xs font-black text-danger">그룹 삭제</button>}
                </div>
                <div className="space-y-2">
                  {group.requirements.map((req, reqIndex) => (
                    <RequirementEditor
                      key={reqIndex}
                      requirement={req}
                      canDelete={group.requirements.length > 1}
                      onChange={(patch) => updateRequirement(groupIndex,reqIndex,patch)}
                      onDelete={() => removeRequirement(groupIndex,reqIndex)}
                    />
                  ))}
                </div>
                <button type="button" onClick={() => addRequirement(groupIndex)} className="mt-3 rounded-card-md border border-line px-3 py-2 text-xs font-black text-text-secondary hover:text-white">+ AND 조건 추가</button>
              </div>
            ))}
            <button type="button" onClick={addGroup} className="w-full rounded-card-md border border-brand-primary/35 bg-brand-primary/10 px-3 py-3 text-xs font-black text-brand-primary">+ OR 조건 그룹 추가</button>
          </div>
        ) : (
          <div className="rounded-card-lg border border-success/25 bg-success-bg p-4 text-sm font-bold text-text-primary">별도 달성 조건 없이 영입 가능한 정책입니다.</div>
        )}

        <div className="grid gap-3 md:grid-cols-2">
          <Field label="학생 표시용 조건 문구" help={`자동 생성: ${derivedText || '조건 없음'}`}>
            <input value={form.sourceConditionText} onChange={(event) => setForm((value) => ({ ...value, sourceConditionText: event.target.value }))} placeholder={derivedText || '조건 없음'} className="input-admin" />
          </Field>
          <Field label="교사 메모">
            <input value={form.notes} onChange={(event) => setForm((value) => ({ ...value, notes: event.target.value }))} className="input-admin" placeholder="예: 시즌2 조건 상향" />
          </Field>
        </div>

        <div className="rounded-card-md border border-gold/25 bg-gold/5 p-3">
          <div className="text-[10px] font-black uppercase tracking-wide text-gold">저장될 조건</div>
          <div className="mt-1 text-sm font-black text-white">{form.sourceConditionText.trim() || derivedText || '조건 없음'}</div>
          <div className="mt-1 text-[11px] font-bold text-text-secondary">저장 후 현재 학생 25명의 충족 인원이 자동으로 다시 계산됩니다.</div>
        </div>

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary">취소</button>
          <button type="button" disabled={isLoading} onClick={() => void save()} className="btn-primary disabled:opacity-50">{isLoading ? '저장 중…' : '영입 정책 저장'}</button>
        </div>
      </div>
    </Modal>
  );
}

function RequirementEditor({
  requirement,canDelete,onChange,onDelete,
}: {
  requirement: CharacterRequirementInput;
  canDelete: boolean;
  onChange: (patch: Partial<CharacterRequirementInput>) => void;
  onDelete: () => void;
}) {
  return (
    <div className="grid gap-2 rounded-card-md border border-line bg-bg-deep p-3 md:grid-cols-[1.3fr_1fr_110px_auto] md:items-center">
      <select
        value={requirement.type}
        onChange={(event) => {
          const type = event.target.value as CharacterRequirementInput['type'];
          onChange({ type, grade: type === 'ACHIEVEMENT_GRADE_COUNT' ? (requirement.grade || '희귀') : null, required_numeric: type === 'TIER_AT_LEAST' ? Math.min(requirement.required_numeric,22) : requirement.required_numeric });
        }}
        className="input-admin"
      >
        <option value="ACHIEVEMENT_COUNT">총 업적 수</option>
        <option value="ACHIEVEMENT_GRADE_COUNT">등급별 업적 수</option>
        <option value="TIER_AT_LEAST">티어 이상</option>
      </select>
      {requirement.type === 'ACHIEVEMENT_GRADE_COUNT' ? (
        <select value={requirement.grade ?? '희귀'} onChange={(event) => onChange({ grade: event.target.value as CharacterRequirementInput['grade'] })} className="input-admin">
          {GRADES.map((grade) => <option key={grade} value={grade}>{grade}</option>)}
        </select>
      ) : requirement.type === 'TIER_AT_LEAST' ? (
        <select value={requirement.required_numeric} onChange={(event) => onChange({ required_numeric: Number(event.target.value) })} className="input-admin">
          {TIER_NAMES.map((tier,index) => <option key={tier} value={index + 1}>{index + 1}. {tier}</option>)}
        </select>
      ) : <div className="hidden md:block text-[11px] font-bold text-text-muted">누적 획득 업적</div>}
      {requirement.type !== 'TIER_AT_LEAST' ? (
        <input type="number" min={1} value={requirement.required_numeric} onChange={(event) => onChange({ required_numeric: Math.max(1,Number(event.target.value) || 1) })} className="input-admin" />
      ) : <div className="text-center text-xs font-black text-brand-primary">{TIER_NAMES[requirement.required_numeric - 1]}</div>}
      <button type="button" disabled={!canDelete} onClick={onDelete} className="rounded-card-md px-2 py-2 text-xs font-black text-danger disabled:opacity-20">✕</button>
    </div>
  );
}

function Field({ label, help, children }: { label: string; help?: string; children: ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1 flex items-end justify-between gap-2">
        <span className="text-[11px] font-black text-text-secondary">{label}</span>
        {help && <span className="truncate text-[9px] font-bold text-text-muted">{help}</span>}
      </div>
      {children}
    </label>
  );
}

function Badge({ label, tone }: { label: string; tone: 'success' | 'warning' | 'danger' | 'info' | 'muted' }) {
  const toneClass = {
    success: 'border-success/30 bg-success-bg text-success',
    warning: 'border-warning/30 bg-warning-bg text-warning',
    danger: 'border-danger/30 bg-danger-bg text-danger',
    info: 'border-bv/30 bg-bv/10 text-bv',
    muted: 'border-line bg-bg-deep text-text-muted',
  }[tone];
  return <span className={cn('inline-flex rounded-pill border px-2 py-0.5 text-[9px] font-black',toneClass)}>{label}</span>;
}

function blankMasterForm(): MasterForm {
  return {
    uid: '',name: '',epithet: '',description: '',resourceKind: 'IMAGE',resourceUrl: '',emoji: '',
    fullImageUrl: '',cardImageUrl: '',avatarImageUrl: '',isActive: true,sortOrder: '40',
  };
}

function masterFormFromRow(row: TeacherCharacterRow): MasterForm {
  return {
    uid: row.character_uid,
    name: row.name,
    epithet: row.epithet ?? '',
    description: row.description ?? '',
    resourceKind: row.resource_kind,
    resourceUrl: row.resource_url ?? '',
    emoji: row.emoji ?? '',
    fullImageUrl: row.full_image_url ?? '',
    cardImageUrl: row.card_image_url ?? '',
    avatarImageUrl: row.avatar_image_url ?? '',
    isActive: row.is_active,
    sortOrder: String(row.sort_order),
  };
}

function blankPolicyForm(): PolicyForm {
  return { status: 'DRAFT',isRecruitable: false,requirementMode: 'NONE',sourceConditionText: '',notes: '',groups: [] };
}

function policyFormFromRow(row: TeacherCharacterRow): PolicyForm {
  const policy = row.policy;
  if (!policy) return blankPolicyForm();
  return {
    status: policy.status,
    isRecruitable: policy.is_recruitable,
    requirementMode: policy.requirement_mode,
    sourceConditionText: policy.source_condition_text ?? '',
    notes: policy.notes ?? '',
    groups: policy.groups.map((group) => ({
      label: group.label,
      requirements: group.requirements.map((requirement) => ({
        type: requirement.requirement_type,
        grade: (requirement.achievement_grade as CharacterRequirementInput['grade']) ?? null,
        required_numeric: Number(requirement.required_numeric),
      })),
    })),
  };
}

function newRequirement(): CharacterRequirementInput {
  return { type: 'ACHIEVEMENT_COUNT',grade: null,required_numeric: 30 };
}

function newRequirementGroup(): CharacterRequirementGroupInput {
  return { label: null,requirements: [newRequirement()] };
}

function buildPolicyText(form: PolicyForm): string {
  if (form.requirementMode === 'NONE') return '조건 없음';
  return form.groups.map((group) => {
    const text = group.requirements.map(requirementText).join(' AND ');
    return group.requirements.length > 1 ? `(${text})` : text;
  }).join(' OR ');
}

function requirementText(req: CharacterRequirementInput): string {
  if (req.type === 'ACHIEVEMENT_COUNT') return `업적 ${req.required_numeric}개 이상`;
  if (req.type === 'ACHIEVEMENT_GRADE_COUNT') return `${req.grade ?? '등급'} 업적 ${req.required_numeric}개 이상`;
  return `${TIER_NAMES[Math.max(0,Math.min(21,req.required_numeric - 1))]} 이상`;
}

function eventTypeLabel(type: string): string {
  return ({ RECRUIT: '영입',TEACHER_GRANT: '교사 지급',RESTORE: '재지급',REVOKE: '회수',MIGRATION: '이관' } as Record<string,string>)[type] ?? type;
}

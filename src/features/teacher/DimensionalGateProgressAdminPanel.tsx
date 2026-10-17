import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { EmptyState, LoadingSpinner } from '@/components/shared/components';
import { resolveAssetUrl } from '@/lib/assets/asset_urls';
import {
  dimensionalGateTeacherRpc,
  type DimensionalGateTeacherProgressCharacter,
  type DimensionalGateTeacherProgressEpisode,
  type DimensionalGateTeacherProgressRow,
} from '@/lib/rpc/dimensional_gate_teacher_rpc';
import { supabase } from '@/lib/supabase/client';
import { cn } from '@/lib/utils/cn';

type ProgressFilter = 'ALL' | 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETE';
type PairStatus = 'UNOWNED' | 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETE';

interface SelectedPair {
  studentId: number;
  characterId: number;
}

const FILTER_LABEL: Record<ProgressFilter, string> = {
  ALL: '전체',
  NOT_STARTED: '미시작',
  IN_PROGRESS: '진행 중',
  COMPLETE: '전편 완료',
};

export function DimensionalGateProgressAdminPanel({ classroomId }: { classroomId: number }) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<ProgressFilter>('ALL');
  const [characterFilter, setCharacterFilter] = useState<number | 'ALL'>('ALL');
  const [includeTestAccounts, setIncludeTestAccounts] = useState(false);
  const [selected, setSelected] = useState<SelectedPair | null>(null);

  const query = useQuery({
    queryKey: ['dimensional-gate-progress-board', classroomId],
    queryFn: async () => {
      const result = await dimensionalGateTeacherRpc.progressBoard(supabase, classroomId);
      if (result.success === false) throw new Error(result.error);
      return result.data;
    },
    enabled: classroomId > 0,
    staleTime: 10_000,
    retry: 1,
  });

  const board = query.data;
  const progressByPair = useMemo(() => {
    const map = new Map<string, DimensionalGateTeacherProgressRow>();
    (board?.progress ?? []).forEach((row) => map.set(pairKey(row.student_id, row.character_id), row));
    return map;
  }, [board?.progress]);

  const visibleCharacters = useMemo(
    () => (board?.characters ?? []).filter((character) => characterFilter === 'ALL' || character.character_id === characterFilter),
    [board?.characters, characterFilter],
  );

  const baseStudents = useMemo(
    () => (board?.students ?? []).filter((student) => includeTestAccounts || !student.is_test_account),
    [board?.students, includeTestAccounts],
  );

  const visibleStudents = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase('ko-KR');
    return baseStudents.filter((student) => {
      if (needle && ![student.name, student.brand_name ?? ''].some((value) => value.toLocaleLowerCase('ko-KR').includes(needle))) {
        return false;
      }
      if (filter === 'ALL') return true;
      return visibleCharacters.some((character) => {
        const row = progressByPair.get(pairKey(student.id, character.character_id));
        return pairStatus(row) === filter;
      });
    });
  }, [baseStudents, filter, progressByPair, search, visibleCharacters]);

  const summary = useMemo(() => {
    const studentIds = new Set(baseStudents.map((student) => student.id));
    const characterIds = new Set(visibleCharacters.map((character) => character.character_id));
    const rows = (board?.progress ?? []).filter((row) => studentIds.has(row.student_id) && characterIds.has(row.character_id));
    return {
      students: baseStudents.length,
      characters: visibleCharacters.length,
      inProgress: rows.filter((row) => pairStatus(row) === 'IN_PROGRESS').length,
      completed: rows.filter((row) => pairStatus(row) === 'COMPLETE').length,
    };
  }, [baseStudents, board?.progress, visibleCharacters]);

  const selectedStudent = selected ? board?.students.find((student) => student.id === selected.studentId) ?? null : null;
  const selectedCharacter = selected ? board?.characters.find((character) => character.character_id === selected.characterId) ?? null : null;
  const selectedRow = selected ? progressByPair.get(pairKey(selected.studentId, selected.characterId)) ?? null : null;

  if (query.isLoading || !board) {
    return <div className="grid min-h-[420px] place-items-center"><LoadingSpinner size="lg" /></div>;
  }

  if (query.isError) {
    return (
      <div className="rounded-card-lg border border-danger/40 bg-danger-bg p-6 text-center">
        <div className="text-3xl">⚠️</div>
        <h2 className="mt-2 font-display text-lg text-white">차원관문 진행 현황을 불러오지 못했습니다</h2>
        <p className="mt-2 text-xs font-bold text-danger">
          {query.error instanceof Error ? query.error.message : '알 수 없는 오류'}
        </p>
      </div>
    );
  }

  if (board.characters.length === 0) {
    return <EmptyState icon="🌀" title="활성 차원관문 캐릭터가 없습니다" description="관문 콘텐츠에서 캐릭터를 활성화하면 진행 현황이 표시됩니다." />;
  }

  return (
    <>
      <section className="space-y-4">
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <SummaryCard emoji="👥" label="대상 학생" value={summary.students} sub={includeTestAccounts ? '테스트 계정 포함' : '테스트 계정 제외'} />
          <SummaryCard emoji="🌀" label="활성 캐릭터" value={summary.characters} sub={characterFilter === 'ALL' ? '전체 관문' : '선택 관문'} />
          <SummaryCard emoji="▶" label="진행 중" value={summary.inProgress} sub="학생 × 캐릭터" tone="progress" />
          <SummaryCard emoji="✓" label="전편 완료" value={summary.completed} sub="학생 × 캐릭터" tone="complete" />
        </div>

        <div className="rounded-card-lg border border-line bg-bg-card p-3">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(FILTER_LABEL) as ProgressFilter[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setFilter(key)}
                  className={cn(
                    'rounded-pill border px-3 py-2 text-xs font-black transition-all',
                    filter === key
                      ? 'border-brand-primary/50 bg-brand-primary/20 text-white'
                      : 'border-line bg-bg-deep text-text-secondary hover:text-white',
                  )}
                >
                  {FILTER_LABEL[key]}
                </button>
              ))}
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <select
                value={characterFilter}
                onChange={(event) => setCharacterFilter(event.target.value === 'ALL' ? 'ALL' : Number(event.target.value))}
                className="rounded-card-md border border-line bg-bg-deep px-3 py-2 text-xs font-bold text-white outline-none"
              >
                <option value="ALL">모든 캐릭터</option>
                {board.characters.map((character) => (
                  <option key={character.character_id} value={character.character_id}>{character.name}</option>
                ))}
              </select>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="학생명 · 브랜드명 검색"
                className="min-w-[220px] rounded-card-md border border-line bg-bg-deep px-3 py-2 text-xs font-bold text-white outline-none placeholder:text-text-muted focus:border-brand-primary/50"
              />
              <button
                type="button"
                onClick={() => setIncludeTestAccounts((value) => !value)}
                className={cn(
                  'rounded-card-md border px-3 py-2 text-xs font-black',
                  includeTestAccounts
                    ? 'border-amber-300/40 bg-amber-300/10 text-amber-100'
                    : 'border-line bg-bg-deep text-text-secondary',
                )}
              >
                {includeTestAccounts ? '테스트 포함' : '테스트 제외'}
              </button>
              <button type="button" onClick={() => void query.refetch()} className="btn-secondary px-3 py-2 text-xs">↻ 새로고침</button>
            </div>
          </div>
        </div>

        <div className="overflow-hidden rounded-card-lg border border-line bg-bg-card">
          <div className="overflow-auto">
            <table className="min-w-full border-collapse">
              <thead className="sticky top-0 z-20 bg-bg-overlay/95 backdrop-blur">
                <tr>
                  <th className="sticky left-0 z-30 min-w-[160px] border-b border-r border-line bg-bg-overlay px-3 py-3 text-left text-[11px] font-black text-text-secondary">
                    학생
                  </th>
                  {visibleCharacters.map((character) => (
                    <th key={character.character_id} className="min-w-[190px] border-b border-r border-line px-3 py-3 text-left last:border-r-0">
                      <CharacterHeader character={character} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleStudents.map((student) => (
                  <tr key={student.id} className="border-b border-line/70 last:border-b-0">
                    <td className="sticky left-0 z-10 border-r border-line bg-bg-card px-3 py-3">
                      <div className="text-sm font-black text-white">{student.name}</div>
                      <div className="mt-0.5 truncate text-[10px] font-bold text-text-muted">{student.brand_name ?? '브랜드명 없음'}</div>
                      {student.is_test_account && <span className="mt-1 inline-block rounded-pill border border-amber-300/25 px-1.5 py-0.5 text-[8px] font-black text-amber-100">TEST</span>}
                    </td>
                    {visibleCharacters.map((character) => {
                      const row = progressByPair.get(pairKey(student.id, character.character_id));
                      return (
                        <td key={character.character_id} className="border-r border-line p-2 align-top last:border-r-0">
                          <ProgressCell
                            character={character}
                            row={row}
                            onClick={row ? () => setSelected({ studentId: student.id, characterId: character.character_id }) : undefined}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {visibleStudents.length === 0 && (
            <div className="p-8 text-center text-xs font-bold text-text-muted">현재 필터에 해당하는 학생이 없습니다.</div>
          )}

          <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line bg-bg-deep/55 px-3 py-2 text-[10px] font-bold text-text-muted">
            <span><b className="text-success">●</b> 완료</span>
            <span><b className="text-brand-glow">◐</b> 감상 중</span>
            <span><b className="text-white/70">○</b> 열람 가능</span>
            <span>🔒 호감도 부족</span>
            <span className="ml-auto">셀을 누르면 에피소드별 상세 진행 위치를 확인할 수 있습니다.</span>
          </div>
        </div>
      </section>

      {selected && selectedStudent && selectedCharacter && selectedRow && (
        <ProgressDrawer
          studentName={selectedStudent.name}
          brandName={selectedStudent.brand_name}
          character={selectedCharacter}
          row={selectedRow}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}

function CharacterHeader({ character }: { character: DimensionalGateTeacherProgressCharacter }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="grid h-9 w-9 flex-none place-items-center overflow-hidden rounded-full border border-violet-300/20 bg-violet-500/10">
        {character.avatar_image_url ? (
          <img src={resolveAssetUrl(character.avatar_image_url, 'character')} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="text-lg">{character.emoji || '✦'}</span>
        )}
      </div>
      <div className="min-w-0">
        <div className="truncate text-xs font-black text-white">{character.name}</div>
        <div className="mt-0.5 text-[9px] font-bold text-text-muted">EP {character.episodes.length}편</div>
      </div>
    </div>
  );
}

function ProgressCell({
  character,
  row,
  onClick,
}: {
  character: DimensionalGateTeacherProgressCharacter;
  row?: DimensionalGateTeacherProgressRow;
  onClick?: () => void;
}) {
  if (!row) {
    return (
      <div className="min-h-[76px] rounded-card-md border border-dashed border-line/60 bg-bg-deep/35 px-3 py-2.5">
        <div className="text-[11px] font-black text-text-muted">미영입</div>
        <div className="mt-2 text-[9px] font-bold text-text-muted/70">편린 미보유</div>
      </div>
    );
  }

  const status = pairStatus(row);
  const headline = pairHeadline(row);
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'min-h-[76px] w-full rounded-card-md border px-3 py-2.5 text-left transition-all hover:-translate-y-0.5 hover:border-violet-300/35',
        status === 'COMPLETE' && 'border-violet-300/25 bg-violet-500/8',
        status === 'IN_PROGRESS' && 'border-sky-300/20 bg-sky-500/5',
        status === 'NOT_STARTED' && 'border-line bg-bg-deep/55',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className={cn(
          'text-[11px] font-black',
          status === 'COMPLETE' ? 'text-violet-100' : status === 'IN_PROGRESS' ? 'text-brand-glow' : 'text-white/80',
        )}>
          {headline}
        </div>
        <span className="whitespace-nowrap text-[9px] font-black text-rose-200">♥ {row.affinity}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {character.episodes.map((definition) => {
          const episode = row.episodes.find((item) => item.episode_id === definition.episode_id);
          const state = episodeState(episode, row.affinity, definition.required_affinity);
          return (
            <span
              key={definition.episode_id}
              title={`EP${definition.episode_no} · ${definition.title} · ${episodeStateLabel(state, definition.required_affinity)}`}
              className={cn(
                'grid h-5 min-w-5 place-items-center rounded-full border px-1 text-[9px] font-black',
                state === 'COMPLETE' && 'border-success/30 bg-success/10 text-success',
                state === 'IN_PROGRESS' && 'border-sky-300/30 bg-sky-300/10 text-brand-glow',
                state === 'AVAILABLE' && 'border-white/15 bg-white/5 text-white/70',
                state === 'LOCKED' && 'border-line bg-bg-overlay text-text-muted',
              )}
            >
              {state === 'COMPLETE' ? '●' : state === 'IN_PROGRESS' ? '◐' : state === 'LOCKED' ? '🔒' : '○'}
            </span>
          );
        })}
      </div>
      <div className="mt-1.5 text-[9px] font-bold text-text-muted">{row.relation_stage === 'TRUST' ? '신뢰' : row.relation_stage === 'AFFECTION' ? '호감' : row.relation_stage === 'INTEREST' ? '관심' : '낯섦'}</div>
    </button>
  );
}

function ProgressDrawer({
  studentName,
  brandName,
  character,
  row,
  onClose,
}: {
  studentName: string;
  brandName: string | null;
  character: DimensionalGateTeacherProgressCharacter;
  row: DimensionalGateTeacherProgressRow;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <aside
        className="absolute right-0 top-0 h-full w-full max-w-[460px] overflow-y-auto border-l border-line bg-bg-overlay shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-start justify-between border-b border-line bg-bg-overlay/95 p-5 backdrop-blur">
          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-violet-200/70">Story Progress</div>
            <h3 className="mt-1 text-lg font-black text-white">{studentName} · {character.name}</h3>
            <div className="mt-1 text-[10px] font-bold text-text-muted">{brandName ?? '브랜드명 없음'}</div>
          </div>
          <button type="button" onClick={onClose} className="rounded-full border border-line bg-bg-card px-2.5 py-1 text-sm font-black text-white">×</button>
        </div>

        <div className="space-y-4 p-5">
          <div className="grid grid-cols-3 gap-2">
            <DetailStat label="호감도" value={`♥ ${row.affinity}`} />
            <DetailStat label="관계 단계" value={relationLabel(row.relation_stage)} />
            <DetailStat label="전체 상태" value={pairStatus(row) === 'COMPLETE' ? '전편 완료' : pairStatus(row) === 'IN_PROGRESS' ? '진행 중' : '미시작'} />
          </div>

          <div className="space-y-2">
            {row.episodes.map((episode) => {
              const state = episodeState(episode, row.affinity, episode.required_affinity);
              const percent = episode.last_cut_order && episode.cut_count > 0
                ? Math.min(100, Math.round((episode.last_cut_order / episode.cut_count) * 100))
                : null;
              return (
                <div key={episode.episode_id} className="rounded-card-md border border-line bg-bg-card p-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[10px] font-black text-violet-200/70">EP {episode.episode_no}</div>
                      <div className="mt-0.5 truncate text-sm font-black text-white">{episode.title}</div>
                    </div>
                    <EpisodeStateBadge state={state} requiredAffinity={episode.required_affinity} />
                  </div>

                  {state === 'IN_PROGRESS' && (
                    <div className="mt-3">
                      {percent != null && episode.last_cut_order != null ? (
                        <>
                          <div className="flex items-center justify-between text-[10px] font-bold text-text-secondary">
                            <span>CUT {episode.last_cut_order} / {episode.cut_count}</span>
                            <span>{percent}%</span>
                          </div>
                          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-bg-deep">
                            <div className="h-full rounded-full bg-sky-300/70" style={{ width: `${percent}%` }} />
                          </div>
                        </>
                      ) : (
                        <div className="text-[10px] font-bold text-text-secondary">감상 시작됨 · 기존 기록은 세부 CUT 위치가 저장되지 않았을 수 있습니다.</div>
                      )}
                    </div>
                  )}

                  {state === 'COMPLETE' && <div className="mt-2 text-[10px] font-bold text-success">✓ 감상 완료</div>}
                  {state === 'AVAILABLE' && <div className="mt-2 text-[10px] font-bold text-text-muted">열람 가능 · 아직 시작하지 않음</div>}
                  {state === 'LOCKED' && <div className="mt-2 text-[10px] font-bold text-text-muted">호감도 {episode.required_affinity} 필요</div>}

                  {(episode.updated_at || episode.completed_at || episode.opened_at) && (
                    <div className="mt-2 text-[9px] font-bold text-text-muted">
                      최근 기록 {formatDateTime(episode.updated_at ?? episode.completed_at ?? episode.opened_at)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {row.last_interacted_at && (
            <div className="rounded-card-md border border-line bg-bg-deep/55 p-3 text-[10px] font-bold text-text-muted">
              최근 차원관문 상호작용 · {formatDateTime(row.last_interacted_at)}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

function SummaryCard({
  emoji,
  label,
  value,
  sub,
  tone = 'default',
}: {
  emoji: string;
  label: string;
  value: number;
  sub: string;
  tone?: 'default' | 'progress' | 'complete';
}) {
  return (
    <div className="rounded-card-lg border border-line bg-bg-card p-4">
      <div className="text-lg">{emoji}</div>
      <div className={cn(
        'mt-2 text-xl font-black',
        tone === 'progress' ? 'text-brand-glow' : tone === 'complete' ? 'text-violet-200' : 'text-white',
      )}>{value}</div>
      <div className="mt-0.5 text-[10px] font-black text-text-secondary">{label}</div>
      <div className="mt-1 text-[9px] font-bold text-text-muted">{sub}</div>
    </div>
  );
}

function DetailStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-card-md border border-line bg-bg-card p-3 text-center">
      <div className="text-[9px] font-bold text-text-muted">{label}</div>
      <div className="mt-1 text-xs font-black text-white">{value}</div>
    </div>
  );
}

function EpisodeStateBadge({ state, requiredAffinity }: { state: ReturnType<typeof episodeState>; requiredAffinity: number }) {
  const label = episodeStateLabel(state, requiredAffinity);
  return (
    <span className={cn(
      'rounded-pill border px-2 py-1 text-[9px] font-black',
      state === 'COMPLETE' && 'border-success/30 bg-success/10 text-success',
      state === 'IN_PROGRESS' && 'border-sky-300/30 bg-sky-300/10 text-brand-glow',
      state === 'AVAILABLE' && 'border-white/15 bg-white/5 text-white/70',
      state === 'LOCKED' && 'border-line bg-bg-deep text-text-muted',
    )}>{label}</span>
  );
}

function pairKey(studentId: number, characterId: number) {
  return `${studentId}:${characterId}`;
}

function pairStatus(row?: DimensionalGateTeacherProgressRow): PairStatus {
  if (!row) return 'UNOWNED';
  if (row.episodes.length > 0 && row.episodes.every((episode) => episode.completed_at != null)) return 'COMPLETE';
  if (row.episodes.some((episode) => episode.opened_at != null || episode.completed_at != null)) return 'IN_PROGRESS';
  return 'NOT_STARTED';
}

function pairHeadline(row: DimensionalGateTeacherProgressRow) {
  if (pairStatus(row) === 'COMPLETE') return '전편 완료';
  const active = row.episodes.find((episode) => episode.opened_at != null && episode.completed_at == null);
  if (active) return `EP${active.episode_no} 진행 중`;
  const completed = [...row.episodes].filter((episode) => episode.completed_at != null).sort((a, b) => b.episode_no - a.episode_no)[0];
  if (completed) return `EP${completed.episode_no} 완료`;
  return '미시작';
}

function episodeState(
  episode: DimensionalGateTeacherProgressEpisode | undefined,
  affinity: number,
  requiredAffinity: number,
): 'COMPLETE' | 'IN_PROGRESS' | 'AVAILABLE' | 'LOCKED' {
  if (episode?.completed_at) return 'COMPLETE';
  if (episode?.opened_at) return 'IN_PROGRESS';
  return affinity >= requiredAffinity ? 'AVAILABLE' : 'LOCKED';
}

function episodeStateLabel(state: ReturnType<typeof episodeState>, requiredAffinity: number) {
  if (state === 'COMPLETE') return '완료';
  if (state === 'IN_PROGRESS') return '감상 중';
  if (state === 'AVAILABLE') return '열람 가능';
  return `🔒 ${requiredAffinity}`;
}

function relationLabel(stage: DimensionalGateTeacherProgressRow['relation_stage']) {
  if (stage === 'TRUST') return '신뢰';
  if (stage === 'AFFECTION') return '호감';
  if (stage === 'INTEREST') return '관심';
  return '낯섦';
}

function formatDateTime(value: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('ko-KR', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

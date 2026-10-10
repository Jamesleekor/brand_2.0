import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { arcadeErrorMessage, arcadeTeacherRpc } from '@/lib/rpc/arcade_rpc';
import { arcadeGameMeta, PERIOD_RECORD_GAME_CODES } from './arcadeGameRegistry';
import type { ArcadePeriodRecordsResult } from '@/lib/zod_schemas/arcade_schemas';

const GAMES = PERIOD_RECORD_GAME_CODES.map((code) => ({
  code,
  name: arcadeGameMeta(code)?.shortName ?? code,
}));
type PeriodRow = { id: number; display_name: string; period_kind: string; status: string; starts_at: string; ends_at_exclusive: string };
const STATUS: Record<string, string> = { ACTIVE: '기록 접수 중', VERIFICATION: '인증 중', READY_TO_FINALIZE: '확정 대기', FINALIZED: '확정 완료' };
function kst(value: string | null) {
  return value ? new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '—';
}
function score(value: number | null) { return value === null ? '—' : value.toLocaleString('ko-KR'); }

export function TeacherArcadePeriodRecordsPanel({ classroomId }: { classroomId: number | null }) {
  const [selectedPeriodId, setSelectedPeriodId] = useState<number | null>(null);
  const [gameCode, setGameCode] = useState<(typeof PERIOD_RECORD_GAME_CODES)[number]>('focus_reaction_01');
  const periods = useQuery({
    queryKey: ['teacher-arcade-record-periods', classroomId],
    enabled: classroomId !== null,
    staleTime: 30_000, retry: false, refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await supabase.from('arcade_ranking_periods')
        .select('id,display_name,period_kind,status,starts_at,ends_at_exclusive')
        .eq('classroom_id', classroomId!).neq('status', 'DRAFT').order('starts_at', { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as PeriodRow[];
    },
  });
  const available = periods.data ?? [];
  const period = available.find((item) => item.id === selectedPeriodId)
    ?? available.find((item) => item.period_kind === 'MONTHLY' && item.status === 'ACTIVE'
      && Date.now() >= Date.parse(item.starts_at) && Date.now() < Date.parse(item.ends_at_exclusive))
    ?? available.find((item) => item.period_kind === 'MONTHLY') ?? available[0];
  const records = useQuery({
    queryKey: ['teacher-arcade-period-records', classroomId, period?.id],
    enabled: classroomId !== null && Boolean(period),
    staleTime: 30_000, retry: false, refetchOnWindowFocus: false,
    queryFn: async () => {
      const result = await arcadeTeacherRpc.getPeriodRecords(supabase, { p_period_id: period!.id });
      if (result.success === false) throw new Error(arcadeErrorMessage(result));
      return result.data;
    },
  });
  const rows = records.data?.rows.filter((row) => row.game_code === gameCode) ?? [];
  const error = periods.error ?? records.error;
  const busy = periods.isFetching || records.isFetching;
  const isRakaruka = gameCode === 'rakaruka_03';
  return (
    <section className="glass-card border-gold/35 p-5">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <div className="text-xs font-black tracking-[0.16em] text-gold">ARCADE PERIOD RECORDS</div>
          <h2 className="mt-1 font-display text-lg text-white">학생 기간 기록 · 전체 3게임</h2>
          <p className="mt-2 text-xs leading-5 text-white/85">공인 인증을 열기 전에도 일반 기록을 조회할 수 있습니다. 아래 기록은 선택한 기간만 집계합니다.</p>
        </div>
        <button className="btn-secondary shrink-0 text-xs" disabled={busy} onClick={() => { void periods.refetch(); if (period) void records.refetch(); }}>
          {busy ? '불러오는 중...' : '기록 새로고침'}
        </button>
      </div>
      <label className="mt-4 block text-xs font-bold text-white">조회할 기간
        <select className="input-field mt-1 w-full" value={period?.id ?? ''} disabled={!available.length} onChange={(event) => setSelectedPeriodId(Number(event.target.value))}>
          {!available.length && <option value="">기간 없음</option>}
          {available.map((item) => <option key={item.id} value={item.id}>{item.display_name} · {item.period_kind === 'MONTHLY' ? '월간' : '시즌'} · {STATUS[item.status] ?? item.status}</option>)}
        </select>
      </label>
      {period && <p className="mt-2 text-xs text-white/85">{kst(period.starts_at)} ~ {kst(period.ends_at_exclusive)} 전</p>}
      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        {GAMES.map((game) => {
          const items = records.data?.rows.filter((row) => row.game_code === game.code) ?? [];
          const participants = items.filter((row) => row.play_count > 0 || row.official_status !== null || row.current_rank !== null).length;
          return <button type="button" key={game.code} aria-pressed={gameCode === game.code} onClick={() => setGameCode(game.code)}
            className={`rounded-card-md border p-3 text-left ${gameCode === game.code ? 'border-gold/60 bg-gold/10' : 'border-line bg-bg-deep'}`}>
            <b className="text-sm text-white">{game.name}</b>
            <div className="mt-1 text-xs text-white/85">{records.data ? `${participants}명 참여 · ${items.reduce((sum, row) => sum + row.completed_count, 0)}건 ${game.code === 'rakaruka_03' ? '일반 경기 완료' : '기록 인정'}` : '조회 대기'}</div>
          </button>;
        })}
      </div>
      {error && <div className="mt-4 rounded-card-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">기간 기록을 불러오지 못했습니다. {error instanceof Error ? error.message : String(error)}</div>}
      {!error && busy && !records.data && <p className="mt-4 text-sm text-white">기간 기록을 불러오는 중...</p>}
      {!periods.isPending && !error && !available.length && <p className="mt-4 text-sm text-white">조회할 랭킹 기간이 없습니다.</p>}
      {records.data && !error && <>
        <p className="mt-4 text-xs leading-5 text-white/85">{isRakaruka
          ? '일반 경기 전적과 기간 내 최고 클리어를 표시합니다. 공인 순위는 별도 5판 도전을 완료하고 3점 이상 인정받은 기록에만 생깁니다. 월간 확정 뒤에는 보존된 Top 10 순위를 표시합니다.'
          : '일반 최고는 기간 내 인정된 일반 플레이 기록입니다. 현재 순위는 인증 중에는 공인 판정을, 확정 뒤에는 보존된 최종 기록을 따릅니다. 사전 테스트·무효 기록은 제외합니다.'}</p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-xs">
            <thead className="bg-bg-deep text-white"><tr>
              <th className="px-3 py-3">학생</th><th className="px-3 py-3">{isRakaruka ? '일반 전적' : '플레이 / 인정 / 거절'}</th>
              <th className="px-3 py-3">{isRakaruka ? '기간 최고 클리어' : '일반 최고 기록'}</th>
              <th className="px-3 py-3">{isRakaruka ? '공인 도전 기록' : '현재 순위 기록'}</th>
              <th className="px-3 py-3">{isRakaruka ? '공인 순위' : '현재 순위'}</th><th className="px-3 py-3">최근 일반 플레이</th>
            </tr></thead>
            <tbody className="divide-y divide-line/70 text-white">
              {rows.map((row) => <RecordRow key={row.student_id} row={row} isRakaruka={isRakaruka} />)}
            </tbody>
          </table>
          {!rows.length && <p className="p-5 text-sm text-white">조회할 공식 참여 학생이 없습니다.</p>}
        </div>
      </>}
    </section>
  );
}

function RecordRow({ row, isRakaruka }: { row: ArcadePeriodRecordsResult['rows'][number]; isRakaruka: boolean }) {
  const officialStatus = row.official_status === 'ACTIVE' ? '도전 중' : row.official_status === 'COMPLETED' ? '완료 · 인정 순위 없음' : row.official_status === 'CANCELLED' ? '취소됨' : '공인 도전 없음';
  return <tr>
    <td className="px-3 py-3 font-bold">{row.student_name}</td>
    <td className="px-3 py-3">{isRakaruka ? `${row.play_count}전 · ${row.wins}승 ${row.losses}패 ${row.draws}무` : `${row.play_count} / ${row.completed_count} / ${row.rejected_count}`}</td>
    <td className="px-3 py-3 font-bold text-gold">{isRakaruka ? row.clear_level > 0 ? `Lv.${row.clear_level}` : '승리 기록 없음' : <>{score(row.general_best_score)}{row.average_reaction_ms_x10 !== null && <div className="mt-1 text-white/85">평균 {(row.average_reaction_ms_x10 / 10).toFixed(1)}ms</div>}</>}</td>
    <td className="px-3 py-3">{isRakaruka ? row.official_score === null ? officialStatus : `Lv.${row.official_difficulty} · ${score(row.official_score)}점` : score(row.official_score)}</td>
    <td className="px-3 py-3 font-bold text-gold">{row.current_rank === null ? '—' : `${row.current_rank}위`}</td>
    <td className="px-3 py-3 text-white/85">{kst(row.last_played_at)}</td>
  </tr>;
}

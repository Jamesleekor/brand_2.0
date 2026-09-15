import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { LoadingSpinner } from '@/components/shared/components';
import { TeacherShell } from '@/components/teacher/TeacherShell';
import { raidAdminRpc } from '@/lib/rpc/raid_admin_rpc';
import { supabase } from '@/lib/supabase/client';
import { useClassroomId } from '@/stores/auth_store';

export default function RaidBalanceLabPage() {
  const classroomId = useClassroomId();

  const boardQuery = useQuery({
    queryKey: ['teacher-raid-control-board', classroomId],
    queryFn: async () => {
      if (!classroomId) return { raids: [] };
      const result = await raidAdminRpc.board(supabase, classroomId);
      if (result.success === false) throw new Error(result.error);
      return result.data ?? { raids: [] };
    },
    enabled: classroomId !== null,
  });

  const completed = useMemo(
    () => (boardQuery.data?.raids ?? []).filter((raid) => ['COMPLETED', 'FAILED', 'ARCHIVED'].includes(raid.status)),
    [boardQuery.data?.raids],
  );

  return (
    <TeacherShell>
      <div className="space-y-5 pb-10">
        <header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="mb-1 text-xs font-black uppercase tracking-[0.18em] text-cyan-200">
              RAID BALANCE LAB
            </div>
            <h1 className="font-display text-2xl tracking-tight text-brand-gradient">
              📊 레이드 밸런싱 분석실
            </h1>
            <p className="mt-1 text-sm font-bold text-amber-100">
              종료된 레이드의 피해 분포와 공명력 효율을 분석해 다음 보스 난이도를 설계합니다.
            </p>
          </div>
          <div className="flex gap-2">
            <Link
              to="/teacher/raid"
              className="rounded-card-md border border-cyan-400/40 bg-cyan-500/10 px-4 py-2 text-xs font-black text-cyan-100 hover:border-cyan-300/70"
            >
              ⚔️ 레이드 통제실
            </Link>
            <span className="rounded-card-md border border-gold/60 bg-gold/15 px-4 py-2 text-xs font-black text-yellow-100">
              📊 밸런싱 분석실
            </span>
          </div>
        </header>

        {boardQuery.isLoading ? (
          <div className="flex min-h-[420px] items-center justify-center"><LoadingSpinner size="lg" /></div>
        ) : boardQuery.isError ? (
          <div className="rounded-card-lg border border-red-400/50 bg-red-950/45 p-6 text-center">
            <div className="text-3xl">⚠️</div>
            <h2 className="mt-2 font-display text-lg text-white">레이드 기록을 불러오지 못했습니다</h2>
            <p className="mt-2 break-all text-sm font-bold text-red-100">
              {boardQuery.error instanceof Error ? boardQuery.error.message : '알 수 없는 오류'}
            </p>
          </div>
        ) : (
          <>
            <section className="grid gap-3 md:grid-cols-3">
              <InfoCard icon="🏁" label="종료 레이드" value={`${completed.length}회`} tone="gold" />
              <InfoCard
                icon="⚔️"
                label="토벌 성공"
                value={`${completed.filter((raid) => raid.status === 'COMPLETED').length}회`}
                tone="cyan"
              />
              <InfoCard
                icon="🧪"
                label="분석 엔진"
                value={completed.length > 0 ? '데이터 준비됨' : '기록 대기'}
                tone="white"
              />
            </section>

            <section className="rounded-card-lg border border-cyan-400/30 bg-bg-card p-6">
              <div className="flex items-start gap-4">
                <div className="text-4xl">🧭</div>
                <div>
                  <h2 className="font-display text-lg text-white">분석실 골격 연결 완료</h2>
                  <p className="mt-2 max-w-3xl text-sm font-bold leading-6 text-amber-100">
                    Phase B에서는 통제실과 종료 레이드 목록까지 연결합니다. 실제 분석 계산은 레이드 실전 데이터가
                    생긴 뒤 Phase F에서 피해 분포, 공명력 ↔ 평균 피해, Crit 기대값 ↔ 실제값, 피해 집중도,
                    Boss HP 시간곡선과 다음 보스 HP 추천까지 구현합니다.
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {[
                      '피해 중앙값 / P25 / P75 / P90',
                      '공명력 ↔ 평균 피해/터치',
                      'TOP 3·5 피해 집중도',
                      '실제 Crit 분석',
                      'Boss HP Timeline',
                      '다음 보스 HP 추천',
                    ].map((item) => (
                      <span
                        key={item}
                        className="rounded-pill border border-cyan-400/30 bg-cyan-500/10 px-3 py-1.5 text-xs font-black text-cyan-100"
                      >
                        {item}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            <section className="rounded-card-lg border border-line bg-bg-card p-5">
              <h2 className="font-display text-lg text-white">종료 레이드 기록</h2>
              <p className="mt-1 text-xs font-bold text-cyan-100">
                분석 대상이 될 레이드입니다. 전투 데이터를 쌓은 뒤 각 레이드별 상세 분석 화면을 연결합니다.
              </p>

              <div className="mt-4 space-y-2">
                {completed.length === 0 ? (
                  <div className="rounded-card-md border border-dashed border-cyan-400/30 bg-bg-deep p-8 text-center">
                    <div className="text-4xl">📭</div>
                    <div className="mt-2 text-sm font-black text-white">아직 종료된 레이드가 없습니다</div>
                    <div className="mt-1 text-xs font-bold text-amber-100">첫 레이드를 운영하면 이곳에 분석 대상이 쌓입니다.</div>
                  </div>
                ) : (
                  completed.map((raid) => (
                    <div
                      key={raid.id}
                      className="grid gap-3 rounded-card-md border border-line bg-bg-deep p-4 md:grid-cols-[1fr_auto_auto_auto] md:items-center"
                    >
                      <div>
                        <div className="text-sm font-black text-white">{raid.title}</div>
                        <div className="mt-1 text-xs font-bold text-amber-100">{raid.boss_name}</div>
                      </div>
                      <div className="text-xs font-black text-cyan-100">
                        HP {Number(raid.max_hp).toLocaleString('ko-KR')}
                      </div>
                      <div className="text-xs font-black text-yellow-100">
                        참여 {raid.participant_count}명
                      </div>
                      <div className="rounded-pill border border-white/20 bg-white/5 px-2.5 py-1 text-[10px] font-black text-white">
                        {raid.status === 'COMPLETED' ? '토벌 성공' : raid.status === 'FAILED' ? '종료' : '보관'}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </>
        )}
      </div>
    </TeacherShell>
  );
}

function InfoCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: string;
  label: string;
  value: string;
  tone: 'gold' | 'cyan' | 'white';
}) {
  const cls = {
    gold: 'border-yellow-400/35 text-yellow-100',
    cyan: 'border-cyan-400/35 text-cyan-100',
    white: 'border-white/20 text-white',
  }[tone];
  return (
    <div className={`rounded-card-lg border bg-bg-card p-4 ${cls}`}>
      <div className="flex items-center gap-2 text-xs font-black"><span>{icon}</span><span>{label}</span></div>
      <div className="mt-2 font-mono text-xl font-black">{value}</div>
    </div>
  );
}

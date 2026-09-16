import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { LoadingSpinner } from '@/components/shared/components';
import { TeacherShell } from '@/components/teacher/TeacherShell';
import {
  raidBalanceV15Rpc,
  type RaidBalanceAnalysisV15,
  type RaidBalanceLabRowV15,
  type RaidDifficultyAxis,
  type RaidPatternMetricV15,
} from '@/lib/rpc/raid_balance_v15_rpc';
import { supabase } from '@/lib/supabase/client';
import { useClassroomId } from '@/stores/auth_store';

// RAID_V15_E6_BALANCE_LAB
export default function RaidBalanceLabPage() {
  const classroomId = useClassroomId();
  const queryClient = useQueryClient();
  const [selectedRaidId, setSelectedRaidId] = useState<number | null>(null);

  const labQuery = useQuery({
    queryKey: ['raid-balance-lab-v15', classroomId],
    queryFn: async () => {
      if (!classroomId) return { raids: [] as RaidBalanceLabRowV15[] };
      const result = await raidBalanceV15Rpc.lab(supabase, classroomId);
      if (result.success === false) throw new Error(result.error);
      return result.data ?? { raids: [] as RaidBalanceLabRowV15[] };
    },
    enabled: classroomId !== null,
  });

  const raids = labQuery.data?.raids ?? [];

  useEffect(() => {
    if (selectedRaidId === null && raids[0]) setSelectedRaidId(raids[0].id);
    if (selectedRaidId !== null && raids.length > 0 && !raids.some((raid) => raid.id === selectedRaidId)) {
      setSelectedRaidId(raids[0].id);
    }
  }, [raids, selectedRaidId]);

  const analysisQuery = useQuery({
    queryKey: ['raid-balance-analysis-v15', selectedRaidId],
    queryFn: async () => {
      if (selectedRaidId === null) throw new Error('분석할 레이드를 선택해주세요.');
      const result = await raidBalanceV15Rpc.analysis(supabase, selectedRaidId);
      if (result.success === false) throw new Error(result.error);
      return result.data;
    },
    enabled: selectedRaidId !== null,
  });

  useEffect(() => {
    if (!analysisQuery.data || !classroomId) return;
    void queryClient.invalidateQueries({ queryKey: ['raid-balance-lab-v15', classroomId] });
  }, [analysisQuery.data?.report.generated_at, classroomId, queryClient]);

  const completedCount = raids.filter((raid) => raid.status === 'COMPLETED').length;
  const v15Count = raids.filter((raid) => raid.report_available).length;

  return (
    <TeacherShell>
      <div className="space-y-5 pb-10">
        <header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="mb-1 text-xs font-black uppercase tracking-[0.18em] text-cyan-200">RAID BALANCE LAB V1.5</div>
            <h1 className="font-display text-2xl tracking-tight text-brand-gradient">📊 레이드 밸런싱 분석실</h1>
            <p className="mt-1 text-sm font-bold text-amber-100">
              공격·공명방벽 생존·전투 패턴을 분리해 다음 레이드의 HP와 생존 난도를 조정합니다.
            </p>
          </div>
          <Link
            to="/teacher/raid"
            className="rounded-card-md border border-cyan-400/40 bg-cyan-500/10 px-4 py-2 text-xs font-black text-cyan-100 hover:border-cyan-300/70"
          >
            ⚔️ 레이드 통제실
          </Link>
        </header>

        {labQuery.isLoading ? (
          <LoadingBlock />
        ) : labQuery.isError ? (
          <ErrorPanel message={errorMessage(labQuery.error)} />
        ) : (
          <>
            <section className="grid gap-3 md:grid-cols-3">
              <InfoCard icon="🏁" label="종료 레이드" value={`${raids.length}회`} />
              <InfoCard icon="⚔️" label="토벌 성공" value={`${completedCount}회`} />
              <InfoCard icon="🧪" label="V1.5 분석 생성" value={`${v15Count}회`} />
            </section>

            <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
              <RaidHistory raids={raids} selectedRaidId={selectedRaidId} onSelect={setSelectedRaidId} />

              <div className="min-w-0">
                {selectedRaidId === null ? (
                  <EmptyAnalysis />
                ) : analysisQuery.isLoading ? (
                  <LoadingBlock />
                ) : analysisQuery.isError || !analysisQuery.data ? (
                  <ErrorPanel message={errorMessage(analysisQuery.error)} />
                ) : (
                  <AnalysisPanel data={analysisQuery.data} />
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </TeacherShell>
  );
}

function RaidHistory({
  raids,
  selectedRaidId,
  onSelect,
}: {
  raids: RaidBalanceLabRowV15[];
  selectedRaidId: number | null;
  onSelect: (id: number) => void;
}) {
  return (
    <aside className="self-start rounded-card-lg border border-line bg-bg-card p-3 xl:sticky xl:top-[76px]">
      <div className="mb-3 px-1">
        <div className="text-sm font-black text-white">종료 레이드 기록</div>
        <div className="mt-1 text-xs font-bold text-cyan-100">선택하면 V1.5 분석 보고서를 생성·갱신합니다.</div>
      </div>
      <div className="max-h-[calc(100vh-180px)] space-y-2 overflow-y-auto pr-1">
        {raids.length === 0 ? (
          <div className="rounded-card-md border border-dashed border-cyan-400/30 bg-bg-deep p-7 text-center">
            <div className="text-4xl">📭</div>
            <div className="mt-2 text-sm font-black text-white">분석할 종료 레이드가 없습니다</div>
          </div>
        ) : null}
        {raids.map((raid) => {
          const selected = raid.id === selectedRaidId;
          const hpLeft = raid.max_hp > 0 ? raid.current_hp / raid.max_hp : 0;
          return (
            <button
              key={raid.id}
              type="button"
              onClick={() => onSelect(raid.id)}
              className={`w-full rounded-card-md border p-3 text-left transition ${
                selected ? 'border-gold/70 bg-gold/10' : 'border-line bg-bg-deep hover:border-cyan-400/40'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-black text-white">{raid.title}</div>
                  <div className="mt-0.5 truncate text-xs font-bold text-amber-100">{raid.boss_name}</div>
                </div>
                <span className={`rounded-pill border px-2 py-1 text-[10px] font-black ${raid.status === 'COMPLETED' ? 'border-cyan-400/40 text-cyan-100' : 'border-red-400/40 text-red-100'}`}>
                  {raid.status === 'COMPLETED' ? '토벌' : '실패'}
                </span>
              </div>
              <div className="mt-2 flex justify-between text-[10px] font-black text-cyan-100">
                <span>Boss 잔여 {formatPercent(hpLeft * 100)}</span>
                <span>참여 {raid.participant_count}</span>
              </div>
            </button>
          );
        })}
      </div>
    </aside>
  );
}

function AnalysisPanel({ data }: { data: RaidBalanceAnalysisV15 }) {
  const { raid, report } = data;
  const summary = report.summary;
  const recommendation = report.hp_recommendation;
  const noBarrierData = !report.barrier.max_barrier;
  const sampleQuality = String(summary.sample_quality ?? recommendation.sample_quality ?? 'LOW');

  return (
    <div className="space-y-4">
      <section className="rounded-card-lg border border-gold/40 bg-bg-card p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.14em] text-yellow-100">{report.algorithm_version} REPORT</div>
            <h2 className="mt-1 font-display text-xl text-white">{raid.title}</h2>
            <div className="mt-1 text-sm font-bold text-amber-100">{raid.boss_name} · {raid.boss_element}</div>
          </div>
          <div className="flex flex-wrap gap-2 text-xs font-black">
            <Badge text={raid.status === 'COMPLETED' ? '🏆 토벌 성공' : '💥 토벌 실패'} tone={raid.status === 'COMPLETED' ? 'cyan' : 'red'} />
            <Badge text={`표본 ${sampleQuality}`} tone={sampleQuality === 'HIGH' ? 'cyan' : 'gold'} />
          </div>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        <DifficultyCard icon="⚔️" label="공격 난도" axis={report.difficulty.attack} />
        <DifficultyCard icon="🛡️" label="생존 난도" axis={report.difficulty.survival} />
        <DifficultyCard icon="🧩" label="패턴 난도" axis={report.difficulty.pattern} />
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Boss 피해" value={`${formatPercent(number(summary.boss_damage_percent))}`} sub={`${formatNumber(number(summary.boss_damage_taken))} / ${formatNumber(raid.max_hp)}`} />
        <MetricCard label="전투 시간" value={formatSeconds(number(summary.battle_duration_seconds))} sub={`실전 공격 ${formatSeconds(number(summary.active_combat_seconds))}`} />
        <MetricCard label="관측 DPS" value={formatNumber(number(summary.observed_dps))} sub={`유효 터치 ${formatNumber(number(summary.accepted_taps))}`} />
        <MetricCard label="참여율" value={formatPercent(number(summary.participation_rate))} sub={`${number(summary.participant_count)} / ${number(summary.snapshot_count)}명`} />
      </section>

      <section className="grid gap-4 2xl:grid-cols-2">
        <Panel title="🛡️ 공명방벽 생존 분석" description="최대 방벽과 실제 소진 흐름을 분리해서 봅니다.">
          {noBarrierData ? (
            <NoData text="이 기록은 V1.5 공명방벽 로그가 없어 생존 난도를 계산하지 않습니다." />
          ) : (
            <div className="space-y-4">
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                <MiniStat label="최대 방벽" value={formatNumber(report.barrier.max_barrier)} />
                <MiniStat label="받은 총 피해" value={formatNumber(report.barrier.total_damage_received)} />
                <MiniStat label="남은 방벽" value={formatNumber(report.barrier.remaining_barrier)} />
                <MiniStat label="소진율" value={formatPercent(report.barrier.consumption_percent)} />
                <MiniStat label="최저 방벽" value={formatPercent(report.barrier.lowest_barrier_percent)} />
                <MiniStat label="붕괴" value={report.barrier.collapsed ? '발생' : '없음'} />
              </div>
              <PercentBar value={report.barrier.consumption_percent} label="방벽 소진" />
              <Timeline data={data.barrier_timeline.map((item) => ({ value: item.max > 0 ? item.after / item.max : 0 }))} />
            </div>
          )}
        </Panel>

        <Panel title="💢 Boss 공격 분석" description="Boss 기본 공격이 생존 난도에 끼친 영향을 봅니다.">
          {noBarrierData ? (
            <NoData text="Boss 공격/방벽 지표가 없는 이전 기록입니다." />
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              <MiniStat label="공격 횟수" value={`${report.boss_attacks.attack_count}회`} />
              <MiniStat label="방벽 피해" value={formatNumber(report.boss_attacks.barrier_damage)} />
              <MiniStat label="평균 피해" value={formatNumber(report.boss_attacks.average_attack_damage)} />
              <MiniStat label="최대 피해" value={formatNumber(report.boss_attacks.max_attack_damage)} />
              <MiniStat label="패턴 성공" value={`${report.boss_attacks.pattern_success_count}회`} />
              <MiniStat label="패턴 실패" value={`${report.boss_attacks.pattern_failure_count}회`} />
            </div>
          )}
        </Panel>
      </section>

      <Panel title="🧩 패턴별 분석" description="발동 수와 성공/실패뿐 아니라 패턴 고유 지표까지 함께 봅니다.">
        {report.patterns.items.length === 0 ? (
          <NoData text="이 Raid에는 분석 가능한 V1.5 패턴 실행 기록이 없습니다." />
        ) : (
          <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
            {report.patterns.items.map((item) => <PatternCard key={item.pattern_type} item={item} />)}
          </div>
        )}
      </Panel>

      <section className="grid gap-4 2xl:grid-cols-[1.1fr_0.9fr]">
        <Panel title="🎯 다음 Raid 추천" description="V1.5는 3분 목표와 생존 난도를 따로 조정합니다.">
          <div className="grid gap-3 sm:grid-cols-2">
            <RecommendationCard
              title="Boss HP"
              main={formatNumber(number(recommendation.recommended_hp_3m))}
              detail={`관측 DPS ${formatNumber(number(recommendation.observed_dps))} × 180초 × 90%`}
            />
            <RecommendationCard
              title="Boss 방벽 공격"
              main={recommendation.suggested_boss_attack_barrier_ratio == null ? '데이터 없음' : `${formatPercent(number(recommendation.suggested_boss_attack_barrier_ratio) * 100)}`}
              detail={recommendation.suggested_boss_attack_barrier_ratio == null || recommendation.recommended_survival_damage_scale == null
                ? 'V1.5 생존 로그가 필요합니다.'
                : `현재 ${formatPercent(number(recommendation.current_boss_attack_barrier_ratio) * 100)} · 배율 ×${number(recommendation.recommended_survival_damage_scale).toFixed(2)}`}
            />
          </div>
          {recommendation.warning ? (
            <div className="mt-3 rounded-card-md border border-yellow-400/35 bg-yellow-500/10 p-3 text-xs font-bold leading-5 text-yellow-100">
              ⚠️ {String(recommendation.warning)}
            </div>
          ) : null}
          <div className="mt-3 text-xs font-bold leading-5 text-cyan-100">
            난도 점수는 자동 판정값이 아니라 조정용 진단축입니다. 실제 원자료와 함께 판단하세요.
          </div>
        </Panel>

        <Panel title="📉 Boss HP 흐름" description="공격 batch 기준 HP 감소 흐름입니다.">
          {data.hp_timeline.length > 0 ? (
            <Timeline data={data.hp_timeline.map((item) => ({ value: raid.max_hp > 0 ? item.hp_after / raid.max_hp : 0 }))} />
          ) : (
            <NoData text="HP 타임라인 데이터가 없습니다." />
          )}
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <MiniStat label="TOP 3 피해 비중" value={formatPercent(number(report.concentration.top3_damage_share_percent))} />
            <MiniStat label="하위 절반 피해 비중" value={formatPercent(number(report.concentration.bottom_half_damage_share_percent))} />
          </div>
        </Panel>
      </section>

      <Panel title="🏅 참가자 피해 분포" description="실제 Boss HP 피해만 순위/분포에 사용합니다.">
        <ParticipantTable data={data.participants} />
      </Panel>
    </div>
  );
}

function PatternCard({ item }: { item: RaidPatternMetricV15 }) {
  const objective = item.success_count + item.failure_count > 0;
  const details: string[] = [];
  if (objective) details.push(`성공 ${item.success_count} · 실패 ${item.failure_count}`);
  if (item.pattern_type === 'ABSORB') {
    details.push(`공격 중지 ${item.attack_stop_success_count ?? 0}/${item.activation_count}`);
    details.push(`흡수된 피해 ${formatNumber(item.absorbed_damage)}`);
  }
  if (item.pattern_type === 'REFLECT') details.push(`반사 피해 ${formatNumber(item.reflected_damage)}`);
  if (item.pattern_type === 'WEAK_POINT' && item.weak_hit_rate_percent != null) details.push(`약점 적중 ${formatPercent(item.weak_hit_rate_percent)}`);
  if (item.pattern_type === 'REGEN') details.push(`Boss 회복 ${formatNumber(item.boss_healed)}`);
  if (item.barrier_damage > 0) details.push(`방벽 피해 ${formatNumber(item.barrier_damage)}`);
  if (item.objective_progress > 0 && item.pattern_type === 'DAMAGE_CHECK') details.push(`달성 피해 ${formatNumber(item.objective_progress)}`);

  return (
    <div className="rounded-card-md border border-cyan-400/25 bg-bg-deep p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-black text-white">{patternLabel(item.pattern_type)}</div>
          <div className="mt-1 text-[11px] font-bold text-cyan-100">발동 {item.activation_count}회</div>
        </div>
        {item.success_rate_percent == null ? (
          <Badge text="행동형" tone="gold" />
        ) : (
          <Badge text={`성공 ${formatPercent(item.success_rate_percent)}`} tone={item.success_rate_percent >= 50 ? 'cyan' : 'red'} />
        )}
      </div>
      <div className="mt-3 space-y-1 text-xs font-bold text-amber-100">
        {(details.length > 0 ? details : ['추가 손실 없음']).map((detail) => <div key={detail}>• {detail}</div>)}
      </div>
    </div>
  );
}

function ParticipantTable({ data }: { data: RaidBalanceAnalysisV15['participants'] }) {
  if (data.length === 0) return <NoData text="유효 공격 참가자가 없습니다." />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-left text-xs">
        <thead className="text-cyan-100">
          <tr className="border-b border-cyan-400/20">
            <th className="px-2 py-2 font-black">순위</th>
            <th className="px-2 py-2 font-black">모험가</th>
            <th className="px-2 py-2 text-right font-black">피해</th>
            <th className="px-2 py-2 text-right font-black">비중</th>
            <th className="px-2 py-2 text-right font-black">평균 타격</th>
            <th className="px-2 py-2 text-right font-black">Crit 실제/기대</th>
          </tr>
        </thead>
        <tbody>
          {data.slice(0, 24).map((row, index) => (
            <tr key={row.student_id} className="border-b border-white/10 text-white">
              <td className="px-2 py-2 font-black">{row.final_rank ?? index + 1}</td>
              <td className="px-2 py-2">
                <div className="font-black">{row.brand_name || row.name}</div>
                <div className="text-[10px] font-bold text-amber-100">{row.guild_name || '무소속'}</div>
              </td>
              <td className="px-2 py-2 text-right font-mono font-black">{formatNumber(row.total_damage)}</td>
              <td className="px-2 py-2 text-right font-mono">{formatPercent(row.damage_share_percent)}</td>
              <td className="px-2 py-2 text-right font-mono">{formatNumber(row.average_damage)}</td>
              <td className="px-2 py-2 text-right font-mono">{formatPercent(row.actual_crit_rate)} / {formatPercent(row.expected_crit_rate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DifficultyCard({ icon, label, axis }: { icon: string; label: string; axis: RaidDifficultyAxis }) {
  const score = axis.score;
  const text = difficultyLabel(axis.label);
  return (
    <div className="rounded-card-lg border border-cyan-400/25 bg-bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-black text-white">{icon} {label}</div>
        <span className="text-xs font-black text-cyan-100">{text}</span>
      </div>
      {score == null ? (
        <div className="mt-4 rounded-card-md border border-dashed border-cyan-400/30 bg-bg-deep p-4 text-center text-xs font-bold text-amber-100">데이터 없음</div>
      ) : (
        <>
          <div className="mt-3 flex items-end justify-between">
            <div className="font-mono text-3xl font-black text-white">{score.toFixed(1)}</div>
            <div className="text-[10px] font-black text-cyan-100">0 ─ 100</div>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-black/40">
            <div className="h-full rounded-full bg-gradient-to-r from-cyan-400 via-yellow-300 to-red-400" style={{ width: `${Math.max(0, Math.min(100, score))}%` }} />
          </div>
        </>
      )}
    </div>
  );
}

function Timeline({ data }: { data: Array<{ value: number }> }) {
  const points = useMemo(() => {
    if (data.length === 0) return '';
    if (data.length === 1) return `0,${100 - clamp01(data[0].value) * 100} 100,${100 - clamp01(data[0].value) * 100}`;
    return data.map((item, index) => `${(index / (data.length - 1)) * 100},${100 - clamp01(item.value) * 100}`).join(' ');
  }, [data]);

  if (!points) return <NoData text="타임라인 데이터가 없습니다." />;
  return (
    <div className="rounded-card-md border border-cyan-400/20 bg-black/25 p-3">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-28 w-full" aria-label="레이드 상태 변화 그래프">
        <line x1="0" y1="25" x2="100" y2="25" stroke="rgba(255,255,255,0.12)" strokeWidth="0.6" />
        <line x1="0" y1="50" x2="100" y2="50" stroke="rgba(255,255,255,0.12)" strokeWidth="0.6" />
        <line x1="0" y1="75" x2="100" y2="75" stroke="rgba(255,255,255,0.12)" strokeWidth="0.6" />
        <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" className="text-cyan-300" />
      </svg>
      <div className="mt-1 flex justify-between text-[10px] font-black text-cyan-100"><span>시작</span><span>종료</span></div>
    </div>
  );
}

function PercentBar({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs font-black text-cyan-100"><span>{label}</span><span>{formatPercent(value)}</span></div>
      <div className="h-2.5 overflow-hidden rounded-full bg-black/40">
        <div className="h-full rounded-full bg-gradient-to-r from-cyan-400 via-yellow-300 to-red-400" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
    </div>
  );
}

function Panel({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section className="rounded-card-lg border border-line bg-bg-card p-5">
      <h3 className="font-display text-lg text-white">{title}</h3>
      <p className="mt-1 text-xs font-bold text-cyan-100">{description}</p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function InfoCard({ icon, label, value }: { icon: string; label: string; value: string }) {
  return <div className="rounded-card-lg border border-cyan-400/25 bg-bg-card p-4"><div className="text-xs font-black text-cyan-100">{icon} {label}</div><div className="mt-2 font-mono text-xl font-black text-white">{value}</div></div>;
}

function MetricCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return <div className="rounded-card-md border border-cyan-400/20 bg-bg-card p-4"><div className="text-xs font-black text-cyan-100">{label}</div><div className="mt-2 font-mono text-xl font-black text-white">{value}</div><div className="mt-1 text-[11px] font-bold text-amber-100">{sub}</div></div>;
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-card-md border border-white/10 bg-black/20 p-3"><div className="text-[10px] font-black text-cyan-100">{label}</div><div className="mt-1 font-mono text-sm font-black text-white">{value}</div></div>;
}

function RecommendationCard({ title, main, detail }: { title: string; main: string; detail: string }) {
  return <div className="rounded-card-md border border-gold/35 bg-gold/10 p-4"><div className="text-xs font-black text-yellow-100">{title}</div><div className="mt-2 font-mono text-2xl font-black text-white">{main}</div><div className="mt-2 text-xs font-bold leading-5 text-amber-100">{detail}</div></div>;
}

function Badge({ text, tone }: { text: string; tone: 'cyan' | 'gold' | 'red' }) {
  const cls = tone === 'cyan' ? 'border-cyan-400/40 bg-cyan-500/10 text-cyan-100' : tone === 'red' ? 'border-red-400/40 bg-red-500/10 text-red-100' : 'border-yellow-400/40 bg-yellow-500/10 text-yellow-100';
  return <span className={`rounded-pill border px-2.5 py-1 text-[10px] font-black ${cls}`}>{text}</span>;
}

function NoData({ text }: { text: string }) {
  return <div className="rounded-card-md border border-dashed border-cyan-400/30 bg-bg-deep p-5 text-center text-xs font-bold text-amber-100">{text}</div>;
}

function LoadingBlock() {
  return <div className="flex min-h-[420px] items-center justify-center rounded-card-lg border border-line bg-bg-card"><LoadingSpinner size="lg" /></div>;
}

function EmptyAnalysis() {
  return <div className="rounded-card-lg border border-dashed border-cyan-400/30 bg-bg-card p-10 text-center"><div className="text-5xl">📊</div><div className="mt-3 font-display text-lg text-white">분석할 레이드를 선택해주세요</div></div>;
}

function ErrorPanel({ message }: { message: string }) {
  return <div className="rounded-card-lg border border-red-400/50 bg-red-950/45 p-6 text-center"><div className="text-3xl">⚠️</div><div className="mt-2 font-display text-lg text-white">분석 데이터를 불러오지 못했습니다</div><div className="mt-2 break-all text-sm font-bold text-red-100">{message}</div></div>;
}

function difficultyLabel(value: string) {
  if (value === 'LOW') return '낮음';
  if (value === 'BALANCED') return '균형권';
  if (value === 'HIGH') return '높음';
  return '데이터 없음';
}

function patternLabel(value: string) {
  const labels: Record<string, string> = {
    WEAK_POINT: '🎯 약점 노출', BREAK: '💥 BREAK', ABSORB: '🌀 흡수', REFLECT: '↩️ 반격', ULTIMATE: '☄️ 대형 필살기',
    DOT: '☠️ 지속 피해', SHIELD: '🛡️ 보호막', MULTI_CORE: '🔷 다중 핵', SPLIT_TARGET: '⚖️ 분산 공격', REGEN: '💚 재생',
    SEAL: '🔒 봉인', DAMAGE_CHECK: '⏱️ 시간 압박', ENRAGE: '🔥 광폭화',
  };
  return labels[value] ?? value;
}

function number(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatNumber(value: number) {
  return Math.round(value).toLocaleString('ko-KR');
}

function formatPercent(value: number) {
  return `${Number(value || 0).toFixed(1)}%`;
}

function formatSeconds(value: number) {
  const seconds = Math.max(0, Math.round(value));
  const min = Math.floor(seconds / 60);
  const sec = seconds % 60;
  return min > 0 ? `${min}분 ${sec}초` : `${sec}초`;
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '알 수 없는 오류';
}

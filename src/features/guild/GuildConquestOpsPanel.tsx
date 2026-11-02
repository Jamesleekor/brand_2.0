// =====================================================================
// B.R.A.N.D 2.0 — Guild5 점령 운영 패널 (교사)
// 2026-11-02
// ---------------------------------------------------------------------
// 흐름: ① 점령 길드 세율 선언(10~50%) → ② (선택) 4·5위 길드 이의 제기 + 투표 결과 입력
//       → ③ 세율 최종 확정 = 그 달 과세 경매에 일괄 징수 → ④ 걷힌 세금을 점령 길드원에게 분배
// 계산·돈 이동은 모두 서버 RPC(teacher_*_guild5_*)가 한다. 이 화면은 입력과 표시만 담당한다.
// =====================================================================

import { useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LoadingSpinner } from '@/components/shared/components';
import { supabase } from '@/lib/supabase/client';
import {
  guild5ConquestRpc,
  guild5RpcError,
  type Guild5ConquestOps,
  type Guild5ConquestTurnOps,
  type Guild5Objection,
  type Guild5TerritoryCategory,
} from '@/lib/rpc/guild5_rpc';
import { useToastStore } from '@/stores/ui_store';

const num = (value: unknown) => Number(value ?? 0).toLocaleString('ko-KR', { maximumFractionDigits: 2 });
const pct = (value: unknown) => `${Number(value ?? 0).toLocaleString('ko-KR', { maximumFractionDigits: 2 })}%`;
const dt = (value?: string | null) => (value ? new Date(value).toLocaleString('ko-KR') : '-');
const slotLabel: Record<number, string> = { 1: '좌측 산악 거점', 2: '중앙 왕성 거점', 3: '우측 해안 거점' };
const CATEGORIES: Guild5TerritoryCategory[] = ['1인1역', '자리', '급식순서'];
const categoryTerritory: Record<Guild5TerritoryCategory, string> = { '1인1역': '산악 요새', '자리': '중앙 왕성', '급식순서': '우측 해안' };

type RunFn = (label: string, fn: () => Promise<any>) => void;

function liveObjection(turn: Guild5ConquestTurnOps): Guild5Objection | null {
  return turn.objections.find((o) => o.status !== 'WITHDRAWN') ?? null;
}

function useConquestRunner(yearMonth: string) {
  const qc = useQueryClient();
  const show = useToastStore((s) => s.show);
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: async (job: { label: string; fn: () => Promise<any> }) => {
      const r = await job.fn();
      if (!r.success) throw new Error(guild5RpcError(r, '점령 운영 작업을 완료하지 못했습니다.'));
      return { label: job.label, data: r.data };
    },
    onMutate: () => setError(null),
    onSuccess: ({ label }) => {
      show({ title: label, variant: 'success' });
      void qc.invalidateQueries({ queryKey: ['guild5-conquest-ops', yearMonth] });
      void qc.invalidateQueries({ queryKey: ['guild5-conquest-history'] });
      void qc.invalidateQueries({ queryKey: ['guild5-dashboard', yearMonth] });
    },
    onError: (e) => {
      const message = (e as Error).message;
      setError(message);
      show({ title: '점령 운영 오류', description: message, variant: 'error', duration: 8000 });
    },
  });
  const run: RunFn = (label, fn) => m.mutate({ label, fn });
  return { run, busy: m.isPending, error };
}

// ─────────────────────────────────────────────────────────────────────
// 이번 달 점령 운영
// ─────────────────────────────────────────────────────────────────────
export function GuildConquestOpsPanel({ yearMonth }: { yearMonth: string }) {
  const opsQ = useQuery({
    queryKey: ['guild5-conquest-ops', yearMonth],
    queryFn: async () => {
      const r = await guild5ConquestRpc.ops(supabase, { p_year_month: yearMonth });
      if (!r.success) throw new Error(guild5RpcError(r));
      return r.data;
    },
  });
  const { run, busy, error } = useConquestRunner(yearMonth);

  return (
    <section className="glass-card p-4 space-y-4">
      <div>
        <h2 className="font-display text-xl text-white">⚖️ 점령 운영 · 세율 · 이의 제기 · 징수 · 분배</h2>
        <p className="mt-1 text-xs text-amber-100">
          ① 점령 길드 세율 선언(10~50%) → ② 4·5위 길드 이의 제기와 투표 결과 입력(찬성 14표 이상 통과) → ③ 세율 최종 확정 시 그 달 과세 경매에 일괄 징수 → ④ 걷힌 세금을 점령 길드원에게 분배(4인 길드는 5등분, 남는 1/5은 운영국 회수)
        </p>
      </div>
      {error && <div role="alert" className="rounded-card-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger"><b>최근 작업 오류</b><div className="mt-1 break-all">{error}</div></div>}
      {opsQ.isLoading ? <div className="py-10 flex justify-center"><LoadingSpinner size="lg" /></div>
        : opsQ.isError ? <div className="text-danger text-sm">{(opsQ.error as Error).message}</div>
        : opsQ.data ? <OpsBody data={opsQ.data} busy={busy} run={run} /> : null}
    </section>
  );
}

function OpsBody({ data, busy, run }: { data: Guild5ConquestOps; busy: boolean; run: RunFn }) {
  const assignedTurns = data.turns.filter((t) => ['ASSIGNED', 'AUTO_ASSIGNED'].includes(t.turn_status) && t.territory_id);
  const objectorCandidates = data.guilds.filter((g) => Number(g.rank_position) >= 4 && Number(g.rank_position) <= 5);

  return (
    <>
      {data.prior_tax_conflicts.length > 0 && data.version_id && (
        <PriorTaxConflictCard data={data} busy={busy} run={run} />
      )}

      {!data.finalized ? (
        <div className="rounded-card-md border border-warning/30 bg-warning/5 p-3 text-sm text-amber-100">
          이 달은 아직 FINAL 전입니다. 월간 마감을 FINAL로 확정하면 1~3위 점령과 세율 운영이 열립니다. 아래 표는 현재 길드 구성 기준 미리보기입니다.
        </div>
      ) : (
        <div className="grid lg:grid-cols-3 gap-3">
          {[1, 2, 3].map((slot) => {
            const turn = assignedTurns.find((t) => Number(t.slot_no) === slot);
            const econ = data.economy.find((e) => Number(e.slot_no) === slot);
            return turn
              ? <TerritoryOpsCard key={slot} turn={turn} econ={econ} candidates={objectorCandidates} threshold={data.vote_threshold} studentCount={data.student_count} busy={busy} run={run} />
              : <div key={slot} className="rounded-card-md border border-line bg-bg-deep p-3">
                  <div className="text-xs font-black text-bv-200">영토 {slot} · {slotLabel[slot]}</div>
                  <div className="mt-2 text-sm text-amber-100">아직 점령 길드가 정해지지 않았습니다. 위 「정복 영토」 카드에서 점령을 확정하면 세율 선언이 열립니다.</div>
                </div>;
          })}
        </div>
      )}

      <GuildFundTable data={data} />
    </>
  );
}

function PriorTaxConflictCard({ data, busy, run }: { data: Guild5ConquestOps; busy: boolean; run: RunFn }) {
  const total = data.prior_tax_conflicts.reduce((s, c) => s + Number(c.assessed_amount), 0);
  const collected = data.prior_tax_conflicts.reduce((s, c) => s + Number(c.collected_amount), 0);
  const round = data.prior_tax_conflicts[0]?.auction_round_number;
  const priorMonth = data.prior_tax_conflicts[0]?.prior_year_month;
  const refund = () => {
    const reason = window.prompt(`${round}회차 경매 세금을 환급하는 사유를 입력하세요.`, `${round}회차 경매는 ${data.year_month} 점령 길드 몫`)?.trim() ?? '';
    if (reason.length < 2) return;
    if (!window.confirm(`${priorMonth} 점령 기준으로 ${round}회차 경매에서 걷힌 세금을 낙찰자에게 돌려줄까요?\n부과 ${num(total)}G · 실제 징수 ${num(collected)}G가 환급되고, 남은 미납은 면제됩니다.\n이후 ${data.year_month} 점령 길드의 확정 세율로 다시 걷습니다.`)) return;
    run('이전 점령 세금을 환급했어요', () => guild5ConquestRpc.refundPriorTax(supabase, { p_version_id: Number(data.version_id), p_reason: reason }));
  };
  return (
    <div className="rounded-card-md border border-warning/40 bg-warning/10 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-black text-warning">⚠️ 이번 달 과세 경매({round}회차)에 이전 점령 기준 세금이 걸려 있습니다</div>
          <p className="mt-1 text-xs text-amber-100">세율을 확정하기 전에 먼저 환급해야 합니다. 환급하면 낙찰자에게 GOLD가 돌아가고, 이번 달 점령 길드의 확정 세율로 다시 걷습니다.</p>
        </div>
        <button className="btn-primary" disabled={busy} onClick={refund}>↩ 이전 점령 세금 환급</button>
      </div>
      <div className="mt-2 grid sm:grid-cols-3 gap-2">
        {data.prior_tax_conflicts.map((c) => (
          <div key={`${c.prior_version_id}-${c.slot_no}`} className="rounded-card-md border border-line bg-bg-deep p-2 text-xs text-amber-100">
            <div className="font-black text-white">{c.territory_name} · {c.auction_category}</div>
            <div className="mt-1">{c.prior_year_month} 점령 {c.owner_guild_name ?? '-'}</div>
            <div className="mt-1">부과 <b className="text-gold">{num(c.assessed_amount)}G</b> · 징수 <b className="text-success">{num(c.collected_amount)}G</b> · {c.assessment_count}건</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusChip({ turn }: { turn: Guild5ConquestTurnOps }) {
  const s = turn.settlement;
  const o = liveObjection(turn);
  let text = '세율 미선언';
  let cls = 'border-warning/40 text-warning';
  if (s?.status === 'FINALIZED') { text = '확정 · 징수 완료'; cls = 'border-success/40 text-success'; }
  else if (o?.status === 'FILED') { text = '이의 제기 · 투표 대기'; cls = 'border-danger/40 text-danger'; }
  else if (o?.status === 'PASSED') { text = '이의 제기 통과'; cls = 'border-crystal/40 text-crystal-200'; }
  else if (o?.status === 'REJECTED') { text = '이의 제기 부결'; cls = 'border-bv/40 text-bv-200'; }
  else if (s) { text = `${pct(s.declared_rate_percent)} 선언`; cls = 'border-gold/40 text-gold'; }
  return <span className={`rounded-pill border px-2 py-0.5 text-[10px] font-black ${cls}`}>{text}</span>;
}

function TerritoryOpsCard({ turn, econ, candidates, threshold, studentCount, busy, run }: {
  turn: Guild5ConquestTurnOps;
  econ?: Guild5ConquestOps['economy'][number];
  candidates: Guild5ConquestOps['guilds'];
  threshold: number;
  studentCount: number;
  busy: boolean;
  run: RunFn;
}) {
  const s = turn.settlement;
  const o = liveObjection(turn);
  const finalized = s?.status === 'FINALIZED';
  const [rate, setRate] = useState<number>(Number(s?.declared_rate_percent ?? 30));
  const [objGuild, setObjGuild] = useState<number>(Number(candidates.find((g) => g.guild_id !== turn.guild_id)?.guild_id ?? 0));
  const [objRate, setObjRate] = useState<number>(10);
  const [objNote, setObjNote] = useState('');
  const [yes, setYes] = useState<number>(Number(o?.yes_votes ?? 0));
  const [no, setNo] = useState<number>(Number(o?.no_votes ?? 0));

  const finalRatePreview = o?.status === 'PASSED' ? Number(o.proposed_rate_percent) : Number(s?.declared_rate_percent ?? 0);
  const ownerName = turn.guild_name ?? `Guild #${turn.guild_id}`;

  const declare = () => {
    if (!Number.isFinite(rate) || rate < 10 || rate > 50) return;
    run(`${turn.territory_name} 세율 ${rate}%를 선언했어요`, () => guild5ConquestRpc.declareRate(supabase, { p_turn_id: turn.turn_id, p_rate_percent: rate }));
  };
  const fileObjection = () => {
    if (!s || !objGuild) return;
    const g = candidates.find((x) => x.guild_id === objGuild);
    if (!window.confirm(`${g?.rank_position}위 ${g?.guild_name} 길드의 이의 제기를 접수할까요?\n${turn.territory_name}: 선언 ${pct(s.declared_rate_percent)} → 요구 ${pct(objRate)}\n부결되면 ${g?.guild_name} 길드원은 이 영토 세율에 +10%p를 더 냅니다.`)) return;
    run('이의 제기를 접수했어요', () => guild5ConquestRpc.fileObjection(supabase, { p_settlement_id: s.id, p_objector_guild_id: objGuild, p_proposed_rate_percent: objRate, p_note: objNote.trim() || null }));
  };
  const recordVote = () => {
    if (!o) return;
    const verdict = yes >= Number(o.vote_threshold) ? `통과 → 최종 세율 ${pct(o.proposed_rate_percent)}` : `부결 → 세율 ${pct(o.declared_rate_snapshot)} 유지 + ${o.objector_guild_name_snapshot} 길드원 +10%p`;
    if (!window.confirm(`투표 결과: 찬성 ${yes} · 반대 ${no}\n기준 ${o.vote_threshold}표 → ${verdict}\n저장할까요? (세율 최종 확정 전까지 다시 입력할 수 있습니다)`)) return;
    run('투표 결과를 저장했어요', () => guild5ConquestRpc.recordVote(supabase, { p_objection_id: o.id, p_yes_votes: yes, p_no_votes: no }));
  };
  const withdraw = () => {
    if (!o) return;
    const reason = window.prompt('이의 제기를 취소하는 사유를 입력하세요.', '')?.trim() ?? '';
    if (reason.length < 2) return;
    run('이의 제기를 취소했어요', () => guild5ConquestRpc.withdrawObjection(supabase, { p_objection_id: o.id, p_reason: reason }));
  };
  const finalize = () => {
    if (!s) return;
    const surchargeText = o?.status === 'REJECTED' ? `\n${o.objector_guild_name_snapshot} 길드원은 ${pct(finalRatePreview + 10)}로 과세됩니다.` : '';
    if (!window.confirm(`${turn.territory_name} 세율을 ${pct(finalRatePreview)}로 최종 확정하고 ${econ?.auction_round_number ?? '-'}회차 ${turn.auction_category} 낙찰자에게 세금을 걷을까요?${surchargeText}\n확정 뒤에는 세율·이의 제기·투표 결과를 바꿀 수 없습니다.`)) return;
    run(`${turn.territory_name} 세율을 확정하고 세금을 걷었어요`, () => guild5ConquestRpc.finalizeRate(supabase, { p_settlement_id: s.id }));
  };
  const divisor = Number(turn.distribution_divisor || 5);
  const perMember = Math.floor(Number(turn.distributable_amount) / divisor);
  const distribute = () => {
    if (!s) return;
    if (!window.confirm(`${ownerName} 길드원 ${turn.roster_count}명에게 영토세를 분배할까요?\n분배 대상 ${num(turn.distributable_amount)}G ÷ ${divisor} = 1인당 ${num(perMember)}G\n운영국 회수 ${num(Number(turn.distributable_amount) - perMember * turn.roster_count)}G`)) return;
    run('영토세를 길드원에게 분배했어요', () => guild5ConquestRpc.distribute(supabase, { p_settlement_id: s.id }));
  };

  return (
    <div className={`rounded-card-md border p-3 space-y-3 ${finalized ? 'border-success/35 bg-success/5' : 'border-gold/30 bg-bg-deep'}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-xs font-black text-bv-200">영토 {turn.slot_no} · {slotLabel[Number(turn.slot_no)] ?? ''}</div>
          <div className="mt-0.5 font-display text-lg text-white">{turn.territory_name}</div>
          <div className="text-xs text-amber-100">{turn.rank_position}위 <b className="text-gold">{ownerName}</b> · {turn.roster_count}명 · {turn.auction_category} · {econ?.auction_round_number ? `${econ.auction_round_number}회차 경매` : '과세 경매 없음'}</div>
        </div>
        <StatusChip turn={turn} />
      </div>

      {/* ① 세율 선언 */}
      <Step title="① 점령 길드 세율 선언" done={Boolean(s)}>
        {finalized ? (
          <div className="text-sm text-amber-100">선언 {pct(s?.declared_rate_percent)} → 최종 <b className="text-success">{pct(s?.final_rate_percent)}</b></div>
        ) : (
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-[11px] font-black text-amber-100">세율(10~50%)
              <input type="number" min={10} max={50} step={1} className="input-field block mt-1 w-24" value={rate}
                onChange={(e) => { const v = Number(e.target.value); setRate(Number.isFinite(v) ? v : 10); }} disabled={busy || Boolean(o)} />
            </label>
            <button className="btn-secondary" disabled={busy || Boolean(o) || rate < 10 || rate > 50} onClick={declare}>{s ? '선언 세율 수정' : '세율 선언'}</button>
            {s && <span className="text-[11px] text-gold">현재 선언 {pct(s.declared_rate_percent)}</span>}
            {o && <span className="text-[11px] text-warning">이의 제기 접수 후에는 수정 불가</span>}
          </div>
        )}
      </Step>

      {/* ② 이의 제기 */}
      <Step title="② 이의 제기 (4·5위 · 영토당 1건)" done={Boolean(o && o.status !== 'FILED') || (finalized && !o)}>
        {!s ? <div className="text-xs text-amber-100">세율을 먼저 선언해야 이의 제기를 받을 수 있습니다.</div>
          : o ? (
            <div className="space-y-2">
              <div className="text-sm text-amber-100">
                <b className="text-white">{o.objector_rank_position}위 {o.objector_guild_name_snapshot}</b> · 선언 {pct(o.declared_rate_snapshot)} → 요구 <b className="text-crystal-200">{pct(o.proposed_rate_percent)}</b>
                {o.note && <div className="text-[11px] mt-0.5">사유: {o.note}</div>}
              </div>
              {o.status !== 'FILED' && (
                <div className={`text-sm font-black ${o.status === 'PASSED' ? 'text-crystal-200' : 'text-bv-200'}`}>
                  찬성 {o.yes_votes} · 반대 {o.no_votes} → {o.status === 'PASSED' ? `통과 (최종 ${pct(o.proposed_rate_percent)})` : `부결 (${o.objector_guild_name_snapshot} 길드원 +10%p)`}
                </div>
              )}
              {!finalized && (
                <div className="flex flex-wrap items-end gap-2">
                  <label className="text-[11px] font-black text-amber-100">찬성
                    <input type="number" min={0} max={studentCount || 30} className="input-field block mt-1 w-20" value={yes} onChange={(e) => setYes(Math.max(0, Math.trunc(Number(e.target.value) || 0)))} disabled={busy} />
                  </label>
                  <label className="text-[11px] font-black text-amber-100">반대
                    <input type="number" min={0} max={studentCount || 30} className="input-field block mt-1 w-20" value={no} onChange={(e) => setNo(Math.max(0, Math.trunc(Number(e.target.value) || 0)))} disabled={busy} />
                  </label>
                  <button className="btn-secondary" disabled={busy || yes + no < 1} onClick={recordVote}>{o.status === 'FILED' ? '투표 결과 저장' : '투표 결과 다시 저장'}</button>
                  <button className="text-[11px] underline text-warning" disabled={busy} onClick={withdraw}>이의 제기 취소</button>
                  <div className="w-full text-[11px] text-amber-100">찬성 {threshold}표 이상이면 통과 · 이번 달 인원 {studentCount}명</div>
                </div>
              )}
            </div>
          ) : finalized ? (
            <div className="text-xs text-amber-100">이의 제기 없이 확정되었습니다.</div>
          ) : candidates.length === 0 ? (
            <div className="text-xs text-amber-100">이번 달 4·5위 길드가 없어 이의 제기를 받을 수 없습니다.</div>
          ) : (
            <div className="space-y-2">
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-[11px] font-black text-amber-100">제기 길드
                  <select className="input-field block mt-1" value={objGuild} onChange={(e) => setObjGuild(Number(e.target.value))} disabled={busy}>
                    {candidates.map((g) => <option key={g.guild_id} value={g.guild_id}>{g.rank_position}위 {g.guild_name}</option>)}
                  </select>
                </label>
                <label className="text-[11px] font-black text-amber-100">요구 세율
                  <input type="number" min={10} max={50} step={1} className="input-field block mt-1 w-20" value={objRate} onChange={(e) => { const v = Number(e.target.value); setObjRate(Number.isFinite(v) ? v : 10); }} disabled={busy} />
                </label>
              </div>
              <input className="input-field w-full" placeholder="이의 제기 사유 (선택)" value={objNote} onChange={(e) => setObjNote(e.target.value)} disabled={busy} />
              <button className="btn-secondary w-full" disabled={busy || !objGuild || objRate < 10 || objRate >= Number(s.declared_rate_percent)} onClick={fileObjection}>이의 제기 접수</button>
              {objRate >= Number(s.declared_rate_percent) && <div className="text-[11px] text-warning">요구 세율은 선언 세율({pct(s.declared_rate_percent)})보다 낮아야 합니다.</div>}
            </div>
          )}
      </Step>

      {/* ③ 최종 확정 · 징수 */}
      <Step title="③ 세율 최종 확정 · 세금 징수" done={finalized}>
        {finalized ? (
          <div className="grid grid-cols-3 gap-1.5">
            <Mini label="부과" value={`${num(turn.tax.assessed_amount)}G`} cls="text-white" />
            <Mini label="징수 완료" value={`${num(turn.tax.collected_amount)}G`} cls="text-success" />
            <Mini label="미납" value={`${num(turn.tax.outstanding_amount)}G`} cls={Number(turn.tax.outstanding_amount) > 0 ? 'text-warning' : 'text-amber-100'} />
            <Mini label="납세 건수" value={`${num(turn.tax.assessment_count)}건 · ${num(turn.tax.taxpayer_count)}명`} cls="text-amber-100" />
            <Mini label="+10%p 가산" value={`${num(turn.tax.surcharge_count)}건 · ${num(turn.tax.surcharge_assessed_amount)}G`} cls="text-bv-200" />
            <Mini label="확정 시각" value={dt(s?.finalized_at)} cls="text-amber-100" />
          </div>
        ) : !s ? (
          <div className="text-xs text-amber-100">세율 선언 후 확정할 수 있습니다.</div>
        ) : (
          <div className="space-y-2">
            <div className="text-sm text-amber-100">
              확정 세율 <b className="text-gold">{pct(finalRatePreview)}</b>
              {o?.status === 'REJECTED' && <> · {o.objector_guild_name_snapshot} 길드원 <b className="text-bv-200">{pct(finalRatePreview + 10)}</b></>}
              {econ?.auction_gold_spend != null && <> · 과세 대상 GOLD {num(econ.auction_gold_spend)}G</>}
            </div>
            <button className="btn-primary w-full" disabled={busy || o?.status === 'FILED'} onClick={finalize}>세율 최종 확정 · 세금 징수</button>
            {o?.status === 'FILED' && <div className="text-[11px] text-warning">투표 결과를 먼저 입력해주세요.</div>}
          </div>
        )}
      </Step>

      {/* ④ 분배 */}
      <Step title="④ 점령 길드원에게 분배" done={finalized && Number(turn.distributable_amount) <= 0 && turn.distributions.length > 0}>
        {!finalized ? (
          <div className="text-xs text-amber-100">세금을 걷은 뒤 분배할 수 있습니다.</div>
        ) : (
          <div className="space-y-2">
            <div className="text-sm text-amber-100">
              분배 가능 <b className="text-gold">{num(turn.distributable_amount)}G</b> ÷ {divisor} = 1인당 <b className="text-success">{num(perMember)}G</b>
              {turn.roster_count < 5 && <span className="text-[11px]"> ({turn.roster_count}인 길드 → 남는 몫은 운영국 회수)</span>}
            </div>
            <button className="btn-secondary w-full" disabled={busy || perMember < 1} onClick={distribute}>길드원에게 분배</button>
            {turn.distributions.length > 0 && (
              <div className="space-y-1">
                {turn.distributions.map((d) => (
                  <div key={d.id} className="rounded-card-md border border-line bg-bg-card/70 p-2 text-[11px] text-amber-100">
                    <div><b className="text-white">{dt(d.created_at)}</b> · 기준 {num(d.basis_amount)}G ÷ {d.divisor} = {num(d.per_member_amount)}G × {d.paid_member_count}명</div>
                    <div>지급 {num(d.distributed_amount)}G · 운영국 회수 {num(d.retained_amount)}G</div>
                    <div className="mt-0.5">{d.lines.map((l) => `${l.student_name ?? `#${l.student_id}`}${l.line_status === 'PAID' ? '' : '(전출 제외)'}`).join(', ')}</div>
                  </div>
                ))}
              </div>
            )}
            {Number(turn.tax.outstanding_amount) > 0 && <div className="text-[11px] text-warning">미납 {num(turn.tax.outstanding_amount)}G는 학생이 갚는 대로 '분배 가능' 금액에 더해집니다.</div>}
          </div>
        )}
      </Step>
    </div>
  );
}

function Step({ title, done, children }: { title: string; done: boolean; children: ReactNode }) {
  return (
    <div className={`rounded-card-md border p-2.5 ${done ? 'border-success/25 bg-success/5' : 'border-line bg-bg-card/70'}`}>
      <div className={`text-[11px] font-black mb-1.5 ${done ? 'text-success' : 'text-white'}`}>{done ? '✓ ' : ''}{title}</div>
      {children}
    </div>
  );
}

function Mini({ label, value, cls }: { label: string; value: string; cls: string }) {
  return <div><div className="text-[10px] text-amber-100">{label}</div><div className={`text-[12px] font-black ${cls}`}>{value}</div></div>;
}

// ─────────────────────────────────────────────────────────────────────
// 길드별 거점 자금표
// ─────────────────────────────────────────────────────────────────────
function GuildFundTable({ data }: { data: Guild5ConquestOps }) {
  const totals = useMemo(() => {
    const t: Record<string, { gold: number; sp: number; spValue: number }> = {};
    for (const c of CATEGORIES) t[c] = { gold: 0, sp: 0, spValue: 0 };
    for (const r of data.guild_spend) {
      const x = t[r.auction_category];
      if (!x) continue;
      x.gold += Number(r.gold_spend);
      x.sp += Number(r.super_pass_count);
      x.spValue += Number(r.super_pass_count) * Number(r.super_pass_unit_value);
    }
    return t;
  }, [data.guild_spend]);
  const econBy = new Map(data.economy.map((e) => [e.auction_category, e]));
  const round = data.economy.find((e) => e.auction_round_number)?.auction_round_number;

  if (!data.auction_id) {
    return <div className="rounded-card-md border border-line bg-bg-deep p-3 text-sm text-amber-100">🏦 거점별 길드 자금: 이번 달 과세 대상 경매가 아직 없습니다.</div>;
  }

  return (
    <div className="rounded-card-md border border-line bg-bg-deep p-3">
      <h3 className="font-black text-white">🏦 거점별 길드 자금 · {round ?? '-'}회차 경매</h3>
      <p className="mt-1 text-[11px] text-amber-100">
        각 길드원이 이번 달 과세 경매에서 쓴 GOLD(영토세 과세 대상)와 실제 소모한 SUPER PASS입니다. 「10%p당 순이익」은 그 거점을 점령해 세율 10%를 매겼을 때 길드 전체가 얻는 값 = (경매 전체 GOLD × 길드원 수 ÷ 나누는 수) × 10% − 우리 길드원이 내는 세금 × 10%.
      </p>
      <div className="overflow-x-auto mt-2">
        <table className="w-full text-xs">
          <thead className="border-b border-line text-amber-100">
            <tr>
              <th className="px-2 py-1.5 text-left font-black whitespace-nowrap">길드</th>
              {CATEGORIES.map((c) => <th key={c} className="px-2 py-1.5 text-left font-black whitespace-nowrap">{categoryTerritory[c]} <span className="text-gold">({c})</span></th>)}
            </tr>
          </thead>
          <tbody>
            {data.guilds.map((g) => {
              const divisor = Math.max(Number(g.roster_count), 5);
              return (
                <tr key={g.guild_id} className="border-b border-line/50">
                  <td className="px-2 py-1.5 whitespace-nowrap text-white">
                    {g.rank_position ? <b className={Number(g.rank_position) <= 3 ? 'text-gold' : 'text-crystal-200'}>{g.rank_position}위 </b> : null}
                    {g.guild_name} <span className="text-amber-100">· {g.roster_count}명</span>
                  </td>
                  {CATEGORIES.map((c) => {
                    const row = data.guild_spend.find((r) => r.guild_id === g.guild_id && r.auction_category === c);
                    const gold = Number(row?.gold_spend ?? 0);
                    const total = totals[c].gold;
                    const share = total > 0 ? (gold / total) * 100 : 0;
                    const netPer10 = Math.floor(0.1 * (total * Number(g.roster_count) / divisor - gold));
                    return (
                      <td key={c} className="px-2 py-1.5 whitespace-nowrap align-top">
                        <div className="font-black text-white">{num(gold)}G <span className="text-amber-100 font-normal">({share.toFixed(1)}%)</span></div>
                        <div className="text-[10px] text-amber-100">낙찰 {row?.item_count ?? 0}건 · SUPER PASS {row?.super_pass_count ?? 0}장</div>
                        <div className={`text-[10px] font-black ${netPer10 >= 0 ? 'text-success' : 'text-danger'}`}>10%p당 순이익 {netPer10 >= 0 ? '+' : ''}{num(netPer10)}G</div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            <tr>
              <td className="px-2 py-1.5 font-black text-gold whitespace-nowrap">경매 전체</td>
              {CATEGORIES.map((c) => {
                const e = econBy.get(c);
                return (
                  <td key={c} className="px-2 py-1.5 whitespace-nowrap">
                    <div className="font-black text-gold">GOLD {num(e?.auction_gold_spend ?? totals[c].gold)}G</div>
                    <div className="text-[10px] text-amber-100">SUPER PASS {num(e?.super_pass_consumed_count ?? totals[c].sp)}장 · 환산 {num(e?.super_pass_equivalent_value ?? totals[c].spValue)}G</div>
                    <div className="text-[10px] text-amber-100">영토 자금 {num(e?.gross_spend ?? totals[c].gold + totals[c].spValue)}G</div>
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// 점령 이력
// ─────────────────────────────────────────────────────────────────────
export function GuildConquestHistoryPanel() {
  const historyQ = useQuery({
    queryKey: ['guild5-conquest-history'],
    queryFn: async () => {
      const r = await guild5ConquestRpc.history(supabase);
      if (!r.success) throw new Error(guild5RpcError(r));
      return r.data;
    },
  });

  return (
    <section className="glass-card p-4">
      <h2 className="font-display text-lg text-white">📜 점령 이력</h2>
      <p className="mt-1 text-xs text-amber-100">FINAL로 확정된 모든 달의 점령 길드 · 세율 · 이의 제기 · 징수 · 분배 기록입니다.</p>
      {historyQ.isLoading ? <div className="py-8 flex justify-center"><LoadingSpinner /></div>
        : historyQ.isError ? <div className="mt-2 text-sm text-danger">{(historyQ.error as Error).message}</div>
        : !historyQ.data?.length ? <div className="mt-2 text-sm text-amber-100">아직 기록이 없습니다.</div>
        : (
          <div className="mt-3 space-y-2">
            {historyQ.data.map((m, idx) => (
              <details key={m.version_id} open={idx === 0} className="rounded-card-md border border-line bg-bg-deep p-3">
                <summary className="cursor-pointer list-none">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <b className="text-white">{m.year_month}</b>
                    <span className="text-[11px] text-amber-100">v{m.version_no} · FINAL {dt(m.finalized_at)} · 정복 {m.conquest_status}</span>
                  </div>
                  <div className="mt-1 text-[11px] text-amber-100">
                    {m.rankings.map((r) => `${r.rank_position}위 ${r.guild_name}`).join(' · ')}
                  </div>
                </summary>
                <div className="mt-2 grid md:grid-cols-3 gap-2">
                  {m.territories.map((t) => <HistoryTerritory key={t.turn_id} t={t} round={m.economy.find((e) => Number(e.slot_no) === Number(t.slot_no))?.auction_round_number} />)}
                </div>
              </details>
            ))}
          </div>
        )}
    </section>
  );
}

function HistoryTerritory({ t, round }: { t: Guild5ConquestTurnOps; round?: number | null }) {
  const o = liveObjection(t);
  const rate = t.settlement?.final_rate_percent ?? t.settlement?.declared_rate_percent ?? t.rate_snapshot;
  const distributed = t.distributions.reduce((s, d) => s + Number(d.distributed_amount), 0);
  const retained = t.distributions.reduce((s, d) => s + Number(d.retained_amount), 0);
  if (!t.territory_id) {
    return <div className="rounded-card-md border border-line bg-bg-card/70 p-2 text-xs text-amber-100">{t.rank_position}위 {t.guild_name} · 점령 전 ({t.turn_status})</div>;
  }
  return (
    <div className="rounded-card-md border border-line bg-bg-card/70 p-2.5 text-xs text-amber-100 space-y-1">
      <div className="font-black text-white">{t.territory_name} <span className="text-gold">· {t.rank_position}위 {t.guild_name}</span></div>
      <div>
        세율 <b className="text-gold">{rate != null ? pct(rate) : '-'}</b>
        {t.settlement ? (t.settlement.status === 'FINALIZED' ? ' (확정)' : ' (선언·확정 전)') : ' (이전 방식)'}
        {' · '}{t.assignment_method === 'AUTO' ? '자동 배정' : '선택 배정'} · 과세 경매 {t.tax.auction_rounds.length ? t.tax.auction_rounds.map((r) => `${r}회차`).join(', ') : round ? `${round}회차(미징수)` : '-'}
      </div>
      {o && (
        <div>
          이의 제기: {o.objector_guild_name_snapshot} · 요구 {pct(o.proposed_rate_percent)} ·{' '}
          {o.status === 'FILED' ? '투표 대기' : <b className={o.status === 'PASSED' ? 'text-crystal-200' : 'text-bv-200'}>{o.status === 'PASSED' ? '통과' : '부결'} ({o.yes_votes}:{o.no_votes})</b>}
        </div>
      )}
      <div>부과 <b className="text-white">{num(t.tax.assessed_amount)}G</b> · 징수 <b className="text-success">{num(t.tax.collected_amount)}G</b> · 미납 <b className={Number(t.tax.outstanding_amount) > 0 ? 'text-warning' : 'text-amber-100'}>{num(t.tax.outstanding_amount)}G</b></div>
      {Number(t.tax.surcharge_count) > 0 && <div>+10%p 가산 {t.tax.surcharge_count}건 · {num(t.tax.surcharge_assessed_amount)}G</div>}
      {Number(t.tax.voided_count) > 0 && <div className="text-warning">환급 {t.tax.voided_count}건 · {num(t.tax.refunded_amount)}G 돌려줌</div>}
      <div>분배 {t.distributions.length ? <><b className="text-success">{num(distributed)}G</b> · 운영국 회수 {num(retained)}G</> : (t.settlement ? '아직 없음' : '패널 기록 없음')}</div>
    </div>
  );
}

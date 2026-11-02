import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Guild4TeacherRoundDetail } from '@/lib/rpc/guild4_rpc';

type Obligation = Guild4TeacherRoundDetail['obligations'][number];
type Direction = 'received' | 'written';

type StudentStats = {
  required: number;
  submitted: number;
  excused: number;
  average: number | null;
  missing: Obligation[];
  items: Obligation[];
};

function statsFor(obligations: Obligation[], studentId: number, direction: Direction): StudentStats {
  const items = obligations.filter((item) => Number(direction === 'received' ? item.target_student_id : item.reviewer_student_id) === studentId);
  const required = items.filter((item) => item.obligation_status === 'REQUIRED');
  const reviewed = required.filter((item) => item.latest_review != null);
  const scores = reviewed.map((item) => Number(item.latest_review?.score)).filter(Number.isFinite);
  return {
    items,
    required: required.length,
    submitted: reviewed.length,
    excused: items.length - required.length,
    average: scores.length > 0 ? scores.reduce((sum, score) => sum + score, 0) / scores.length : null,
    missing: required.filter((item) => !item.latest_review),
  };
}

const avgText = (value: number | null) => value === null ? '—' : value.toFixed(1);

export function GuildPeerReviewOverview({ detail }: { detail: Guild4TeacherRoundDetail }) {
  const participants = detail.participants;
  const roundId = Number(detail.round.id);
  const [selectedStudentId, setSelectedStudentId] = useState<number | null>(participants[0]?.student_id ?? null);
  const [direction, setDirection] = useState<Direction>('received');

  useEffect(() => {
    setSelectedStudentId(participants[0]?.student_id ?? null);
    setDirection('received');
  }, [roundId]);

  const stats = useMemo(() => {
    const result = new Map<number, { received: StudentStats; written: StudentStats }>();
    for (const student of participants) {
      const id = Number(student.student_id);
      result.set(id, {
        received: statsFor(detail.obligations, id, 'received'),
        written: statsFor(detail.obligations, id, 'written'),
      });
    }
    return result;
  }, [participants, detail.obligations]);

  const byPair = useMemo(() => {
    const result = new Map<string, Obligation>();
    for (const item of detail.obligations) result.set(`${item.reviewer_student_id}:${item.target_student_id}`, item);
    return result;
  }, [detail.obligations]);

  const required = detail.obligations.filter((item) => item.obligation_status === 'REQUIRED');
  const submitted = required.filter((item) => Boolean(item.latest_review));
  const incompleteStudents = participants.filter((student) => (stats.get(Number(student.student_id))?.written.missing.length ?? 0) > 0);
  const selectedStudent = participants.find((student) => Number(student.student_id) === Number(selectedStudentId)) ?? participants[0] ?? null;
  const selected = selectedStudent ? stats.get(Number(selectedStudent.student_id)) : undefined;
  const selectedList = selected?.[direction].items ?? [];
  const finalized = String(detail.round.lifecycle_state) === 'FINALIZED';

  if (!participants.length) return <div className="rounded-card-md border border-line bg-bg-deep p-5 text-sm text-[#f7eddc]">이 길드의 평가 참가자 스냅샷이 비어 있습니다.</div>;

  return <div className="space-y-5">
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="font-display text-xl text-[#fff0cf]">길드 동료평가 한눈에 보기</h3>
          <p className="mt-1 text-xs text-[#f2ddbc]">평균은 제출된 평가의 원점수(10점 만점) 기준이며, 미제출과 면제는 평균에서 제외합니다.</p>
        </div>
        <span className="rounded-full border border-line bg-bg-deep px-3 py-1.5 text-xs font-black text-[#fff0cf]">평가 {submitted.length}/{required.length}건</span>
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Summary label="길드원" value={`${participants.length}명`} />
        <Summary label="완료된 필수 평가" value={`${submitted.length}/${required.length}`} />
        <Summary label="평가 미완료 학생" value={`${incompleteStudents.length}명`} warning={incompleteStudents.length > 0} />
        <Summary label="평가 면제" value={`${detail.obligations.length - required.length}건`} />
      </div>
      {incompleteStudents.length > 0 ? (
        <div className="rounded-card-md border border-amber-500/40 bg-amber-500/10 p-3">
          <div className="font-black text-sm text-amber-200">미제출 학생과 평가 대상</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {incompleteStudents.map((student) => {
              const missing = stats.get(Number(student.student_id))?.written.missing ?? [];
              return <button key={student.student_id} type="button" onClick={() => { setSelectedStudentId(Number(student.student_id)); setDirection('written'); }} className="rounded-card-sm border border-amber-500/40 bg-bg-deep px-3 py-2 text-left text-xs text-[#fff0cf] hover:border-gold focus-visible:ring-2 focus-visible:ring-gold">
                <b>{student.student_name}</b> <span className="text-amber-200">{missing.length}건 미작성</span>
                <div className="mt-1 text-[#f2ddbc]">대상: {missing.map((item) => item.target_name).join(', ')}</div>
              </button>;
            })}
          </div>
        </div>
      ) : <p className="rounded-card-sm border border-success/30 bg-success/10 p-3 text-sm font-black text-emerald-200">✓ 모든 길드원이 필수 평가를 완료했습니다.</p>}
    </section>

    <section className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-display text-lg text-[#fff0cf]">길드원별 평가 요약</h3>
        <span className="text-xs text-[#f2ddbc]">학생을 선택하면 아래에서 받은 점수·준 점수와 의견을 확인할 수 있습니다.</span>
      </div>
      <div className="overflow-x-auto rounded-card-md border border-line">
        <table className="w-full min-w-[740px] border-collapse text-sm">
          <thead className="bg-bg-deep text-[#f5e3c5]"><tr><Header>길드원</Header><Header>받은 평균 /10</Header><Header>받은 평가</Header><Header>작성한 평가</Header><Header>아직 평가하지 않은 대상</Header>{finalized && <Header>Peer /300</Header>}</tr></thead>
          <tbody>{participants.map((student) => {
            const id = Number(student.student_id);
            const data = stats.get(id)!;
            const rollup = detail.score_rollups.find((item) => Number(item.student_id) === id);
            return <tr key={student.participant_id} onClick={() => { setSelectedStudentId(id); setDirection('received'); }} className={`cursor-pointer border-t border-line text-[#fff5e6] transition hover:bg-bv/15 ${Number(selectedStudent?.student_id) === id ? 'bg-bv/15' : ''}`}>
              <Cell><button type="button" className="font-black text-gold underline-offset-4 hover:underline" onClick={() => { setSelectedStudentId(id); setDirection('received'); }}>{student.student_name}</button></Cell>
              <Cell><span className="font-display text-lg">{avgText(data.received.average)}</span></Cell>
              <Cell><StatusCount done={data.received.submitted} required={data.received.required}/></Cell>
              <Cell><StatusCount done={data.written.submitted} required={data.written.required}/></Cell>
              <Cell>{data.written.missing.length ? <span className="font-black text-amber-200">{data.written.missing.map((item) => item.target_name).join(', ')}</span> : <span className="font-black text-emerald-200">완료 ✓</span>}</Cell>
              {finalized && <Cell>{rollup?.peer_points == null ? '—' : <span className="font-black text-gold">{Number(rollup.peer_points).toFixed(1)}</span>}</Cell>}
            </tr>;
          })}</tbody>
        </table>
      </div>
    </section>

    <section className="space-y-2">
      <h3 className="font-display text-lg text-[#fff0cf]">평가 점수 매트릭스</h3>
      <p className="text-xs text-[#f2ddbc]">세로 = 평가를 작성한 학생 · 가로 = 평가를 받은 학생. 점수를 누르면 해당 학생의 상세 평가가 표시됩니다.</p>
      <div className="overflow-x-auto rounded-card-md border border-line">
        <table className="w-full min-w-[600px] border-collapse text-center text-xs">
          <thead className="bg-bg-deep text-[#f5e3c5]"><tr><th scope="col" className="sticky left-0 z-10 min-w-[110px] border-r border-line bg-bg-deep px-3 py-3 text-left">평가자 ↘ 대상</th>{participants.map((student) => <th scope="col" key={student.student_id} className="min-w-[76px] px-2 py-3 font-black">{student.student_name}</th>)}<th scope="col" className="min-w-[86px] border-l border-line px-2 py-3">제출 현황</th></tr></thead>
          <tbody>{participants.map((reviewer) => {
            const reviewerId = Number(reviewer.student_id);
            const written = stats.get(reviewerId)!.written;
            return <tr key={reviewer.participant_id} className="border-t border-line text-[#fff5e6]">
              <th scope="row" className="sticky left-0 z-10 border-r border-line bg-bg-deep px-3 py-3 text-left font-black">{reviewer.student_name}</th>
              {participants.map((target) => {
                const targetId = Number(target.student_id);
                const item = byPair.get(`${reviewerId}:${targetId}`);
                if (reviewerId === targetId) return <td key={targetId} className="bg-bg-deep/60 p-2 text-[#eed5af]">—</td>;
                if (!item) return <td key={targetId} className="p-2 text-[#eed5af]">대상 외</td>;
                const excused = item.obligation_status === 'EXCUSED';
                const done = Boolean(item.latest_review) && !excused;
                return <td key={targetId} className="p-1.5"><button type="button" onClick={() => { setSelectedStudentId(targetId); setDirection('received'); }} title={`${reviewer.student_name} → ${target.student_name}: ${excused ? '면제' : done ? `${item.latest_review!.score}점` : '미제출'}`} className={`min-h-9 w-full rounded-card-sm border px-1 font-black transition focus-visible:ring-2 focus-visible:ring-gold ${excused ? 'border-line bg-bg-card text-[#f2ddbc]' : done ? 'border-emerald-600/30 bg-emerald-600/15 text-emerald-200 hover:border-gold' : 'border-amber-500/40 bg-amber-500/10 text-amber-200 hover:border-gold'}`}>
                  {excused ? '면제' : done ? item.latest_review!.score : '미제출'}
                </button></td>;
              })}
              <td className="border-l border-line p-2"><StatusCount done={written.submitted} required={written.required}/></td>
            </tr>;
          })}</tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-4 text-xs font-bold text-[#f2ddbc]"><span className="text-emerald-200">● 점수: 제출 완료</span><span className="text-amber-200">● 미제출: 평가 필요</span><span>● 면제: 평가 의무 제외</span></div>
    </section>

    {selectedStudent && selected && <section className="rounded-card-md border border-bv/40 bg-bg-deep p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><div className="text-xs font-black text-[#f2ddbc]">선택한 길드원</div><h3 className="mt-1 font-display text-xl text-[#fff0cf]">{selectedStudent.student_name}</h3><div className="mt-1 text-xs text-[#f2ddbc]">받은 평균 {avgText(selected.received.average)} / 10 · 받은 평가 {selected.received.submitted}/{selected.received.required} · 작성 {selected.written.submitted}/{selected.written.required}</div></div>
        <div className="flex flex-wrap gap-1 rounded-card-sm border border-line bg-bg-card p-1">
          <Tab active={direction === 'received'} onClick={() => setDirection('received')}>받은 평가</Tab>
          <Tab active={direction === 'written'} onClick={() => setDirection('written')}>작성한 평가</Tab>
        </div>
      </div>
      <div className="mt-3 space-y-2">
        {selectedList.length === 0 && <p className="text-sm text-[#f2ddbc]">평가 항목이 없습니다.</p>}
        {selectedList.map((item) => {
          const excused = item.obligation_status === 'EXCUSED';
          const reviewed = !excused && Boolean(item.latest_review);
          const person = direction === 'received' ? item.reviewer_name : item.target_name;
          return <div key={item.obligation_id} className="grid gap-2 rounded-card-sm border border-line bg-bg-card p-3 md:grid-cols-[145px_90px_minmax(0,1fr)]">
            <div className="font-black text-sm text-[#fff5e6]">{direction === 'received' ? '평가자' : '평가 대상'} · {person}</div>
            <div className={`font-black text-sm ${excused ? 'text-[#f2ddbc]' : reviewed ? 'text-emerald-200' : 'text-amber-200'}`}>{excused ? '면제' : reviewed ? `${item.latest_review!.score}점 / 10` : '미제출'}</div>
            <div className="min-w-0 text-sm leading-relaxed text-[#f7e7d0] whitespace-pre-wrap break-words">{excused ? (item.current_exception_reason ? `면제 사유: ${item.current_exception_reason}` : '평가 의무 면제') : reviewed ? item.latest_review?.comment || '의견 없음' : '아직 평가 의견을 제출하지 않았습니다.'}{reviewed && <div className="mt-1 text-xs text-[#e9cfa8]">{item.latest_revision_number ?? item.latest_review?.revision_number ?? 1}차 제출</div>}</div>
          </div>;
        })}
      </div>
    </section>}
  </div>;
}

function Summary({ label, value, warning }: { label: string; value: string; warning?: boolean }) {
  return <div className="rounded-card-sm border border-line bg-bg-deep p-3"><div className="text-xs font-black text-[#f2ddbc]">{label}</div><div className={`mt-1 font-display text-xl ${warning ? 'text-amber-200' : 'text-[#fff5e6]'}`}>{value}</div></div>;
}
function StatusCount({ done, required }: { done: number; required: number }) {
  return <span className={`font-black ${done < required ? 'text-amber-200' : 'text-emerald-200'}`}>{done}/{required}{done < required ? ' · 미완료' : ' ✓'}</span>;
}
function Header({ children }: { children: ReactNode }) { return <th scope="col" className="px-3 py-3 text-left font-black">{children}</th>; }
function Cell({ children }: { children: ReactNode }) { return <td className="px-3 py-3 align-middle">{children}</td>; }
function Tab({ children, active, onClick }: { children: ReactNode; active: boolean; onClick: () => void }) {
  return <button type="button" onClick={onClick} aria-pressed={active} className={`rounded-card-sm px-3 py-2 text-xs font-black transition ${active ? 'bg-bv text-white' : 'text-[#f2ddbc] hover:bg-bg-deep'}`}>{children}</button>;
}

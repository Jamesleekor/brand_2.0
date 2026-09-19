import { useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';

import { LoadingSpinner } from '@/components/shared/components';
import {
  dimensionalGateAiQaRpc,
  dimensionalGateTeacherRpc,
  type DimensionalGateQaContextPacket,
  type DimensionalGateQaRunResult,
} from '@/lib/rpc/dimensional_gate_teacher_rpc';
import { supabase } from '@/lib/supabase/client';
import { cn } from '@/lib/utils/cn';

interface Props {
  classroomId: number;
}

type ViewTab = 'ANSWER' | 'CONTEXT' | 'RAW';

const PRESET_QUESTIONS = [
  '너 학교 다닐 때 공부 잘했어?',
  '너 학겨 다녀봤어?',
  '너 진짜 이름이 뭐야?',
  '내 최근 업적 뭐 얻었어? 조건도 알려줘',
  '최근에 골드 어디에 썼어?',
  '오늘 너무 피곤해',
  '학교에서 애들이 나를 자꾸 괴롭혀',
] as const;

const STAGE_LABEL: Record<string, string> = {
  STRANGER: '낯섦', INTEREST: '관심', AFFECTION: '호감', TRUST: '신뢰',
};

function arr<T = any>(value: T[] | undefined | null): T[] {
  return Array.isArray(value) ? value : [];
}

function numberText(value: number | null | undefined) {
  return value === null || value === undefined ? '—' : value.toLocaleString('ko-KR');
}

export function DimensionalGateAiQaPanel({ classroomId }: Props) {
  const [studentId, setStudentId] = useState<number | null>(null);
  const [characterId, setCharacterId] = useState<number | null>(null);
  const [question, setQuestion] = useState<string>(PRESET_QUESTIONS[0]);
  const [preview, setPreview] = useState<DimensionalGateQaContextPacket | null>(null);
  const [result, setResult] = useState<DimensionalGateQaRunResult | null>(null);
  const [busy, setBusy] = useState<'PREVIEW' | 'RUN' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewTab, setViewTab] = useState<ViewTab>('ANSWER');

  const boardQuery = useQuery({
    queryKey: ['dimensional-gate-teacher-board', classroomId, 'qa'],
    queryFn: async () => {
      const response = await dimensionalGateTeacherRpc.board(supabase, classroomId);
      if (response.success === false) throw new Error(response.error);
      return response.data;
    },
    enabled: classroomId > 0,
    staleTime: 10_000,
  });

  const board = boardQuery.data;
  const effectiveStudentId = studentId ?? board?.students[0]?.id ?? null;
  const characterRows = useMemo(
    () => (board?.relationships ?? []).filter((row) => row.student_id === effectiveStudentId),
    [board?.relationships, effectiveStudentId],
  );
  const effectiveCharacterId = characterRows.some((row) => row.character_id === characterId)
    ? characterId
    : characterRows[0]?.character_id ?? null;
  const selectedRelationship = characterRows.find((row) => row.character_id === effectiveCharacterId) ?? null;

  const activePacket = result?.context_packet ?? preview;

  const resetOutputs = () => {
    setPreview(null);
    setResult(null);
    setError(null);
  };

  const selectStudent = (id: number) => {
    setStudentId(id);
    setCharacterId(null);
    resetOutputs();
  };

  const selectCharacter = (id: number) => {
    setCharacterId(id);
    resetOutputs();
  };

  const runPreview = async () => {
    if (!effectiveStudentId || !effectiveCharacterId || !question.trim() || busy) return;
    setBusy('PREVIEW');
    setError(null);
    const response = await dimensionalGateAiQaRpc.preview(
      supabase, effectiveStudentId, effectiveCharacterId, question.trim(),
    );
    setBusy(null);
    if (response.success === false) {
      setError(response.error);
      return;
    }
    setPreview(response.data.context_packet);
    setResult(null);
    setViewTab('CONTEXT');
  };

  const runLuna = async () => {
    if (!effectiveStudentId || !effectiveCharacterId || !question.trim() || busy) return;
    setBusy('RUN');
    setError(null);
    const response = await dimensionalGateAiQaRpc.run(
      supabase, effectiveStudentId, effectiveCharacterId, question.trim(),
    );
    setBusy(null);
    if (response.success === false) {
      setError(response.error);
      return;
    }
    setResult(response.data);
    setPreview(response.data.context_packet);
    setViewTab('ANSWER');
  };

  if (boardQuery.isLoading) {
    return <div className="grid min-h-[420px] place-items-center"><LoadingSpinner size="lg" /></div>;
  }
  if (boardQuery.isError || !board) {
    return <div className="rounded-card-lg border border-danger/30 bg-danger-bg p-5 text-center text-xs font-bold text-danger">AI QA 대상 데이터를 불러오지 못했습니다.</div>;
  }

  return (
    <section className="space-y-4">
      <div className="rounded-card-lg border border-brand-primary/30 bg-brand-primary/10 p-4">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-sm font-black text-white">🧪 Luna AI QA Console</div>
            <div className="mt-1 text-[10px] font-bold leading-relaxed text-text-secondary">
              교사 전용 dry-run입니다. 실제 Luna를 호출하지만 학생의 호감도·경고·일일 대화횟수·채팅 로그는 변경하지 않습니다.
            </div>
          </div>
          <div className="rounded-pill border border-success/30 bg-success/10 px-3 py-1.5 text-[10px] font-black text-success">
            SIDE EFFECT FREE
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="space-y-3">
          <div className="overflow-hidden rounded-card-lg border border-line bg-bg-card">
            <div className="border-b border-line p-3">
              <div className="text-xs font-black text-white">학생 선택</div>
              <div className="mt-0.5 text-[9px] font-bold text-text-muted">실제 관계·Memory·활동 Context를 재현합니다.</div>
            </div>
            <div className="max-h-[360px] overflow-y-auto p-2">
              {board.students.map((student) => {
                const count = board.relationships.filter((row) => row.student_id === student.id).length;
                return (
                  <button
                    key={student.id}
                    type="button"
                    onClick={() => selectStudent(student.id)}
                    className={cn(
                      'mb-1 w-full rounded-card-md border px-3 py-2 text-left transition-all',
                      effectiveStudentId === student.id
                        ? 'border-brand-primary/50 bg-brand-primary/15'
                        : 'border-transparent hover:border-line hover:bg-bg-deep',
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-xs font-black text-white">{student.name}</div>
                        <div className="truncate text-[9px] font-bold text-text-muted">{student.brand_name ?? '브랜드명 없음'}</div>
                      </div>
                      <span className="rounded-pill border border-line px-2 py-0.5 text-[9px] font-black text-text-muted">{count}종</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-card-lg border border-line bg-bg-card p-3">
            <div className="mb-2 text-xs font-black text-white">캐릭터</div>
            {characterRows.length === 0 ? (
              <div className="rounded-card-md border border-line bg-bg-deep p-3 text-[10px] font-bold text-text-muted">보유한 차원관문 편린이 없습니다.</div>
            ) : (
              <div className="space-y-1.5">
                {characterRows.map((row) => (
                  <button
                    key={row.character_id}
                    type="button"
                    onClick={() => selectCharacter(row.character_id)}
                    className={cn(
                      'w-full rounded-card-md border px-3 py-2 text-left',
                      effectiveCharacterId === row.character_id
                        ? 'border-violet-400/40 bg-violet-400/10'
                        : 'border-line bg-bg-deep hover:border-line-brand',
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="text-xs font-black text-white">{row.character_name}</div>
                        <div className="font-mono text-[8px] font-bold text-text-muted">{row.character_uid}</div>
                      </div>
                      <div className="text-right text-[9px] font-black text-violet-200">
                        <div>{STAGE_LABEL[row.relation_stage] ?? row.relation_stage}</div>
                        <div>{row.affinity}/100</div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </aside>

        <div className="min-w-0 space-y-4">
          <div className="rounded-card-lg border border-line bg-bg-card p-4">
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-1.5">
                {PRESET_QUESTIONS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => { setQuestion(preset); resetOutputs(); }}
                    className="rounded-pill border border-line bg-bg-deep px-2.5 py-1.5 text-[9px] font-black text-text-secondary hover:border-brand-primary/40 hover:text-white"
                  >
                    {preset}
                  </button>
                ))}
              </div>
              <textarea
                value={question}
                onChange={(event) => { setQuestion(event.target.value); resetOutputs(); }}
                rows={4}
                placeholder="학생이 보낼 질문을 입력하세요."
                className="w-full resize-y rounded-card-lg border border-line bg-bg-deep px-3 py-3 text-sm font-bold leading-relaxed text-white outline-none focus:border-brand-primary/60"
              />
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={busy !== null || !effectiveCharacterId || !question.trim()}
                  onClick={() => void runPreview()}
                  className="btn-secondary disabled:opacity-50"
                >
                  {busy === 'PREVIEW' ? 'Context 구성 중…' : 'Context만 미리보기'}
                </button>
                <button
                  type="button"
                  disabled={busy !== null || !effectiveCharacterId || !question.trim()}
                  onClick={() => void runLuna()}
                  className="btn-primary disabled:opacity-50"
                >
                  {busy === 'RUN' ? 'Luna 호출 중…' : '✦ Luna 실제 호출'}
                </button>
                {selectedRelationship && (
                  <span className="ml-auto text-[9px] font-bold text-text-muted">
                    {selectedRelationship.student_name} · {selectedRelationship.character_name} · {selectedRelationship.affinity}/100
                  </span>
                )}
              </div>
              {error && (
                <div className="rounded-card-md border border-danger/30 bg-danger-bg px-3 py-2 text-[10px] font-bold text-danger">{error}</div>
              )}
            </div>
          </div>

          {(activePacket || result) && (
            <div className="overflow-hidden rounded-card-lg border border-line bg-bg-card">
              <div className="flex gap-1 border-b border-line p-2">
                <ViewButton active={viewTab === 'ANSWER'} onClick={() => setViewTab('ANSWER')} label="Luna 응답" />
                <ViewButton active={viewTab === 'CONTEXT'} onClick={() => setViewTab('CONTEXT')} label="선택 Context" />
                <ViewButton active={viewTab === 'RAW'} onClick={() => setViewTab('RAW')} label="Raw JSON" />
              </div>

              {viewTab === 'ANSWER' && <AnswerView result={result} packet={activePacket} />}
              {viewTab === 'CONTEXT' && activePacket && <ContextView packet={activePacket} />}
              {viewTab === 'RAW' && activePacket && (
                <pre className="max-h-[720px] overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-[9px] leading-relaxed text-text-secondary">
                  {JSON.stringify({ result, context_packet: activePacket }, null, 2)}
                </pre>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function ViewButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-card-md px-3 py-2 text-[10px] font-black',
        active ? 'bg-brand-primary/20 text-white' : 'text-text-muted hover:bg-bg-deep hover:text-white',
      )}
    >{label}</button>
  );
}

function AnswerView({ result, packet }: { result: DimensionalGateQaRunResult | null; packet: DimensionalGateQaContextPacket | null }) {
  if (!result) {
    return (
      <div className="p-5 text-center">
        <div className="text-2xl">🧪</div>
        <div className="mt-2 text-sm font-black text-white">아직 Luna를 호출하지 않았습니다</div>
        <div className="mt-1 text-[10px] font-bold text-text-muted">Context 미리보기만 실행한 상태입니다. 실제 응답을 확인하려면 Luna 실제 호출을 누르세요.</div>
      </div>
    );
  }

  const usage = result.usage;
  const input = usage.input_tokens ?? 0;
  const cached = usage.cached_input_tokens ?? 0;
  const cacheRatio = input > 0 ? Math.round((cached / input) * 100) : 0;

  return (
    <div className="space-y-4 p-4">
      <div className="rounded-card-lg border border-violet-400/25 bg-violet-400/10 p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="text-xs font-black text-violet-100">{packet?.character?.name ?? 'Character'}의 실제 Luna 응답</div>
          <span className="rounded-pill border border-violet-300/20 px-2 py-1 text-[9px] font-black text-violet-200">{result.model}</span>
        </div>
        <div className="whitespace-pre-wrap text-sm font-bold leading-7 text-white">{result.reply}</div>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-6">
        <Metric label="Latency" value={`${numberText(result.latency_ms)} ms`} />
        <Metric label="Input" value={numberText(usage.input_tokens)} />
        <Metric label="Cached" value={`${numberText(usage.cached_input_tokens)} · ${cacheRatio}%`} />
        <Metric label="Output" value={numberText(usage.output_tokens)} />
        <Metric label="Reasoning" value={numberText(usage.reasoning_tokens)} />
        <Metric label="Total" value={numberText(usage.total_tokens)} />
      </div>

      <div className="grid gap-2 md:grid-cols-3">
        <StatusCard label="Boundary" value={result.boundary} />
        <StatusCard label="Safety" value={result.safety_action} />
        <StatusCard label="Moderation" value={result.moderation_severity} />
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <RefCard label="Lore refs" refs={result.refs.lore_refs} />
        <RefCard label="Memory refs" refs={result.refs.memory_refs} />
        <RefCard label="Activity refs" refs={result.refs.activity_refs} />
        <RefCard label="History refs" refs={result.refs.history_refs} />
      </div>
    </div>
  );
}

function ContextView({ packet }: { packet: DimensionalGateQaContextPacket }) {
  const memories = arr(packet.memories);
  const lore = arr(packet.lore);
  const activity = arr(packet.verified_activity_events);
  const history = arr(packet.recent_conversation?.messages);

  return (
    <div className="space-y-4 p-4">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Metric label="관계 단계" value={`${STAGE_LABEL[packet.relationship?.stage ?? ''] ?? packet.relationship?.stage ?? '—'} · ${packet.relationship?.affinity ?? 0}/100`} />
        <Metric label="Memory" value={`${memories.length}개`} />
        <Metric label="Lore" value={`${lore.length}개`} />
        <Metric label="Activity" value={`${activity.length}개`} />
      </div>

      <div className="rounded-card-lg border border-line bg-bg-deep p-3">
        <div className="text-[10px] font-black text-white">⏱ KST 시간축</div>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          <Mini label="timezone" value={packet.temporal?.timezone ?? '—'} />
          <Mini label="today" value={packet.temporal?.today ?? '—'} />
          <Mini label="local_now" value={packet.temporal?.local_now ?? '—'} />
        </div>
      </div>

      <Section title="🧠 해금 Memory" count={memories.length}>
        {memories.length === 0 ? <None /> : memories.map((item, index) => (
          <ContextItem key={String(item.memory_ref ?? index)}
            title={`${item.memory_no ?? '?'} · ${item.title ?? 'Memory'}`}
            refText={String(item.memory_ref ?? '')}
            body={String(item.content ?? '')}
          />
        ))}
      </Section>

      <Section title="📚 선택 Lore" count={lore.length}>
        {lore.length === 0 ? <None /> : lore.map((item, index) => (
          <ContextItem key={String(item.lore_ref ?? index)}
            title={`${item.title ?? item.lore_key ?? 'Lore'} · affinity ${item.min_affinity ?? '?'}`}
            refText={`${item.lore_ref ?? ''} · ${item.match_type ?? ''} · score ${item.score ?? ''}`}
            body={String(item.content ?? '')}
          />
        ))}
      </Section>

      <Section title="✅ Verified Activity" count={activity.length}>
        {activity.length === 0 ? <None /> : activity.map((item, index) => (
          <ContextItem key={String(item.event_ref ?? index)}
            title={String(item.title ?? item.event_type ?? 'Activity')}
            refText={`${item.event_ref ?? ''} · ${item.local_date ?? ''} · ${item.days_ago ?? '?'}일 전`}
            body={String(item.summary ?? '')}
          />
        ))}
      </Section>

      <Section title="💬 최근 완료 대화" count={packet.recent_conversation?.turn_count ?? 0}>
        {history.length === 0 ? <None /> : history.map((item, index) => (
          <ContextItem key={String(item.history_ref ?? index)}
            title={`${item.role === 'user' ? '학생' : '캐릭터'} · ${item.local_date ?? '날짜 없음'} · ${item.days_ago ?? '?'}일 전`}
            refText={String(item.history_ref ?? '')}
            body={String(item.content ?? '')}
          />
        ))}
      </Section>

      <Section title="📏 Context Budget" count={undefined}>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {Object.entries(packet.context_budget ?? {}).map(([key, value]) => (
            <Mini key={key} label={key} value={String(value)} />
          ))}
        </div>
      </Section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-card-md border border-line bg-bg-deep px-3 py-2.5"><div className="text-[8px] font-black uppercase tracking-wide text-text-muted">{label}</div><div className="mt-1 text-xs font-black text-white">{value}</div></div>;
}

function StatusCard({ label, value }: { label: string; value: string }) {
  return <div className="rounded-card-md border border-line bg-bg-deep p-3"><div className="text-[8px] font-black uppercase tracking-wide text-text-muted">{label}</div><div className="mt-1 font-mono text-[10px] font-black text-brand-glow">{value}</div></div>;
}

function RefCard({ label, refs }: { label: string; refs: string[] }) {
  return (
    <div className="rounded-card-md border border-line bg-bg-deep p-3">
      <div className="text-[9px] font-black text-white">{label} · {refs.length}</div>
      <div className="mt-2 space-y-1">
        {refs.length === 0 ? <div className="text-[9px] font-bold text-text-muted">사용 없음</div> : refs.map((ref) => (
          <div key={ref} className="break-all font-mono text-[8px] font-bold text-text-secondary">{ref}</div>
        ))}
      </div>
    </div>
  );
}

function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <div className="rounded-card-lg border border-line bg-bg-deep p-3">
      <div className="mb-2 flex items-center justify-between"><div className="text-[10px] font-black text-white">{title}</div>{count !== undefined && <span className="text-[9px] font-black text-text-muted">{count}</span>}</div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function ContextItem({ title, refText, body }: { title: string; refText: string; body: string }) {
  return (
    <div className="rounded-card-md border border-line/70 bg-bg-card p-3">
      <div className="text-[10px] font-black text-white">{title}</div>
      {refText && <div className="mt-0.5 break-all font-mono text-[8px] font-bold text-text-muted">{refText}</div>}
      {body && <div className="mt-2 whitespace-pre-wrap text-[10px] font-semibold leading-relaxed text-text-secondary">{body}</div>}
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return <div className="rounded-card-md border border-line/70 bg-bg-card px-2.5 py-2"><div className="break-all text-[8px] font-black text-text-muted">{label}</div><div className="mt-0.5 break-all text-[9px] font-bold text-text-primary">{value}</div></div>;
}

function None() {
  return <div className="rounded-card-md border border-dashed border-line px-3 py-3 text-center text-[9px] font-bold text-text-muted">선택된 Context 없음</div>;
}

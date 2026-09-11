import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Check, ChevronRight, LockKeyhole, ScrollText, X } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { useStudentId } from '@/stores/auth_store';
import {
  RECORDS_LEGACY_PATHS,
  getRecordsLegacyPath,
  type RecordsLegacyPathCode,
} from '@/lib/records_legacy_paths';
import {
  recordsLegacyStudentQueryKey,
  recordsLegacySuccessorRpc,
  type RecordsLegacyStudentState,
} from '@/lib/rpc/records_legacy_successor_rpc';

type SealView = 'FOUND' | 'QUEST' | 'REGISTERED' | 'CLOSED' | 'UNSEALED';

const MAX_STATEMENT_LENGTH = 120;

export function RecordsLegacySeal() {
  const studentId = useStudentId();
  const queryClient = useQueryClient();
  const [view, setView] = useState<SealView | null>(null);
  const [selectedPath, setSelectedPath] = useState<RecordsLegacyPathCode | null>(null);
  const [statement, setStatement] = useState('');

  const stateQ = useQuery({
    queryKey: recordsLegacyStudentQueryKey(studentId),
    enabled: studentId !== null,
    queryFn: () => recordsLegacySuccessorRpc.studentState(supabase),
    staleTime: 10_000,
    refetchOnWindowFocus: true,
  });

  const syncState = (next: RecordsLegacyStudentState) => {
    queryClient.setQueryData(recordsLegacyStudentQueryKey(studentId), next);
  };

  const discoverM = useMutation({
    mutationFn: () => recordsLegacySuccessorRpc.discoverSeal(supabase),
    onSuccess: (next) => {
      syncState(next);
      setView(next.registered_at ? 'REGISTERED' : 'FOUND');
    },
  });

  const confirmM = useMutation({
    mutationFn: () => recordsLegacySuccessorRpc.confirmSeal(supabase),
    onSuccess: (next) => {
      syncState(next);
      setView(next.event_status === 'LOCKED' || next.event_status === 'INHERITED' ? 'CLOSED' : 'QUEST');
    },
  });

  const registerM = useMutation({
    mutationFn: ({ path, message }: { path: RecordsLegacyPathCode; message: string }) =>
      recordsLegacySuccessorRpc.register(supabase, path, message),
    onSuccess: async (next) => {
      const { just_unsealed: justUnsealed, ...studentState } = next;
      syncState(studentState);
      await queryClient.invalidateQueries({ queryKey: ['records', 'legacy-successor'] });
      setView(justUnsealed ? 'UNSEALED' : 'REGISTERED');
    },
  });

  const state = stateQ.data;
  const normalizedStatement = statement.replace(/\s+/g, ' ').trim();
  const canRegister =
    selectedPath !== null &&
    normalizedStatement.length > 0 &&
    normalizedStatement.length <= MAX_STATEMENT_LENGTH &&
    !registerM.isPending;

  useEffect(() => {
    if (view !== 'UNSEALED') return undefined;
    const timer = window.setTimeout(() => setView('REGISTERED'), 4600);
    return () => window.clearTimeout(timer);
  }, [view]);

  useEffect(() => {
    if (!state?.registered_at) return;
    setSelectedPath(state.legacy_path_code);
    setStatement(state.legacy_statement ?? '');
  }, [state?.registered_at, state?.legacy_path_code, state?.legacy_statement]);

  const openSeal = () => {
    if (!state || discoverM.isPending) return;
    if (state.registered_at) {
      setView('REGISTERED');
      return;
    }
    if (!state.seal_discovered_at) {
      discoverM.mutate();
      return;
    }
    if (!state.seal_confirmed_at) {
      setView('FOUND');
      return;
    }
    if (state.event_status === 'LOCKED' || state.event_status === 'INHERITED') {
      setView('CLOSED');
      return;
    }
    setView('QUEST');
  };

  if (!studentId || stateQ.isLoading || stateQ.isError || !state?.can_participate) return null;

  return (
    <>
      <section aria-label="숨겨진 기록" className="relative flex min-h-[76px] items-center justify-center py-1">
        <style>{`
          @keyframes legacy-seal-whisper {
            0%, 76%, 100% { filter: drop-shadow(0 0 0 rgba(226,190,104,0)); }
            82% { filter: drop-shadow(0 0 4px rgba(226,190,104,.18)); }
            88% { filter: drop-shadow(0 0 11px rgba(226,190,104,.34)); }
            94% { filter: drop-shadow(0 0 3px rgba(226,190,104,.12)); }
          }
          @keyframes legacy-seal-line {
            0%, 78%, 100% { opacity: .08; transform: translateX(-125%) rotate(18deg); }
            86% { opacity: .58; }
            94% { opacity: .05; transform: translateX(170%) rotate(18deg); }
          }
        `}</style>
        <button
          type="button"
          onClick={openSeal}
          disabled={discoverM.isPending}
          aria-label="낡은 밀랍 인장"
          className="legacy-hidden-seal group relative h-[54px] w-[54px] cursor-pointer transition-transform duration-300 hover:-translate-y-[3px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#cfad63]/55 disabled:cursor-wait"
          style={{ animation: 'legacy-seal-whisper 7.4s ease-in-out infinite' }}
        >
          <span
            aria-hidden="true"
            className="absolute inset-[5px] rotate-[-5deg] overflow-hidden border border-[#6e311f] bg-[radial-gradient(circle_at_40%_32%,#8a4230_0%,#66291f_43%,#481b17_74%,#321214_100%)] shadow-[inset_0_1px_4px_rgba(255,210,160,0.12),0_5px_13px_rgba(0,0,0,0.38)] transition duration-300 group-hover:border-[#b88e4f]/65 group-hover:shadow-[inset_0_1px_4px_rgba(255,222,172,0.16),0_0_16px_rgba(205,162,80,0.16),0_7px_16px_rgba(0,0,0,0.42)]"
            style={{ borderRadius: '49% 43% 52% 46% / 45% 52% 44% 53%' }}
          >
            <span className="absolute inset-[7px] rounded-full border border-[#b27855]/35" />
            <span className="absolute left-1/2 top-1/2 h-[22px] w-[22px] -translate-x-1/2 -translate-y-1/2 rotate-45 border border-[#c09a69]/38">
              <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 -rotate-45 font-display text-[10px] font-black text-[#d0aa76]/52">B</span>
            </span>
            <span
              className="absolute -inset-y-2 left-[-30%] w-[9px] bg-gradient-to-r from-transparent via-[#f0d18a]/50 to-transparent blur-[1px]"
              style={{ animation: 'legacy-seal-line 7.4s ease-in-out infinite' }}
            />
          </span>
          <span aria-hidden="true" className="absolute bottom-[3px] left-[9px] h-[10px] w-[11px] rounded-full bg-[#451a16] opacity-85" />
          <span aria-hidden="true" className="absolute right-[6px] top-[11px] h-[8px] w-[10px] rounded-full bg-[#522019] opacity-80" />
        </button>
      </section>

      {view && typeof document !== 'undefined'
        ? createPortal(
            <LegacySealModal
              view={view}
              state={state}
              selectedPath={selectedPath}
              statement={statement}
              onSelectedPath={setSelectedPath}
              onStatement={setStatement}
              onClose={() => {
                if (view !== 'UNSEALED') setView(null);
              }}
              onConfirm={() => confirmM.mutate()}
              onRegister={() => {
                if (!selectedPath || !canRegister) return;
                registerM.mutate({ path: selectedPath, message: normalizedStatement });
              }}
              confirming={confirmM.isPending}
              registering={registerM.isPending}
              error={discoverM.error ?? confirmM.error ?? registerM.error}
            />,
            document.body,
          )
        : null}
    </>
  );
}

function LegacySealModal({
  view,
  state,
  selectedPath,
  statement,
  onSelectedPath,
  onStatement,
  onClose,
  onConfirm,
  onRegister,
  confirming,
  registering,
  error,
}: {
  view: SealView;
  state: RecordsLegacyStudentState;
  selectedPath: RecordsLegacyPathCode | null;
  statement: string;
  onSelectedPath: (path: RecordsLegacyPathCode) => void;
  onStatement: (value: string) => void;
  onClose: () => void;
  onConfirm: () => void;
  onRegister: () => void;
  confirming: boolean;
  registering: boolean;
  error: Error | null;
}) {
  if (view === 'UNSEALED') return <UnsealedCinematic />;

  const registeredPath = getRecordsLegacyPath(state.legacy_path_code);
  const selected = getRecordsLegacyPath(selectedPath);

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center overflow-y-auto bg-[#050407]/88 px-3 py-5 backdrop-blur-[3px] sm:px-5"
      role="dialog"
      aria-modal="true"
      aria-label="숨겨진 봉인"
    >
      <style>{`
        @keyframes legacy-modal-enter { from { opacity: 0; transform: translateY(12px) scale(.982); } to { opacity: 1; transform: none; } }
        @keyframes legacy-ember { 0%,100% { opacity:.15; transform:translateY(0) scale(.8); } 50% { opacity:.65; transform:translateY(-11px) scale(1.1); } }
      `}</style>
      <div className="fixed inset-0" onClick={onClose} aria-hidden="true" />
      <div
        className="relative my-auto w-full max-w-4xl overflow-hidden border border-[#8d713d]/50 bg-[radial-gradient(circle_at_50%_-8%,rgba(197,151,66,0.12),transparent_28%),linear-gradient(155deg,#1a1516_0%,#0e0b0f_55%,#171111_100%)] shadow-[0_35px_100px_rgba(0,0,0,0.72),inset_0_0_0_1px_rgba(238,211,148,0.035)]"
        style={{ borderRadius: '7px 20px 8px 22px', animation: 'legacy-modal-enter .38s cubic-bezier(.2,.8,.2,1)' }}
      >
        <div aria-hidden="true" className="pointer-events-none absolute inset-[7px] border border-[#c4a461]/10" />
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-[12%] top-0 h-px bg-gradient-to-r from-transparent via-[#e6c276]/70 to-transparent" />
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 z-20 flex h-9 w-9 items-center justify-center rounded-full border border-[#8f7448]/30 bg-black/25 text-[#b9a98e] transition hover:border-[#c6a35f]/55 hover:text-[#ead7ad]"
          aria-label="닫기"
        >
          <X className="h-4 w-4" />
        </button>

        {view === 'FOUND' ? (
          <div className="px-5 py-9 text-center sm:px-10 sm:py-12">
            <WaxMedallion />
            <div className="mt-6 text-[10px] font-black tracking-[0.30em] text-[#ae8c50]">A SEAL BENEATH THE ARCHIVE</div>
            <h2 className="mt-2 font-display text-3xl text-[#f0dfba] sm:text-4xl">숨겨진 봉인</h2>
            <div className="mx-auto mt-6 max-w-2xl border-y border-[#9b7b45]/22 py-5 text-sm font-bold leading-7 text-[#d9d0c0] sm:text-base sm:leading-8 [word-break:keep-all]">
              <p>당신은 영광의 전당 아래 숨겨진 마지막 <strong className="text-[#f0d59b]">봉인을 발견했습니다.</strong></p>
              <p className="mt-3">최초의 개척자들은 자신들의 기록과 함께 마지막 유산을 남겼습니다.</p>
              <p>그러나 이 유산은 <strong className="text-[#f0d59b]">기록을 이어갈 사람에게만</strong> 전달됩니다.</p>
            </div>
            {error ? <MutationError error={error} /> : null}
            <button
              type="button"
              disabled={confirming}
              onClick={onConfirm}
              className="group mx-auto mt-7 inline-flex items-center gap-3 border-y border-[#b18c47]/55 bg-[#8a6328]/10 px-7 py-3 font-display text-base text-[#ecd5a5] transition hover:border-[#e2bd70]/75 hover:bg-[#a27632]/15 disabled:opacity-45"
            >
              <span>{confirming ? '봉인을 확인하는 중…' : '「봉인을 확인한다」'}</span>
              <ChevronRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
            </button>
          </div>
        ) : null}

        {view === 'QUEST' ? (
          <div className="max-h-[92vh] overflow-y-auto px-4 py-7 sm:px-7 sm:py-9">
            <header className="mx-auto max-w-3xl text-center">
              <div className="text-[10px] font-black tracking-[0.30em] text-[#a8864c]">숨겨진 퀘스트</div>
              <h2 className="mt-2 font-display text-3xl text-[#f1dfb6] sm:text-4xl">「후계자 등록」</h2>
              <div className="mx-auto mt-5 max-w-2xl text-xs font-bold leading-6 text-[#cfc5b4] sm:text-sm sm:leading-7 [word-break:keep-all]">
                <p>최초의 계승 조건은 충족되지 않았습니다. 따라서 <strong className="text-[#edcf91]">전체를 대상으로 한 계승은 더 이상 일어나지 않습니다.</strong></p>
                <p className="mt-2">하지만 기록을 찾아온 후배들을 위해 개척자들은 마지막 절차를 남겨두었습니다.</p>
                <p className="mt-2">아직 선배들이 보유하고 있는 기록 가운데 가장 인상 깊은 하나를 고르십시오. 이것은 단순히 멋져 보이는 기록을 고르는 일이 아니라, <strong className="text-[#edcf91]">내가 앞으로 이어가고 싶은 기록의 길</strong>을 선택하는 일입니다.</p>
                <p className="mt-2">최소 <strong className="text-[#f0d49a]">{state.minimum_successors}명의 후계자</strong>가 등록되면 봉인이 해제됩니다.</p>
                <p>유산은 오로지 <strong className="text-[#f0d49a]">등록을 완료한 후계자에게만</strong> 전달됩니다.</p>
              </div>
            </header>

            <div className="mx-auto mt-7 grid max-w-3xl gap-3 md:grid-cols-2">
              {RECORDS_LEGACY_PATHS.map((path) => {
                const active = selectedPath === path.code;
                return (
                  <button
                    key={path.code}
                    type="button"
                    onClick={() => onSelectedPath(path.code)}
                    className={`group relative min-h-[180px] overflow-hidden border p-4 text-left transition duration-300 ${active ? 'border-[#dfbe78]/72 bg-[radial-gradient(circle_at_85%_0%,rgba(226,190,120,0.13),transparent_36%),rgba(129,92,35,0.12)] shadow-[0_0_26px_rgba(194,149,67,0.10),inset_0_0_0_1px_rgba(231,205,147,0.06)]' : 'border-[#77623e]/38 bg-black/20 hover:-translate-y-0.5 hover:border-[#b79355]/56 hover:bg-[#8b6930]/[0.06]'}`}
                    style={{ borderRadius: '5px 15px 6px 14px' }}
                  >
                    <span aria-hidden="true" className="absolute right-3 top-1 font-display text-5xl text-[#ddc38d]/[0.045]">{path.numeral}</span>
                    <div className="flex items-start justify-between gap-3">
                      <span className={`font-display text-lg ${active ? 'text-[#f2dbac]' : 'text-[#ded0b5]'}`}>{path.numeral}. {path.title}</span>
                      {active ? <Check className="h-4 w-4 shrink-0 text-[#e3bd70]" /> : null}
                    </div>
                    <div className="mt-2 text-xs font-black leading-5 text-[#c2a15f] [word-break:keep-all]">{path.officialRecord}</div>
                    <p className="mt-3 text-[11px] font-bold leading-5 text-[#9f978a] [word-break:keep-all]">{path.meaning}</p>
                  </button>
                );
              })}
            </div>

            <div className={`mx-auto mt-6 max-w-3xl overflow-hidden border transition-all duration-300 ${selected ? 'border-[#a8854a]/42 bg-black/22' : 'border-[#65583e]/24 bg-black/10 opacity-55'}`} style={{ borderRadius: '6px 17px 7px 16px' }}>
              <div className="border-b border-[#8e7446]/22 px-4 py-3 sm:px-5">
                <div className="text-[10px] font-black tracking-[0.16em] text-[#9e8350]">당신이 선택한 길</div>
                <div className="mt-1 font-display text-lg text-[#ead7b1]">{selected ? `「${selected.title}」` : '먼저 이어갈 기록을 선택하십시오.'}</div>
                {selected ? <div className="mt-1 text-xs font-bold text-[#a99c87]">{selected.officialRecord}</div> : null}
              </div>
              <div className="p-4 sm:p-5">
                <label htmlFor="legacy-successor-statement" className="text-sm font-black text-[#e7d4ae]">나는 이 기록을 어떻게 이어가고 싶습니까?</label>
                <p className="mt-1 text-[11px] font-bold text-[#8f887c]">이 기록이 상징하는 방향을 내가 어떻게 이어가고 싶은지 한 문장으로 적어 주세요.</p>
                <textarea
                  id="legacy-successor-statement"
                  value={statement}
                  maxLength={MAX_STATEMENT_LENGTH}
                  disabled={!selected || registering}
                  onChange={(event) => onStatement(event.target.value)}
                  placeholder="한 문장으로 기록합니다."
                  className="mt-3 min-h-[88px] w-full resize-none border border-[#7c6743]/38 bg-[#08070a]/62 px-3 py-2.5 text-sm font-bold leading-relaxed text-[#eee7db] outline-none placeholder:text-[#625e58] focus:border-[#c5a25d]/58 disabled:opacity-45"
                  style={{ borderRadius: '4px 12px 5px 11px' }}
                />
                <div className="mt-1 text-right text-[10px] font-bold text-[#7f796f]">{statement.length} / {MAX_STATEMENT_LENGTH}</div>
              </div>
            </div>

            {error ? <MutationError error={error} /> : null}
            <div className="mx-auto mt-5 flex max-w-3xl justify-end">
              <button
                type="button"
                disabled={!selected || statement.replace(/\s+/g, ' ').trim().length === 0 || registering}
                onClick={onRegister}
                className="group inline-flex min-h-12 items-center gap-2 border border-[#c29b50]/58 bg-[linear-gradient(180deg,rgba(165,121,48,0.22),rgba(92,64,27,0.18))] px-5 py-2.5 font-display text-sm text-[#f0d49c] shadow-[0_8px_28px_rgba(0,0,0,0.25)] transition hover:border-[#e4be70]/75 hover:bg-[#a87a32]/20 disabled:cursor-not-allowed disabled:opacity-35 sm:text-base"
                style={{ borderRadius: '4px 13px 5px 12px' }}
              >
                <ScrollText className="h-4 w-4" />
                <span>{registering ? '후계자 명부에 새기는 중…' : '「이 기록의 계승자의 길을 선택합니다」'}</span>
              </button>
            </div>
          </div>
        ) : null}

        {view === 'REGISTERED' ? (
          <div className="px-5 py-9 text-center sm:px-9 sm:py-11">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-[#c4a461]/52 bg-[#a87932]/10 shadow-[0_0_30px_rgba(192,149,65,0.12)]">
              <BookOpen className="h-7 w-7 text-[#dfbf78]" strokeWidth={1.4} />
            </div>
            <div className="mt-5 text-[10px] font-black tracking-[0.24em] text-[#9e8351]">SUCCESSOR REGISTER</div>
            <h2 className="mt-2 font-display text-2xl text-[#f0ddb5] sm:text-3xl">계승의 길이 기록되었습니다.</h2>
            <p className="mt-2 text-sm font-bold text-[#bdb3a3]">당신의 이름이 후계자 명부에 등록되었습니다.</p>
            {registeredPath ? (
              <div className="mx-auto mt-6 max-w-2xl border-y border-[#967746]/25 py-5">
                <div className="font-display text-xl text-[#e9cd91]">「{registeredPath.title}」</div>
                <div className="mt-1 text-xs font-black text-[#b6985d]">{registeredPath.officialRecord}</div>
                {state.legacy_statement ? <p className="mx-auto mt-4 max-w-xl text-sm font-bold leading-7 text-[#d4ccbf]">“{state.legacy_statement}”</p> : null}
              </div>
            ) : null}
            <button type="button" onClick={onClose} className="mt-7 border-y border-[#8e7448]/42 px-6 py-2.5 text-sm font-black text-[#cdb98f] transition hover:border-[#c6a45f]/60 hover:text-[#f0d9aa]">기록실로 돌아가기</button>
          </div>
        ) : null}

        {view === 'CLOSED' ? (
          <div className="px-5 py-10 text-center sm:px-9 sm:py-12">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-[#846d47]/38 bg-black/20">
              <LockKeyhole className="h-7 w-7 text-[#aa946b]" strokeWidth={1.4} />
            </div>
            <h2 className="mt-5 font-display text-2xl text-[#e4d4b7]">후계자 명부가 닫혔습니다.</h2>
            <p className="mx-auto mt-3 max-w-xl text-sm font-bold leading-7 text-[#a9a093] [word-break:keep-all]">개척자들의 유산 계승을 위한 최종 명부가 확정되어 더 이상 새로운 이름을 등록할 수 없습니다.</p>
            <button type="button" onClick={onClose} className="mt-7 border-y border-[#846f4a]/40 px-6 py-2.5 text-sm font-black text-[#bbaa89]">기록실로 돌아가기</button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function WaxMedallion() {
  return (
    <div className="mx-auto grid h-20 w-20 rotate-[-4deg] place-items-center rounded-[47%_52%_44%_55%/52%_45%_55%_46%] border border-[#8f4a32] bg-[radial-gradient(circle_at_38%_30%,#9c5137,#6d2d22_48%,#431916_78%,#2b1011)] shadow-[0_12px_28px_rgba(0,0,0,0.38),inset_0_1px_6px_rgba(255,210,170,0.10)]">
      <div className="grid h-11 w-11 rotate-45 place-items-center border border-[#d2ad77]/42"><span className="-rotate-45 font-display text-lg text-[#d5b07a]/70">B</span></div>
    </div>
  );
}

function MutationError({ error }: { error: Error }) {
  return <p className="mx-auto mt-4 max-w-2xl text-center text-xs font-bold text-[#dc8f82]">{error.message || '봉인의 기록을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.'}</p>;
}

function UnsealedCinematic() {
  const embers = useMemo(() => Array.from({ length: 28 }, (_, index) => ({
    id: index,
    left: `${6 + ((index * 37) % 88)}%`,
    top: `${12 + ((index * 53) % 76)}%`,
    delay: `${(index % 9) * 0.17}s`,
  })), []);

  return (
    <div className="fixed inset-0 z-[150] overflow-hidden bg-[#030205]">
      <style>{`
        @keyframes legacy-unseal-flash { 0%{opacity:0} 12%{opacity:.75} 24%{opacity:.08} 100%{opacity:0} }
        @keyframes legacy-unseal-crack { 0%{height:0;opacity:0} 18%{height:20vh;opacity:1} 52%{height:68vh;opacity:1} 100%{height:88vh;opacity:.12} }
        @keyframes legacy-unseal-copy { 0%{opacity:0;transform:translateY(16px);filter:blur(5px)} 22%{opacity:0} 46%{opacity:1;transform:none;filter:none} 86%{opacity:1} 100%{opacity:.88} }
        @keyframes legacy-unseal-ring { from{opacity:.7;transform:translate(-50%,-50%) scale(.18)} to{opacity:0;transform:translate(-50%,-50%) scale(4.6)} }
        @keyframes legacy-unseal-ember { 0%{opacity:0;transform:translateY(10px) scale(.4)} 35%{opacity:.8} 100%{opacity:0;transform:translateY(-55px) scale(1.15)} }
      `}</style>
      <div aria-hidden="true" className="absolute inset-0 bg-[radial-gradient(circle_at_50%_48%,rgba(195,145,55,0.16),transparent_30%),radial-gradient(circle_at_50%_50%,#130e0a_0%,#030205_63%)]" />
      <div aria-hidden="true" className="absolute inset-0 bg-[#fff2c9]" style={{ animation: 'legacy-unseal-flash 1.15s ease-out forwards' }} />
      <div aria-hidden="true" className="absolute left-1/2 top-1/2 w-[3px] -translate-x-1/2 -translate-y-1/2 rotate-[9deg] bg-gradient-to-b from-transparent via-[#ffdf8c] to-transparent shadow-[0_0_26px_rgba(255,213,115,.75)]" style={{ animation: 'legacy-unseal-crack 1.45s cubic-bezier(.15,.75,.2,1) .18s forwards' }} />
      <div aria-hidden="true" className="absolute left-1/2 top-1/2 h-24 w-24 rounded-full border border-[#e0b75f]/55" style={{ animation: 'legacy-unseal-ring 2.1s ease-out .55s forwards' }} />
      {embers.map((ember) => (
        <i key={ember.id} aria-hidden="true" className="absolute h-1 w-1 rounded-full bg-[#e8c06b] shadow-[0_0_9px_rgba(235,193,103,.9)]" style={{ left: ember.left, top: ember.top, animation: `legacy-unseal-ember 2.6s ease-out ${ember.delay} infinite` }} />
      ))}
      <div className="relative z-10 flex h-full items-center justify-center px-5 text-center" style={{ animation: 'legacy-unseal-copy 4.2s ease-out forwards' }}>
        <div>
          <div className="text-[11px] font-black tracking-[0.34em] text-[#b89150]">THE SEAL IS BROKEN</div>
          <h2 className="mt-4 font-display text-4xl text-[#f1dfb7] sm:text-6xl">봉인이 해제되었습니다.</h2>
          <div className="mx-auto mt-7 h-px w-40 bg-gradient-to-r from-transparent via-[#c9a45b] to-transparent" />
          <p className="mt-7 text-lg font-black text-[#dfc58e] sm:text-2xl">12명의 기록 계승자가 확인되었습니다.</p>
          <p className="mt-3 text-sm font-bold text-[#aaa093] sm:text-base">개척자들이 남긴 마지막 유산이<br className="sm:hidden" /> 다시 움직이기 시작합니다.</p>
        </div>
      </div>
    </div>
  );
}

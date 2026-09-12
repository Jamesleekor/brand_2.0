import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { LoadingSpinner } from '@/components/shared/components';
import { TeacherShell } from '@/components/teacher/TeacherShell';
import { supabase } from '@/lib/supabase/client';
import { tikatukaRpcErrorMessage, tikatukaTeacherRpc } from '@/lib/rpc/tikatuka_rpc';
import type { TikatukaDifficulty } from '@/lib/zod_schemas/tikatuka_schemas';

const DIFFICULTIES = [1,2,3,4,5,6,7,8,9,10] as const satisfies readonly TikatukaDifficulty[];

function formatKst(value: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
}

export default function TeacherTikatukaAdminPage() {
  const client = useQueryClient();
  const [drafts, setDrafts] = useState<Record<number, TikatukaDifficulty>>({});
  const [savingStudentId, setSavingStudentId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [savedStudentId, setSavedStudentId] = useState<number | null>(null);

  const query = useQuery({
    queryKey: ['teacher-tikatuka-progress'],
    queryFn: async () => {
      const result = await tikatukaTeacherRpc.listProgress(supabase);
      if (result.success === false) throw new Error(tikatukaRpcErrorMessage(result));
      return result.data;
    },
  });

  const saveProgress = async (studentId: number, current: TikatukaDifficulty) => {
    const difficulty = drafts[studentId] ?? current;
    setSavingStudentId(studentId);
    setSavedStudentId(null);
    setActionError(null);

    const result = await tikatukaTeacherRpc.setProgress(supabase, {
      p_student_id: studentId,
      p_highest_unlocked_difficulty: difficulty,
    });

    setSavingStudentId(null);
    if (result.success === false) {
      setActionError(tikatukaRpcErrorMessage(result));
      return;
    }

    client.setQueryData(['teacher-tikatuka-progress'], (old: typeof query.data) => old ? {
      ...old,
      items: old.items.map((item) => item.student_id === studentId ? result.data : item),
    } : old);
    setDrafts((currentDrafts) => {
      const next = { ...currentDrafts };
      delete next[studentId];
      return next;
    });
    setSavedStudentId(studentId);
  };

  return (
    <TeacherShell>
      <div className="space-y-6">
        <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
          <div>
            <div className="text-xs font-black tracking-[0.18em] text-brand-primary">ARCADE · GAME #03</div>
            <h1 className="mt-1 font-display text-2xl text-brand-gradient">🛡️ 라카루카 관리</h1>
            <p className="mt-1 text-sm font-bold text-text-secondary">학생별 최고 해금 난이도를 확인하고 필요한 경우 직접 조정합니다.</p>
          </div>
          <Link className="btn-secondary" to="/teacher/arcade">← Arcade 운영</Link>
        </div>

        <section className="glass-card border-brand-primary/30 p-5">
          <h2 className="font-display text-lg text-white">관리 원칙</h2>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <InfoCard icon="🔓" title="해금 난이도" text="교사가 Lv.1~10 중 원하는 최고 난이도로 조정할 수 있습니다." />
            <InfoCard icon="🏆" title="클리어 기록" text="실제 완료 경기의 승리 기록에서 계산합니다. 교사 조정으로 지우거나 만들지 않습니다." />
            <InfoCard icon="🔒" title="학급 제한" text="서버가 현재 교사의 담당 학급을 다시 검사하므로 다른 학급 학생은 수정할 수 없습니다." />
          </div>
          <p className="mt-4 rounded-card-md border border-warning/30 bg-warning/10 px-4 py-3 text-xs font-bold leading-relaxed text-warning">
            최고 해금 난이도를 낮춰도 과거 클리어 기록과 승패 이력은 그대로 남습니다. 학생 지원·테스트 등 명확한 이유가 있을 때만 조정하세요.
          </p>
        </section>

        {actionError && <div className="glass-card border-danger/40 p-4 text-sm font-bold text-danger">{actionError}</div>}
        {query.isLoading && <div className="py-16 text-center"><LoadingSpinner size="lg" /></div>}
        {query.isError && (
          <div className="glass-card border-danger/40 p-5">
            <div className="font-black text-danger">라카루카 진행도를 불러오지 못했습니다.</div>
            <p className="mt-2 text-xs text-text-secondary">{query.error instanceof Error ? query.error.message : '알 수 없는 오류'}</p>
            <button className="btn-secondary mt-3" onClick={() => void query.refetch()}>다시 시도</button>
          </div>
        )}

        {query.data && (
          <section className="glass-card overflow-hidden p-0">
            <div className="border-b border-line p-5">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <h2 className="font-display text-lg text-white">학생 진행도</h2>
                  <p className="mt-1 text-xs text-text-secondary">총 {query.data.items.length}명 · 해금 상태와 실제 경기 이력을 함께 확인합니다.</p>
                </div>
                <button className="btn-secondary text-xs" onClick={() => void query.refetch()}>새로고침</button>
              </div>
            </div>

            {!query.data.items.length ? (
              <p className="p-10 text-center text-sm text-text-secondary">관리할 학생이 없습니다.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-[980px] w-full text-left">
                  <thead className="bg-bg-deep text-xs font-black text-text-muted">
                    <tr>
                      <th className="px-4 py-3">학생</th>
                      <th className="px-4 py-3">실제 클리어</th>
                      <th className="px-4 py-3 text-center">전적</th>
                      <th className="px-4 py-3">최근 플레이</th>
                      <th className="px-4 py-3">최고 해금 난이도</th>
                      <th className="px-4 py-3 text-right">적용</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line/70">
                    {query.data.items.map((item) => {
                      const selected = drafts[item.student_id] ?? item.highest_unlocked_difficulty;
                      const changed = selected !== item.highest_unlocked_difficulty;
                      const saving = savingStudentId === item.student_id;
                      return (
                        <tr key={item.student_id} className="bg-bg-card/30 align-middle">
                          <td className="px-4 py-4">
                            <div className="font-black text-white">{item.brand_name || item.student_name}</div>
                            {item.brand_name && <div className="mt-0.5 text-xs font-bold text-text-muted">{item.student_name}</div>}
                          </td>
                          <td className="px-4 py-4">
                            {item.cleared_difficulties.length ? (
                              <div className="flex max-w-[250px] flex-wrap gap-1.5">
                                {item.cleared_difficulties.map((level) => <span key={level} className="rounded-pill border border-success/35 bg-success/10 px-2 py-1 text-[11px] font-black text-success">Lv.{level}</span>)}
                              </div>
                            ) : <span className="text-xs font-bold text-text-muted">아직 없음</span>}
                          </td>
                          <td className="px-4 py-4 text-center">
                            <div className="font-black text-white">{item.games_played}전</div>
                            <div className="mt-1 text-[11px] font-bold text-text-secondary">{item.wins}승 · {item.losses}패 · {item.draws}무</div>
                          </td>
                          <td className="px-4 py-4 text-xs font-bold text-text-secondary">{formatKst(item.last_played_at)}</td>
                          <td className="px-4 py-4">
                            <select
                              className="input-field min-w-[130px]"
                              value={selected}
                              disabled={saving}
                              onChange={(event) => setDrafts((current) => ({ ...current, [item.student_id]: Number(event.target.value) as TikatukaDifficulty }))}
                            >
                              {DIFFICULTIES.map((level) => <option key={level} value={level}>Lv.{level}</option>)}
                            </select>
                            <div className="mt-1 text-[10px] font-bold text-text-muted">현재 서버: Lv.{item.highest_unlocked_difficulty}</div>
                          </td>
                          <td className="px-4 py-4 text-right">
                            <button
                              className={changed ? 'btn-primary text-xs' : 'btn-secondary text-xs'}
                              disabled={!changed || saving}
                              onClick={() => void saveProgress(item.student_id, item.highest_unlocked_difficulty)}
                            >
                              {saving ? '저장 중...' : savedStudentId === item.student_id ? '✓ 저장됨' : changed ? '변경 적용' : '변경 없음'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </div>
    </TeacherShell>
  );
}

function InfoCard({ icon, title, text }: { icon: string; title: string; text: string }) {
  return (
    <div className="rounded-card-md border border-line bg-bg-deep p-4">
      <div className="flex items-center gap-2"><span className="text-xl">{icon}</span><b className="text-sm text-white">{title}</b></div>
      <p className="mt-2 text-xs font-bold leading-relaxed text-text-secondary">{text}</p>
    </div>
  );
}

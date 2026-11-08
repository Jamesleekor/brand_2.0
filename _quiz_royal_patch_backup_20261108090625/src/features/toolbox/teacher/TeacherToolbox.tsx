// =====================================================================
// 교사 — 모험가 도구함 첫 화면 · 수업 도구(개인 도구) 화면
// =====================================================================

import { useNavigate, useParams } from 'react-router-dom';
import { TeacherShell } from '@/components/teacher/TeacherShell';
import { supabase } from '@/lib/supabase/client';
import { useAuthStore } from '@/stores/auth_store';
import { useLiveResource, useToolboxPulse } from '../useToolboxPulse';
import { toToolboxError, toolboxRpc } from '../toolbox_rpc';
import { Glyph, KIND_GLYPH, KIND_LABEL, Notice, relTime, useAction, useConfirm } from '../ui';
import { PERSONAL_TOOLS } from '../personal/common';
import { PersonalToolSwitch } from '../personal/PersonalToolSwitch';
import type { ActivitySummary, ClassActivityKind, PersonalToolId, RosterItem } from '../toolbox_types';
import '../toolbox.css';

export const CLASS_KINDS: { kind: ClassActivityKind; desc: string }[] = [
  { kind: 'BUZZER', desc: '학생 기기로 누른 순서를 받아요. 문제마다 배점을 정해요.' },
  { kind: 'SCOREBOARD', desc: '팀별 점수를 바꾸고 순위를 함께 봐요.' },
  { kind: 'TOURNAMENT', desc: '대진을 만들고 승자를 골라 다음 경기로 올려요.' },
  { kind: 'VOTE', desc: '찬반·다지선다·후보 선출 투표를 열어요.' },
  { kind: 'CARDS', desc: '학생이 낸 제목 카드를 모아 보고 발표를 진행해요.' },
];

export function statusChip(a: Pick<ActivitySummary, 'status' | 'kind'>) {
  if (a.status === 'READY') return <span className="tbx-chip">준비 중</span>;
  if (a.status === 'OPEN') return <span className="tbx-chip tbx-chip--live">진행 중</span>;
  if (a.status === 'CLOSED') return <span className="tbx-chip tbx-chip--violet">{a.kind === 'VOTE' ? '마감됨' : '닫힘'}</span>;
  return <span className="tbx-chip">기록</span>;
}

export function TeacherToolboxHub() {
  const navigate = useNavigate();
  const classroomId = useAuthStore((s) => s.context?.classroomId ?? null);
  const pulse = useToolboxPulse(supabase, classroomId, 'T');
  const hub = useLiveResource(`hub:${classroomId}`, () => toolboxRpc.hub(supabase), {
    enabled: !!classroomId, rev: pulse.rev, revInitial: pulse.initial,
    // 버저 입력·카드 제출처럼 목록과 무관한 신호는 건너뛴다.
    relevant: () => !['PRESS', 'FALSE_START', 'CARD', 'BALLOT'].includes(String(pulse.payload.event ?? '')),
    debounceMs: 300,
  });
  const { run } = useAction();
  const { ask, dialog } = useConfirm();
  const live = hub.data?.live ?? [];
  const records = hub.data?.records ?? [];

  const removeRecord = async (a: ActivitySummary) => {
    if (!(await ask('기록을 지울까요?', <>「{a.title}」 기록을 지우면 되돌릴 수 없어요. 학생 계정·길드·재화 기록은 바뀌지 않아요.</>, '지우기', true))) return;
    await run('del', () => toolboxRpc.remove(supabase, a.id), '기록을 지웠어요');
    hub.refresh();
  };

  return (
    <TeacherShell>
      <div className="tbx tbx-teacher-page">
        <div className="tbx-hero">
          <Glyph name="kit" size="lg" />
          <div>
            <h1 className="tbx-h1">모험가 도구함</h1>
            <p className="tbx-small">수업에 쓰는 도구와 학생이 함께 참여하는 학급 활동을 한곳에서 열어요.</p>
          </div>
        </div>
        {hub.error && <Notice tone="ember" icon="⚠️">{toToolboxError(hub.error).message}</Notice>}
        {(hub.data?.cleaned ?? 0) > 0 && <Notice icon="🧹">7일 넘게 그대로 둔 학급 활동 {hub.data!.cleaned}개를 정리했어요.</Notice>}

        {live.length > 0 && (
          <section className="tbx-live" aria-label="진행 중인 학급 활동">
            <div className="tbx-live__head"><span className="tbx-h3 tbx-signal-text">진행 중인 학급 활동</span><span className="tbx-chip tbx-chip--live">{live.length}개</span></div>
            {live.map((a) => (
              <button key={a.id} type="button" className="tbx-live__item" onClick={() => navigate(`/teacher/toolbox/activity/${a.id}`)}>
                <Glyph name={KIND_GLYPH[a.kind]} />
                <span className="tbx-grow">
                  <span className="tbx-h3" style={{ display: 'block' }}>{a.title}</span>
                  <span className="tbx-small">{KIND_LABEL[a.kind]} — {relTime(a.opened_at ?? a.created_at)} 시작{a.unit_count ? `, 참가 ${a.unit_count}` : ''}{a.eligible_count && a.kind !== 'BUZZER' ? `, 대상 ${a.eligible_count}명` : ''}</span>
                </span>
                {statusChip(a)}
                <span className="tbx-btn tbx-btn--sm">운영하기</span>
              </button>
            ))}
          </section>
        )}

        <section className="tbx-stack">
          <div className="tbx-section-head"><h2 className="tbx-h2">학급 활동 만들기</h2><span className="tbx-small">학생이 자기 기기로 참여하거나 함께 봐요</span></div>
          <div className="tbx-tools tbx-tools--five">
            {CLASS_KINDS.map((k) => (
              <button key={k.kind} type="button" className="tbx-tile" onClick={() => navigate(`/teacher/toolbox/new/${k.kind.toLowerCase()}`)}>
                <Glyph name={KIND_GLYPH[k.kind]} />
                <span><span className="tbx-tile__name" style={{ display: 'block' }}>{KIND_LABEL[k.kind]}</span><span className="tbx-tile__desc">{k.desc}</span></span>
              </button>
            ))}
          </div>
        </section>

        <section className="tbx-stack">
          <div className="tbx-section-head"><h2 className="tbx-h2">수업 도구</h2><span className="tbx-small">기록을 남기지 않는 도구예요. 학생 홈에도 똑같이 있어요</span></div>
          <div className="tbx-tools tbx-tools--six">
            {PERSONAL_TOOLS.map((t) => (
              <button key={t.id} type="button" className="tbx-tile" onClick={() => navigate(`/teacher/toolbox/tool/${t.id}`)}>
                <Glyph name={t.glyph} />
                <span><span className="tbx-tile__name" style={{ display: 'block' }}>{t.name}</span><span className="tbx-tile__desc">{t.desc}</span></span>
              </button>
            ))}
          </div>
        </section>

        <section className="tbx-panel tbx-stack">
          <div className="tbx-section-head"><h2 className="tbx-h2">기록</h2><span className="tbx-small">투표와 점수판만 기록으로 남아요</span></div>
          {records.length === 0 ? <p className="tbx-small">아직 끝낸 투표·점수판이 없어요.</p> : (
            <div className="tbx-list">
              {records.map((a) => (
                <div key={a.id} className="tbx-list__row">
                  <Glyph name={KIND_GLYPH[a.kind]} />
                  <span className="tbx-grow">
                    <span className="tbx-h3" style={{ display: 'block' }}>{a.title}</span>
                    <span className="tbx-small">{KIND_LABEL[a.kind]} — {a.ended_at ? new Date(a.ended_at).toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}</span>
                  </span>
                  <button type="button" className="tbx-btn tbx-btn--sm" onClick={() => navigate(`/teacher/toolbox/activity/${a.id}`)}>열어 보기</button>
                  <button type="button" className="tbx-btn tbx-btn--sm tbx-btn--ghost" onClick={() => void removeRecord(a)}>지우기</button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
      {dialog}
    </TeacherShell>
  );
}

export function TeacherPersonalToolPage() {
  const { tool } = useParams<{ tool: PersonalToolId }>();
  const navigate = useNavigate();
  const context = useAuthStore((s) => s.context);
  const userId = useAuthStore((s) => s.user?.id ?? 'teacher');
  const meta = PERSONAL_TOOLS.find((t) => t.id === tool);
  if (!meta || !context) return null;
  const sendTeams = (target: 'SCOREBOARD' | 'TOURNAMENT' | 'BUZZER', teams: RosterItem[]) =>
    navigate(`/teacher/toolbox/new/${target.toLowerCase()}`, { state: { teams } });
  return (
    <TeacherShell>
      <div className="tbx">
        <button type="button" className="tbx-btn tbx-btn--ghost tbx-btn--sm" onClick={() => navigate('/teacher/toolbox')}>← 모험가 도구함</button>
        <PersonalToolSwitch tool={meta.id} props={{
          client: supabase, classroomId: context.classroomId, audience: 'teacher', ownerKey: `t${userId.slice(0, 8)}`,
          onSendTeams: sendTeams, onOpenTool: (t) => navigate(`/teacher/toolbox/tool/${t}`),
        }} />
      </div>
    </TeacherShell>
  );
}

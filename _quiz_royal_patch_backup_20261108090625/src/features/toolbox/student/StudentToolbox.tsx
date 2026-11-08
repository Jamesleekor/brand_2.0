// =====================================================================
// 학생 — 모험가 도구함 첫 화면 · 개인 도구 화면
// =====================================================================

import { useNavigate, useParams } from 'react-router-dom';
import { PageHeader } from '@/components/shared/components';
import { supabase } from '@/lib/supabase/client';
import { useAuthStore } from '@/stores/auth_store';
import { LIFECYCLE_EVENTS, useLiveResource, useToolboxPulse } from '../useToolboxPulse';
import { toolboxRpc } from '../toolbox_rpc';
import { Glyph, KIND_GLYPH, KIND_LABEL } from '../ui';
import { PERSONAL_TOOLS } from '../personal/common';
import { PersonalToolSwitch } from '../personal/PersonalToolSwitch';
import type { PersonalToolId, StudentFeedItem } from '../toolbox_types';
import '../toolbox.css';

export function useStudentFeed() {
  const classroomId = useAuthStore((s) => s.context?.classroomId ?? null);
  const pulse = useToolboxPulse(supabase, classroomId, 'S');
  const feed = useLiveResource(`feed:${classroomId}`, () => toolboxRpc.feed(supabase), {
    enabled: !!classroomId, rev: pulse.rev, revInitial: pulse.initial, debounceMs: 200, jitterMs: 900,
    relevant: () => !pulse.payload.event || LIFECYCLE_EVENTS.has(String(pulse.payload.event)),
  });
  return { feed, pulse };
}

export function feedStatusText(item: StudentFeedItem): { text: string; tone: 'live' | 'done' | 'plain' } {
  switch (item.kind) {
    case 'VOTE':
      if (item.status === 'CLOSED') return { text: '마감됨', tone: 'plain' };
      return item.mine.submitted ? { text: '투표함 · 마감 전까지 바꿀 수 있어요', tone: 'done' } : { text: '투표할 수 있어요', tone: 'live' };
    case 'CARDS':
      if (!item.mine.submission_open) return { text: item.mine.submitted ? '제출함 · 제출이 닫혔어요' : '제출이 닫혔어요', tone: 'plain' };
      return item.mine.submitted ? { text: '제출함 · 고칠 수 있어요', tone: 'done' } : { text: '카드를 낼 수 있어요', tone: 'live' };
    case 'BUZZER':
      return item.mine.round_status === 'OPEN' ? { text: '지금 누를 수 있어요', tone: 'live' } : { text: '문제를 기다리는 중', tone: 'plain' };
    case 'SCOREBOARD':
      return { text: '점수 보기', tone: 'plain' };
    default:
      return { text: '대진표 보기', tone: 'plain' };
  }
}

export function StudentToolboxHome() {
  const navigate = useNavigate();
  const { feed } = useStudentFeed();
  const live = feed.data?.activities ?? [];

  return (
    <div className="tbx">
      <PageHeader title="모험가 도구함" />
      <div className="tbx-page">
        {live.length > 0 && (
          <section className="tbx-live" aria-label="지금 열린 학급 활동">
            <div className="tbx-live__head">
              <span className="tbx-h3 tbx-signal-text">지금 열린 학급 활동</span>
              <span className="tbx-chip tbx-chip--live">{live.length}개</span>
            </div>
            {live.map((item) => {
              const st = feedStatusText(item);
              return (
                <button key={item.id} type="button" className="tbx-live__item" onClick={() => navigate(`/toolbox/live/${item.id}`)}>
                  <Glyph name={KIND_GLYPH[item.kind]} />
                  <span className="tbx-grow">
                    <span className="tbx-h3" style={{ display: 'block' }}>{item.title}</span>
                    <span className="tbx-small">{KIND_LABEL[item.kind]} — {st.text}</span>
                  </span>
                  <span className={st.tone === 'live' ? 'tbx-btn tbx-btn--sm tbx-btn--signal' : 'tbx-btn tbx-btn--sm'}>{st.tone === 'done' ? '다시 보기' : '들어가기'}</span>
                </button>
              );
            })}
          </section>
        )}

        <section className="tbx-stack">
          <div className="tbx-section-head">
            <h2 className="tbx-h2">나의 도구</h2>
            <span className="tbx-small">혼자 쓰는 도구예요. 결과는 기록되지 않아요.</span>
          </div>
          <div className="tbx-tools">
            {PERSONAL_TOOLS.map((t) => (
              <button key={t.id} type="button" className="tbx-tile" onClick={() => navigate(`/toolbox/tool/${t.id}`)}>
                <Glyph name={t.glyph} />
                <span>
                  <span className="tbx-tile__name" style={{ display: 'block' }}>{t.name}</span>
                  <span className="tbx-tile__desc">{t.desc}</span>
                </span>
              </button>
            ))}
          </div>
        </section>

        {live.length === 0 && !feed.loading && (
          <p className="tbx-small" style={{ textAlign: 'center' }}>운영국이 버저·투표·발표 카드를 열면 이곳 맨 위에 나타나요.</p>
        )}
      </div>
    </div>
  );
}

export function StudentPersonalToolPage() {
  const { tool } = useParams<{ tool: PersonalToolId }>();
  const context = useAuthStore((s) => s.context);
  const navigate = useNavigate();
  const meta = PERSONAL_TOOLS.find((t) => t.id === tool);
  if (!meta || !context) return null;
  return (
    <div className="tbx">
      <PageHeader title="모험가 도구함" onBack={() => navigate('/toolbox', { replace: true })} />
      <PersonalToolSwitch tool={meta.id} props={{
        client: supabase, classroomId: context.classroomId, audience: 'student', ownerKey: `s${context.studentId ?? 'x'}`,
        onOpenTool: (t) => navigate(`/toolbox/tool/${t}`),
      }} />
    </div>
  );
}

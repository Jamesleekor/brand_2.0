// =====================================================================
// 학생 도구함 첫 화면 — 퀴즈 로얄 입구 카드
// ---------------------------------------------------------------------
// 길드 제출 대표 계정에만 보인다. 대기실이 열리거나 대회가 끝날 때
// 도구함 학생 신호(S)에 'QUIZ' 표시가 실려 오면 그때만 다시 확인한다.
// DB에 퀴즈 기능이 아직 없으면 아무것도 그리지 않는다.
// =====================================================================

import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase/client';
import { useAuthStore } from '@/stores/auth_store';
import { useLiveResource, useToolboxPulse } from '../useToolboxPulse';
import { quizRpc } from './quiz_rpc';
import { PHASE_LABEL } from './quiz_types';
import './quiz.css';

export function StudentQuizEntry() {
  const navigate = useNavigate();
  const classroomId = useAuthStore((s) => s.context?.classroomId ?? null);
  const pulse = useToolboxPulse(supabase, classroomId, 'S');
  const feed = useLiveResource(`quizfeed:${classroomId}`, () => quizRpc.feed(supabase).catch(() => ({ events: [], server_now: '' })), {
    enabled: !!classroomId, rev: pulse.rev, revInitial: pulse.initial, debounceMs: 200, jitterMs: 900,
    relevant: () => pulse.payload.event === 'QUIZ',
  });
  const events = feed.data?.events ?? [];
  if (events.length === 0) return null;
  return (
    <section className="tbx-live qz-entry" aria-label="퀴즈 로얄">
      {events.map((e) => (
        <button key={e.id} type="button" className="tbx-live__item qz-entry__item" onClick={() => navigate(`/toolbox/quiz/${e.id}`)}>
          <span className="qz-entry__icon" aria-hidden="true">⚔️</span>
          <span className="tbx-grow">
            <span className="tbx-h3" style={{ display: 'block' }}>{e.title}</span>
            <span className="tbx-small">{e.guild_name} 길드 제출 태블릿 — {PHASE_LABEL[e.phase]}</span>
          </span>
          <span className="tbx-btn tbx-btn--sm tbx-btn--signal">들어가기</span>
        </button>
      ))}
    </section>
  );
}

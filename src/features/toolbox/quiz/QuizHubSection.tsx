// =====================================================================
// 교사 도구함 첫 화면 — '길드 대항 퀴즈 로얄' 칸 (입구)
// ---------------------------------------------------------------------
// 퀴즈 서버 함수가 아직 없는 DB(마이그레이션 전)에서는 칸 전체를 조용히 숨긴다.
// =====================================================================

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase/client';
import { InlineError, Modal, Toggle, relTime, useAction } from '../ui';
import { quizRpc } from './quiz_rpc';
import { PhaseChip } from './quiz_ui';
import type { QuizListItem } from './quiz_types';
import './quiz.css';

export function quizHomePath(item: Pick<QuizListItem, 'id' | 'phase'>) {
  return item.phase === 'SETUP' ? `/teacher/toolbox/quiz/${item.id}/setup` : `/teacher/toolbox/quiz/${item.id}`;
}

export function QuizHubSection() {
  const navigate = useNavigate();
  const [items, setItems] = useState<QuizListItem[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [rehearsal, setRehearsal] = useState(false);
  const { run, busy, error } = useAction();

  useEffect(() => {
    let alive = true;
    quizRpc.list(supabase)
      .then((r) => { if (alive) setItems(r.events); })
      .catch(() => { if (alive) setUnavailable(true); });
    return () => { alive = false; };
  }, []);

  if (unavailable) return null;

  const create = async () => {
    const res = await run('create', () => quizRpc.create(supabase, title.trim(), rehearsal), '퀴즈 대회를 만들었어요');
    if (res) navigate(`/teacher/toolbox/quiz/${res.id}/setup`);
  };

  const live = (items ?? []).filter((x) => x.phase !== 'COMPLETED');
  const done = (items ?? []).filter((x) => x.phase === 'COMPLETED');

  return (
    <section className="tbx-panel tbx-stack qz-hub">
      <div className="tbx-section-head">
        <h2 className="tbx-h2">⚔️ 길드 대항 퀴즈 로얄</h2>
        <span className="tbx-small">길드 태블릿으로 답을 받고, 교실 화면에 함께 공개해요. 기록은 모두 남아요.</span>
      </div>
      <div className="tbx-row tbx-row--wrap" style={{ gap: 8 }}>
        <button type="button" className="tbx-btn tbx-btn--brass" onClick={() => { setTitle(''); setRehearsal(false); setOpen(true); }}>새 퀴즈 대회 만들기</button>
        <button type="button" className="tbx-btn" onClick={() => { setTitle('리허설'); setRehearsal(true); setOpen(true); }}>리허설 대회 만들기</button>
      </div>
      {items === null ? <p className="tbx-small">불러오는 중…</p> : items.length === 0 ? (
        <p className="tbx-small">아직 만든 퀴즈 대회가 없어요.</p>
      ) : (
        <div className="tbx-list">
          {[...live, ...done].map((x) => (
            <div key={x.id} className="tbx-list__row">
              <span className="tbx-grow">
                <span className="tbx-h3" style={{ display: 'block' }}>{x.title}{x.is_rehearsal ? ' · 리허설' : ''}</span>
                <span className="tbx-small">길드 {x.guild_count} · 문제 {x.question_count} · {relTime(x.completed_at ?? x.started_at ?? x.created_at)}</span>
              </span>
              <PhaseChip phase={x.phase} />
              {x.phase === 'SETUP' || x.phase === 'LOBBY' ? (
                <button type="button" className="tbx-btn tbx-btn--sm" onClick={() => navigate(`/teacher/toolbox/quiz/${x.id}/setup`)}>준비하기</button>
              ) : null}
              <button type="button" className={x.phase === 'COMPLETED' ? 'tbx-btn tbx-btn--sm' : 'tbx-btn tbx-btn--sm tbx-btn--signal'}
                onClick={() => navigate(`/teacher/toolbox/quiz/${x.id}`)}>{x.phase === 'COMPLETED' ? '기록 보기' : '진행 화면'}</button>
            </div>
          ))}
        </div>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title={rehearsal ? '리허설 대회 만들기' : '새 퀴즈 대회 만들기'}
        footer={<>
          <button type="button" className="tbx-btn" onClick={() => setOpen(false)}>취소</button>
          <button type="button" className="tbx-btn tbx-btn--brass" disabled={!title.trim() || busy === 'create'} onClick={() => void create()}>
            {busy === 'create' ? '만드는 중…' : '만들기'}
          </button>
        </>}>
        <div className="tbx-stack">
          <label className="tbx-label" htmlFor="qz-new-title">대회 이름</label>
          <input id="qz-new-title" className="tbx-input" maxLength={60} value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder="예: 11월 길드미션 1 — B.R.A.N.D 퀴즈 로얄" autoFocus />
          <Toggle checked={rehearsal} onChange={setRehearsal} title="리허설 대회"
            hint="실전과 똑같이 진행하지만 끝난 뒤 지울 수 있어요. 실제 경기 기록은 지울 수 없어요." />
          <p className="tbx-small">참가 길드는 우리 반 활성 길드로 자동으로 채워져요(테스트용 길드 제외). 준비 화면에서 바꿀 수 있어요.</p>
          <InlineError error={error} />
        </div>
      </Modal>
    </section>
  );
}

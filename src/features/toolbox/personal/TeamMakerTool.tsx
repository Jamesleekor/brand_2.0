// 팀 만들기 — 팀당 희망 인원으로 무작위 편성. 남는 인원은 고르게 나누거나 대기로 둔다.
// 편성 뒤에는 이름·색을 바꾸고, 사람을 골라 다른 팀(또는 대기)으로 옮길 수 있다.

import { useMemo, useState } from 'react';
import { Notice, Seg, Stepper, TEAM_COLORS, TEAM_COLOR_NAMES, colorAt, shuffle, useConfirm } from '../ui';
import { ParticipantSection, ToolHeader, rememberRecent, useLocalState, useParticipants, useToolChrome, type PersonalToolProps } from './common';
import type { RosterItem, Unit } from '../toolbox_types';

interface Team { id: string; name: string; color: string; members: string[] }
interface TeamSave { size: number; remainder: 'EVEN' | 'WAIT'; teams: Team[] | null; waiting: string[] }
const INITIAL: TeamSave = { size: 4, remainder: 'EVEN', teams: null, waiting: [] };

/** 예상 편성: 팀 수와 팀별 인원 */
export function planTeams(n: number, size: number, remainder: 'EVEN' | 'WAIT'): { sizes: number[]; waiting: number } {
  if (n <= 0 || size <= 0) return { sizes: [], waiting: 0 };
  if (remainder === 'WAIT') {
    const count = Math.floor(n / size);
    return { sizes: Array(count).fill(size), waiting: n - count * size };
  }
  const count = Math.ceil(n / size);
  const base = Math.floor(n / count);
  const extra = n % count;
  return { sizes: Array.from({ length: count }, (_, i) => base + (i < extra ? 1 : 0)), waiting: 0 };
}

function describe(plan: { sizes: number[]; waiting: number }, word: string) {
  const groups = new Map<number, number>();
  plan.sizes.forEach((s) => groups.set(s, (groups.get(s) ?? 0) + 1));
  const parts = [...groups.entries()].sort((a, b) => b[0] - a[0]).map(([s, c]) => `${s}${word} 팀 ${c}개`);
  if (plan.waiting) parts.push(`대기 ${plan.waiting}${word}`);
  return parts.join(' + ');
}

export function TeamMakerTool(props: PersonalToolProps) {
  const p = useParticipants(props, 'teams');
  const { chrome } = useToolChrome();
  const { ask, dialog } = useConfirm();
  const [save, setSave] = useLocalState<TeamSave>(`brand.toolbox.${props.ownerKey}.teams.state`, INITIAL);
  const [picked, setPicked] = useState<string | null>(null);
  const units = p.units;
  const unitMap = useMemo(() => new Map(units.map((u) => [u.key, u] as const)), [units]);
  const n = units.length;
  const word = units.some((u) => u.type !== 'STUDENT') ? '항목' : '명';
  const sizeOk = save.size >= 1 && save.size <= Math.max(n, 1);
  const plan = planTeams(n, sizeOk ? save.size : 1, save.remainder);
  const made = save.teams !== null;

  const make = async () => {
    if (made && !(await ask('다시 섞을까요?', '지금 팀 구성은 사라지고 새로 편성해요.', '다시 섞기'))) return;
    rememberRecent(props, '팀 만들기', p.items);
    const order = shuffle(units.map((u) => u.key));
    let cursor = 0;
    const teams: Team[] = plan.sizes.map((sz, i) => {
      const members = order.slice(cursor, cursor + sz);
      cursor += sz;
      return { id: `T${i + 1}`, name: `${i + 1}팀`, color: colorAt(i), members };
    });
    setSave((s) => ({ ...s, teams, waiting: order.slice(cursor) }));
    setPicked(null);
  };

  const moveTo = (target: string) => {
    if (!picked || !save.teams) return;
    setSave((s) => {
      const teams = s.teams!.map((t) => ({ ...t, members: t.members.filter((k) => k !== picked) }));
      let waiting = s.waiting.filter((k) => k !== picked);
      if (target === 'WAIT') waiting = [...waiting, picked];
      else teams.forEach((t) => { if (t.id === target) t.members.push(picked); });
      return { ...s, teams, waiting };
    });
    setPicked(null);
  };
  const editTeam = (id: string, patch: Partial<Team>) => setSave((s) => ({ ...s, teams: s.teams!.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
  const cycleColor = (team: Team) => editTeam(team.id, { color: TEAM_COLORS[(TEAM_COLORS.indexOf(team.color) + 1) % TEAM_COLORS.length] });

  const toRosterTeams = (): RosterItem[] => (save.teams ?? []).filter((t) => t.members.length > 0).map((t) => ({
    type: 'TEAM', key: t.id, label: t.name.trim() || t.id, color: t.color,
    member_ids: t.members.flatMap((k) => memberStudentIds(unitMap.get(k))),
  }));
  const send = async (target: 'SCOREBOARD' | 'TOURNAMENT' | 'BUZZER') => {
    if (save.waiting.length && !(await ask('대기 인원은 빠져요', `대기 중인 ${save.waiting.length}${word}은 보내는 활동에 들어가지 않아요.`, '계속'))) return;
    props.onSendTeams?.(target, toRosterTeams());
  };
  const sizes = (save.teams ?? []).map((t) => t.members.length);
  const uneven = sizes.length > 0 && Math.max(...sizes) - Math.min(...sizes) > 1;
  const placed = (save.teams ?? []).reduce((acc, t) => acc + t.members.length, 0) + save.waiting.length;

  return (
    <div className="tbx tbx-page">
      <ToolHeader tool="teams" right={chrome} />
      <div className="tbx-split">
        <div className="tbx-stack tbx-stack--loose">
          {!made ? (
            <div className="tbx-stage">
              <div className="tbx-empty">
                <p className="tbx-h2">{n ? describe(plan, word) : '참가자를 먼저 넣어 주세요'}</p>
                <p className="tbx-small" style={{ marginTop: 6 }}>{n ? `${n}${word}을 팀당 ${save.size}${word} 기준으로 나눠요.` : '학생·길드·직접 입력으로 넣을 수 있어요.'}</p>
              </div>
            </div>
          ) : (
            <>
              <div className="tbx-row tbx-row--between tbx-row--wrap">
                <span className="tbx-h2">{picked ? `${unitMap.get(picked)?.label}을(를) 옮길 팀을 눌러요` : '사람을 누르면 다른 팀으로 옮길 수 있어요'}</span>
                {picked && <button type="button" className="tbx-btn tbx-btn--sm tbx-btn--ghost" onClick={() => setPicked(null)}>옮기기 취소</button>}
              </div>
              {uneven && <Notice icon="ℹ️">팀 인원이 고르지 않아요: {sizes.join(' · ')}{word}</Notice>}
              <div className="tbx-teams">
                {save.teams!.map((t) => (
                  <div key={t.id} className="tbx-team" style={{ ['--team' as any]: t.color }} data-target={!!picked && !t.members.includes(picked)}
                    onClick={() => { if (picked && !t.members.includes(picked)) moveTo(t.id); }}>
                    <div className="tbx-team__head">
                      <button type="button" className="tbx-dot" style={{ background: t.color, width: 16, height: 16, border: 0, cursor: 'pointer' }}
                        onClick={(e) => { e.stopPropagation(); cycleColor(t); }} aria-label={`${t.name} 색 바꾸기 (지금 ${TEAM_COLOR_NAMES[TEAM_COLORS.indexOf(t.color)] ?? ''})`} />
                      <input value={t.name} maxLength={20} aria-label="팀 이름" onClick={(e) => e.stopPropagation()} onChange={(e) => editTeam(t.id, { name: e.target.value })} />
                      <span className="tbx-small" style={{ fontWeight: 800 }}>{t.members.length}</span>
                    </div>
                    <div className="tbx-team__body">
                      {t.members.map((k) => (
                        <button key={k} type="button" className="tbx-member" aria-pressed={picked === k}
                          onClick={(e) => { e.stopPropagation(); setPicked(picked === k ? null : k); }}>{unitMap.get(k)?.label ?? k}</button>
                      ))}
                      {t.members.length === 0 && <span className="tbx-small" style={{ padding: 8 }}>비어 있어요</span>}
                    </div>
                  </div>
                ))}
                <div className="tbx-team" data-target={!!picked && !save.waiting.includes(picked)} style={{ ['--team' as any]: '#6b647a' }}
                  onClick={() => { if (picked && !save.waiting.includes(picked)) moveTo('WAIT'); }}>
                  <div className="tbx-team__head"><span className="tbx-h3">대기</span><span className="tbx-small" style={{ marginLeft: 'auto', fontWeight: 800 }}>{save.waiting.length}</span></div>
                  <div className="tbx-team__body">
                    {save.waiting.map((k) => (
                      <button key={k} type="button" className="tbx-member" aria-pressed={picked === k}
                        onClick={(e) => { e.stopPropagation(); setPicked(picked === k ? null : k); }}>{unitMap.get(k)?.label ?? k}</button>
                    ))}
                    {save.waiting.length === 0 && <span className="tbx-small" style={{ padding: 8 }}>대기 인원 없음</span>}
                  </div>
                </div>
              </div>
              <p className="tbx-small">모두 {placed}{word} — 팀 {save.teams!.length}개, 대기 {save.waiting.length}{word}</p>
              {props.audience === 'teacher' && props.onSendTeams && (
                <section className="tbx-panel tbx-stack">
                  <h2 className="tbx-h2">이 팀으로 학급 활동 만들기</h2>
                  <p className="tbx-small">팀 이름·색·구성원을 그대로 가져가요. 점수는 0점부터 시작해요.</p>
                  <div className="tbx-row tbx-row--wrap">
                    <button type="button" className="tbx-btn" onClick={() => void send('SCOREBOARD')}>팀 점수판으로</button>
                    <button type="button" className="tbx-btn" onClick={() => void send('TOURNAMENT')}>대진표로</button>
                    <button type="button" className="tbx-btn" onClick={() => void send('BUZZER')}>버저로</button>
                  </div>
                </section>
              )}
            </>
          )}
        </div>

        <div className="tbx-stack tbx-stack--loose">
          <ParticipantSection props={props} {...p} locked={made} onUnlock={async () => {
            if (await ask('참가자를 바꿀까요?', '지금 팀 구성은 사라져요.', '바꾸기')) setSave((s) => ({ ...s, teams: null, waiting: [] }));
          }} />
          <section className="tbx-panel tbx-stack">
            <h2 className="tbx-h2">팀 나누기</h2>
            <div className="tbx-row tbx-row--between">
              <span className="tbx-h3">팀당 희망 인원</span>
              <Stepper value={save.size} min={1} max={Math.max(n, 1)} label="팀당 인원" onChange={(v) => setSave((s) => ({ ...s, size: v }))} suffix={word} />
            </div>
            <div>
              <span className="tbx-label">남는 인원</span>
              <Seg block value={save.remainder} onChange={(v) => setSave((s) => ({ ...s, remainder: v }))} label="남는 인원 처리"
                options={[{ value: 'EVEN', label: '고르게 나누기' }, { value: 'WAIT', label: '대기로 두기' }]} />
            </div>
            {n > 0 && <div className="tbx-well"><span className="tbx-small">예상 편성</span><div className="tbx-h3" style={{ marginTop: 2 }}>{describe(plan, word)}</div></div>}
            {!sizeOk && n > 0 && <Notice tone="ember" icon="⚖️">팀당 인원은 참가자 수({n})보다 클 수 없어요.</Notice>}
            <button type="button" className="tbx-btn tbx-btn--brass tbx-btn--lg tbx-btn--block" disabled={n === 0 || !sizeOk} onClick={() => void make()}>
              {made ? '전체 다시 섞기' : '팀 만들기'}
            </button>
          </section>
        </div>
      </div>
      {dialog}
    </div>
  );
}

function memberStudentIds(u: Unit | undefined): number[] {
  if (!u) return [];
  if (u.type === 'STUDENT' && u.student_id) return [u.student_id];
  return (u.members ?? []).map((m) => m.student_id);
}

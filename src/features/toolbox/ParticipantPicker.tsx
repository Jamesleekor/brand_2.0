// =====================================================================
// 모험가 도구함 — 공통 참가자 선택 패널
// ---------------------------------------------------------------------
// 학생 이름 버튼 · 길드(단위 또는 구성원) · 직접 입력 · 저장 명단.
// 같은 학생은 어떤 경로로 넣어도 한 번만 들어간다.
// =====================================================================

import { useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildUnits, isAbsent, mixedKinds, parseManualInput, studentLabel, type ClassRoster } from './roster';
import { toolboxRpc } from './toolbox_rpc';
import { Modal, Notice, Seg, colorAt, useAction } from './ui';
import type { RosterItem, RosterRow, Unit } from './toolbox_types';

export interface PickerOptions {
  /** 길드를 참가 단위 하나로 넣을 수 있는지 */
  guildAsUnit?: boolean;
  /** 길드 구성원을 학생 각각으로 넣을 수 있는지 */
  guildAsMembers?: boolean;
  /** 직접 입력 항목을 쓸 수 있는지 (버저처럼 실제 계정이 필요한 도구는 끈다) */
  manual?: boolean;
  /** 교사 화면: 출석 자동 제외, 저장 명단, 테스트 계정 보기 */
  teacher?: boolean;
  /** 학생 계정만 고르게 할 때 (투표·카드 구름의 참여 대상) */
  studentsOnly?: boolean;
}

interface Props {
  client: SupabaseClient;
  classroomId: number | null;
  roster: ClassRoster | null;
  value: RosterItem[];
  onChange: (items: RosterItem[]) => void;
  options?: PickerOptions;
}

type Tab = 'students' | 'guilds' | 'manual' | 'saved';

export function ParticipantPicker({ client, classroomId, roster, value, onChange, options = {} }: Props) {
  const { guildAsUnit = true, guildAsMembers = true, manual = true, teacher = false, studentsOnly = false } = options;
  const [tab, setTab] = useState<Tab>('students');
  const [search, setSearch] = useState('');
  const [showTest, setShowTest] = useState(false);
  const [manualText, setManualText] = useState('');
  const [nameClash, setNameClash] = useState<{ labels: string[]; clashes: string[] } | null>(null);
  const [reorder, setReorder] = useState(false);
  const units = useMemo(() => buildUnits(value, roster), [value, roster]);

  const students = useMemo(() => (roster?.students ?? []).filter((s) => showTest || !s.is_test), [roster, showTest]);
  const selectedStudentIds = useMemo(() => new Set(value.filter((x) => x.type === 'STUDENT').map((x) => (x as any).student_id as number)), [value]);
  const viaGuild = useMemo(() => {
    const ids = new Set<number>();
    for (const x of value) if (x.type === 'GUILD' && x.as === 'MEMBERS') x.member_ids.forEach((id) => ids.add(id));
    return ids;
  }, [value]);
  const attendanceKnown = teacher && roster?.attendance != null && Object.keys(roster.attendance).length > 0;
  const absentCount = teacher ? students.filter((s) => isAbsent(roster, s.id)).length : 0;

  const filtered = students.filter((s) => {
    const q = search.trim();
    if (!q) return true;
    return s.name.includes(q) || (s.brand_name ?? '').includes(q);
  });

  const toggleStudent = (id: number) => {
    const s = students.find((x) => x.id === id);
    if (!s) return;
    if (selectedStudentIds.has(id)) onChange(value.filter((x) => !(x.type === 'STUDENT' && x.student_id === id)));
    else onChange([...value, { type: 'STUDENT', student_id: id, label: studentLabel(s, roster?.students ?? []) }]);
  };

  const selectAll = () => {
    const add: RosterItem[] = [];
    for (const s of filtered) {
      if (selectedStudentIds.has(s.id)) continue;
      if (teacher && isAbsent(roster, s.id)) continue; // 결석은 자동 제외
      add.push({ type: 'STUDENT', student_id: s.id, label: studentLabel(s, roster?.students ?? []) });
    }
    onChange([...value, ...add]);
  };
  const clearStudents = () => onChange(value.filter((x) => x.type !== 'STUDENT'));

  const addGuild = (guildId: number, as: 'UNIT' | 'MEMBERS') => {
    const g = roster?.guilds.find((x) => x.id === guildId);
    if (!g) return;
    if (value.some((x) => x.type === 'GUILD' && x.guild_id === guildId && x.as === as)) return;
    const memberIds = as === 'MEMBERS' && teacher ? g.member_ids.filter((id) => !isAbsent(roster, id)) : g.member_ids;
    const used = value.filter((x) => x.type === 'GUILD' && x.as === 'UNIT').length;
    onChange([...value, { type: 'GUILD', guild_id: g.id, label: g.name, as, member_ids: memberIds, color: colorAt(used) }]);
  };

  const addManual = (labels: string[], forceSeparate = false) => {
    const nameSet = new Map((roster?.students ?? []).map((s) => [s.name, s] as const));
    const clashes = labels.filter((l) => nameSet.has(l));
    if (!forceSeparate && clashes.length && !studentsOnly) { setNameClash({ labels, clashes }); return; }
    const stamp = Date.now().toString(36);
    onChange([...value, ...labels.map((label, i) => ({ type: 'MANUAL' as const, id: `${stamp}${i}`, label }))]);
    setManualText('');
    setNameClash(null);
  };
  const resolveClashAsStudents = () => {
    if (!nameClash) return;
    const rest = nameClash.labels.filter((l) => !nameClash.clashes.includes(l));
    const add: RosterItem[] = [];
    for (const l of nameClash.clashes) {
      const s = (roster?.students ?? []).find((x) => x.name === l);
      if (s && !selectedStudentIds.has(s.id)) add.push({ type: 'STUDENT', student_id: s.id, label: studentLabel(s, roster?.students ?? []) });
    }
    const stamp = Date.now().toString(36);
    onChange([...value, ...add, ...rest.map((label, i) => ({ type: 'MANUAL' as const, id: `${stamp}${i}`, label }))]);
    setManualText('');
    setNameClash(null);
  };

  const removeAt = (i: number) => onChange(value.filter((_, idx) => idx !== i));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= value.length) return;
    const next = value.slice();
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  const tabs: { value: Tab; label: string }[] = [{ value: 'students', label: '학생' }];
  if (!studentsOnly && (guildAsUnit || guildAsMembers)) tabs.push({ value: 'guilds', label: '길드' });
  if (studentsOnly && guildAsMembers) tabs.push({ value: 'guilds', label: '길드' });
  if (manual && !studentsOnly) tabs.push({ value: 'manual', label: '직접 입력' });
  if (teacher) tabs.push({ value: 'saved', label: '저장 명단' });

  const manualPreview = parseManualInput(manualText);
  const unitWord = units.some((u) => u.type === 'GUILD' || u.type === 'TEAM' || u.type === 'MANUAL') ? '항목' : '명';

  return (
    <div className="tbx-picker">
      <div className="tbx-row tbx-row--between tbx-row--wrap">
        <Seg value={tab} options={tabs} onChange={setTab} label="참가자 고르는 방법" />
        <span className="tbx-count" aria-live="polite">참가 {units.length}{unitWord}</span>
      </div>

      {tab === 'students' && (
        <div className="tbx-stack">
          {teacher && (
            attendanceKnown
              ? absentCount > 0 && <Notice icon="📅">오늘 결석으로 기록된 {absentCount}명은 자동으로 빠져요. 이름을 누르면 다시 넣을 수 있어요.</Notice>
              : <Notice icon="📅">오늘 출석 기록이 아직 없어요. 모두 포함해요.</Notice>
          )}
          <div className="tbx-row tbx-row--wrap">
            <input className="tbx-input tbx-grow" style={{ maxWidth: 220 }} placeholder="이름 찾기" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="이름 찾기" />
            <button type="button" className="tbx-btn tbx-btn--sm" onClick={selectAll}>모두 고르기</button>
            <button type="button" className="tbx-btn tbx-btn--sm tbx-btn--ghost" onClick={clearStudents}>학생 모두 빼기</button>
            {teacher && (roster?.students ?? []).some((s) => s.is_test) && (
              <button type="button" className="tbx-btn tbx-btn--sm tbx-btn--ghost" aria-pressed={showTest} onClick={() => setShowTest(!showTest)}>
                {showTest ? '테스트 계정 숨기기' : '테스트 계정 보기'}
              </button>
            )}
          </div>
          {!roster ? <p className="tbx-small">명단을 불러오는 중…</p> : (
            <div className="tbx-names">
              {filtered.map((s) => {
                const absent = teacher && isAbsent(roster, s.id);
                const inGuild = viaGuild.has(s.id) && !selectedStudentIds.has(s.id);
                return (
                  <button key={s.id} type="button" className="tbx-name" aria-pressed={selectedStudentIds.has(s.id) || inGuild}
                    data-absent={absent} onClick={() => toggleStudent(s.id)} disabled={inGuild}
                    title={inGuild ? '길드 구성원으로 이미 들어 있어요' : undefined}>
                    {studentLabel(s, roster.students)}
                    {absent && <small>오늘 결석</small>}
                    {inGuild && <small>길드로 포함</small>}
                    {s.is_test && <small>테스트 계정</small>}
                  </button>
                );
              })}
              {filtered.length === 0 && <p className="tbx-small">찾는 이름이 없어요.</p>}
            </div>
          )}
        </div>
      )}

      {tab === 'guilds' && (
        <div className="tbx-guilds">
          {(roster?.guilds ?? []).map((g) => {
            const asUnit = value.some((x) => x.type === 'GUILD' && x.guild_id === g.id && x.as === 'UNIT');
            const asMembers = value.some((x) => x.type === 'GUILD' && x.guild_id === g.id && x.as === 'MEMBERS');
            return (
              <div key={g.id} className="tbx-guild">
                <div className="tbx-guild__name">
                  {g.logo_url ? <img src={g.logo_url} alt="" width={22} height={22} style={{ borderRadius: 6, objectFit: 'cover' }} /> : <span className="tbx-dot" style={{ background: 'var(--tbx-brass)' }} />}
                  <span className="tbx-grow">{g.name}</span>
                  <span className="tbx-small">{g.member_ids.length}명</span>
                </div>
                <div className="tbx-row tbx-row--wrap" style={{ gap: 6 }}>
                  {guildAsUnit && !studentsOnly && (
                    <button type="button" className="tbx-btn tbx-btn--sm" disabled={asUnit} onClick={() => addGuild(g.id, 'UNIT')}
                      title="길드 하나를 참가자 한 칸으로 넣어요">{asUnit ? '길드로 넣음' : '길드로 넣기'}</button>
                  )}
                  {guildAsMembers && (
                    <button type="button" className="tbx-btn tbx-btn--sm" disabled={asMembers || g.member_ids.length === 0}
                      onClick={() => addGuild(g.id, 'MEMBERS')} title={g.member_ids.length === 0 ? '구성원이 없는 길드예요' : '길드원 한 명 한 명을 참가자로 넣어요'}>
                      {g.member_ids.length === 0 ? '구성원 없음' : asMembers ? '구성원 넣음' : '구성원 넣기'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          {roster && roster.guilds.length === 0 && <p className="tbx-small">등록된 길드가 없어요.</p>}
        </div>
      )}

      {tab === 'manual' && (
        <div className="tbx-stack">
          <textarea className="tbx-textarea" placeholder={'한 줄에 하나씩, 또는 쉼표로 구분해 적어요\n예: 1모둠, 2모둠, 3모둠'} value={manualText}
            onChange={(e) => setManualText(e.target.value)} aria-label="직접 입력" />
          {manualPreview.length > 0 && (
            <div className="tbx-selected" aria-label="추가될 항목">
              {manualPreview.map((l, i) => <span key={i} className="tbx-token" style={{ paddingRight: 10 }}>{l}</span>)}
            </div>
          )}
          <div className="tbx-row">
            <button type="button" className="tbx-btn tbx-btn--brass tbx-btn--sm" disabled={manualPreview.length === 0} onClick={() => addManual(manualPreview)}>
              {manualPreview.length > 0 ? `${manualPreview.length}개 넣기` : '넣기'}
            </button>
            <span className="tbx-small">직접 넣은 이름은 학생 계정과 연결되지 않아요.</span>
          </div>
        </div>
      )}

      {tab === 'saved' && teacher && (
        <SavedRosters client={client} classroomId={classroomId} roster={roster} value={value} onLoad={onChange} />
      )}

      {value.length > 0 && (
        <div className="tbx-well tbx-stack tbx-stack--tight">
          <div className="tbx-row tbx-row--between">
            <span className="tbx-h3">고른 참가자</span>
            <span className="tbx-row" style={{ gap: 4 }}>
              <button type="button" className="tbx-btn tbx-btn--ghost tbx-btn--sm" aria-pressed={reorder} onClick={() => setReorder(!reorder)}>{reorder ? '순서 정하기 끝' : '순서 바꾸기'}</button>
              <button type="button" className="tbx-btn tbx-btn--ghost tbx-btn--sm" onClick={() => onChange([])}>모두 빼기</button>
            </span>
          </div>
          {mixedKinds(units) && <Notice icon="ℹ️">학생 개인과 길드·팀이 함께 들어 있어요. 참가 단위가 섞인 상태로 진행돼요.</Notice>}
          <div className="tbx-selected">
            {value.map((item, i) => (
              <span key={tokenKey(item, i)} className="tbx-token">
                <span className="tbx-token__kind">{KIND_TEXT[item.type === 'GUILD' ? (item.as === 'UNIT' ? 'GUILD' : 'MEMBERS') : item.type]}</span>
                {item.label}
                {item.type === 'GUILD' && item.as === 'MEMBERS' && <span className="tbx-small">({item.member_ids.length}명)</span>}
                {reorder && <>
                  <button type="button" onClick={() => move(i, -1)} aria-label={`${item.label} 앞으로`} disabled={i === 0}>‹</button>
                  <button type="button" onClick={() => move(i, 1)} aria-label={`${item.label} 뒤로`} disabled={i === value.length - 1}>›</button>
                </>}
                <button type="button" onClick={() => removeAt(i)} aria-label={`${item.label} 빼기`}>×</button>
              </span>
            ))}
          </div>
          {value.some((x) => x.type === 'GUILD' && x.as === 'MEMBERS') && (
            <GuildMemberTrim value={value} roster={roster} onChange={onChange} />
          )}
        </div>
      )}

      <Modal open={!!nameClash} onClose={() => setNameClash(null)} title="우리 반 학생과 이름이 같아요"
        footer={<>
          <button type="button" className="tbx-btn" onClick={() => nameClash && addManual(nameClash.labels, true)}>따로 넣기</button>
          <button type="button" className="tbx-btn tbx-btn--brass" onClick={resolveClashAsStudents}>학생 계정으로 넣기</button>
        </>}>
        <p className="tbx-body" style={{ color: 'var(--tbx-ivory)' }}>
          {nameClash?.clashes.join(', ')} — 학생 계정으로 넣으면 버저·투표처럼 본인 참여가 필요한 도구에서도 쓸 수 있어요.
          따로 넣으면 이름만 같은 별개 항목이 돼요.
        </p>
      </Modal>
    </div>
  );
}

const KIND_TEXT: Record<string, string> = { STUDENT: '학생', GUILD: '길드', MEMBERS: '길드원', TEAM: '팀', MANUAL: '입력' };

function tokenKey(item: RosterItem, i: number) {
  switch (item.type) {
    case 'STUDENT': return `s${item.student_id}`;
    case 'GUILD': return `g${item.guild_id}${item.as}`;
    case 'TEAM': return `t${item.key}`;
    default: return `m${item.id}${i}`;
  }
}

/** 길드 구성원으로 넣은 경우 일부 학생만 뺄 수 있다. */
function GuildMemberTrim({ value, roster, onChange }: { value: RosterItem[]; roster: ClassRoster | null; onChange: (v: RosterItem[]) => void }) {
  const [open, setOpen] = useState(false);
  const all = roster?.students ?? [];
  return (
    <div>
      <button type="button" className="tbx-btn tbx-btn--ghost tbx-btn--sm" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? '길드원 고르기 닫기' : '길드원 일부만 빼기'}
      </button>
      {open && value.map((item, i) => {
        if (item.type !== 'GUILD' || item.as !== 'MEMBERS') return null;
        const g = roster?.guilds.find((x) => x.id === item.guild_id);
        const ids = g?.member_ids ?? item.member_ids;
        return (
          <div key={i} style={{ marginTop: 10 }}>
            <div className="tbx-small" style={{ fontWeight: 800, marginBottom: 6 }}>{item.label}</div>
            <div className="tbx-names">
              {ids.map((id) => {
                const s = all.find((x) => x.id === id);
                const on = item.member_ids.includes(id);
                return (
                  <button key={id} type="button" className="tbx-name" aria-pressed={on} data-absent={isAbsent(roster, id)}
                    onClick={() => {
                      const next = value.slice();
                      next[i] = { ...item, member_ids: on ? item.member_ids.filter((x) => x !== id) : [...item.member_ids, id] };
                      onChange(next);
                    }}>
                    {s ? studentLabel(s, all) : `학생 ${id}`}
                    {isAbsent(roster, id) && <small>오늘 결석</small>}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SavedRosters({ client, classroomId, roster, value, onLoad }: {
  client: SupabaseClient; classroomId: number | null; roster: ClassRoster | null; value: RosterItem[]; onLoad: (v: RosterItem[]) => void;
}) {
  const [rows, setRows] = useState<RosterRow[] | null>(null);
  const [name, setName] = useState('');
  const [pending, setPending] = useState<RosterRow | null>(null);
  const { run, busy } = useAction();
  const reload = () => { if (classroomId) void toolboxRpc.listRosters(client, classroomId).then(setRows).catch(() => setRows([])); };
  useEffect(reload, [classroomId]); // eslint-disable-line react-hooks/exhaustive-deps

  const studentIds = new Set((roster?.students ?? []).map((s) => s.id));
  const inspect = (row: RosterRow) => {
    const missing = row.items.filter((x) => x.type === 'STUDENT' && !studentIds.has(x.student_id)).length;
    const changedGuilds = row.items.filter((x) => {
      if (x.type !== 'GUILD') return false;
      const g = roster?.guilds.find((y) => y.id === x.guild_id);
      if (!g) return true;
      const now = [...g.member_ids].sort().join(',');
      return now !== [...x.member_ids].sort().join(',');
    });
    return { missing, changedGuilds };
  };

  const load = (row: RosterRow, guildMode: 'NOW' | 'THEN') => {
    const items: RosterItem[] = [];
    for (const x of row.items) {
      if (x.type === 'STUDENT') { if (studentIds.has(x.student_id)) items.push(x); continue; }
      if (x.type === 'GUILD') {
        const g = roster?.guilds.find((y) => y.id === x.guild_id);
        if (!g) continue;
        const ids = guildMode === 'NOW' ? g.member_ids : x.member_ids.filter((id) => studentIds.has(id));
        items.push({ ...x, label: g.name, member_ids: ids });
        continue;
      }
      if (x.type === 'TEAM') { items.push({ ...x, member_ids: x.member_ids.filter((id) => studentIds.has(id)) }); continue; }
      items.push(x);
    }
    onLoad(items);
    setPending(null);
  };

  return (
    <div className="tbx-stack">
      <div className="tbx-row tbx-row--wrap">
        <input className="tbx-input tbx-grow" style={{ maxWidth: 260 }} placeholder="지금 명단 이름 (예: 3모둠 발표)" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
        <button type="button" className="tbx-btn tbx-btn--sm tbx-btn--brass" disabled={!name.trim() || value.length === 0 || busy !== null}
          onClick={async () => { const r = await run('save', () => toolboxRpc.saveRoster(client, name.trim(), value, false), '명단을 저장했어요'); if (r) { setName(''); reload(); } }}>
          지금 명단 저장
        </button>
      </div>
      {!rows ? <p className="tbx-small">불러오는 중…</p> : rows.length === 0 ? <p className="tbx-small">저장한 명단이 없어요. 활동을 시작하면 최근 명단이 자동으로 남아요.</p> : (
        <div className="tbx-list">
          {rows.map((row) => {
            const info = inspect(row);
            return (
              <div key={row.id} className="tbx-list__row">
                <span className={row.is_recent ? 'tbx-chip' : 'tbx-chip tbx-chip--brass'}>{row.is_recent ? '최근' : '저장'}</span>
                <span className="tbx-grow">
                  <span className="tbx-h3" style={{ display: 'block' }}>{row.name}</span>
                  <span className="tbx-small">{row.items.length}개 항목{info.missing ? ` · 지금 없는 학생 ${info.missing}명은 빠져요` : ''}</span>
                </span>
                <button type="button" className="tbx-btn tbx-btn--sm" onClick={() => (info.changedGuilds.length ? setPending(row) : load(row, 'NOW'))}>불러오기</button>
                {!row.is_recent && (
                  <button type="button" className="tbx-btn tbx-btn--sm tbx-btn--ghost" aria-label={`${row.name} 삭제`}
                    onClick={async () => { await run('del', () => toolboxRpc.deleteRoster(client, row.id), '명단을 지웠어요'); reload(); }}>지우기</button>
                )}
              </div>
            );
          })}
        </div>
      )}
      <Modal open={!!pending} onClose={() => setPending(null)} title="길드 구성원이 바뀌었어요"
        footer={<>
          <button type="button" className="tbx-btn" onClick={() => pending && load(pending, 'THEN')}>저장 당시 구성원</button>
          <button type="button" className="tbx-btn tbx-btn--brass" onClick={() => pending && load(pending, 'NOW')}>지금 구성원</button>
        </>}>
        <p className="tbx-body" style={{ color: 'var(--tbx-ivory)' }}>
          {pending && inspect(pending).changedGuilds.map((g) => g.label).join(', ')}의 구성원이 명단을 저장한 뒤 달라졌어요. 어느 쪽으로 불러올까요?
        </p>
      </Modal>
    </div>
  );
}

/** 참가자 요약 한 줄 (준비가 끝난 뒤 접힌 상태) */
export function PickerSummary({ units, onEdit }: { units: Unit[]; onEdit: () => void }) {
  return (
    <div className="tbx-row tbx-row--between">
      <span className="tbx-small" style={{ color: 'var(--tbx-ivory)' }}>
        참가 {units.length}{units.some((u) => u.type !== 'STUDENT') ? '항목' : '명'} — {units.slice(0, 6).map((u) => u.label).join(', ')}{units.length > 6 ? ' 외' : ''}
      </span>
      <button type="button" className="tbx-btn tbx-btn--sm" onClick={onEdit}>참가자 바꾸기</button>
    </div>
  );
}

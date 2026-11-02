import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { PageHeader, LoadingSpinner } from '@/components/shared/components';
import { supabase } from '@/lib/supabase/client';
import { useClassroomId, useStudentId } from '@/stores/auth_store';
import {
  getPrimaryJobArchive, type PrimaryJobArchiveEntry,
} from '@/lib/rpc/primary_job_archive_rpc';
import {
  ARCHIVE_MONTHS, ROLE_BACKGROUND, archiveDefaultMonth, archiveMonthEmptyLabel,
  archiveStudentKey, archiveWageDelta, archiveWageLabel, archivePendingLabel, type ArchiveView,
} from './primary_job_archive_model';
import './primary_job_archive.css';

const VIEWS: { key: ArchiveView; label: string }[] = [
  { key: 'month', label: '월별 담당표' },
  { key: 'role', label: '역할별 이력' },
  { key: 'student', label: '학생별 이력' },
];

export default function PrimaryJobArchivePage() {
  const classroomId = useClassroomId();
  const studentId = useStudentId();
  const navigate = useNavigate();
  const [view, setView] = useState<ArchiveView>('month');
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);
  const [selectedRole, setSelectedRole] = useState<string | null>(null);
  const [selectedStudent, setSelectedStudent] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'name' | 'wage'>('name');
  const query = useQuery({
    queryKey: ['primary-job-archive', classroomId, studentId],
    queryFn: () => getPrimaryJobArchive(supabase),
    enabled: Boolean(classroomId),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: true,
    retry: 1,
  });
  const archive = query.data;
  const roleOptions = useMemo(() => {
    const roles = new Map<string, string>();
    archive?.entries.forEach((entry) => roles.set(entry.job_key, entry.job_name));
    return [...roles].map(([key, name]) => ({ key, name })).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  }, [archive]);
  const studentOptions = useMemo(() => {
    const students = new Map<string, { name: string; historical: boolean }>();
    archive?.entries.forEach((entry) => {
      const key = archiveStudentKey(entry);
      if (key && entry.student_name) students.set(key, { name: entry.student_name, historical: entry.student_id === null });
    });
    return [...students].map(([key, value]) => ({ key, ...value })).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  }, [archive]);

  if (!classroomId) return <><PageHeader title="1인1역 기록실" /><div className="pja-page"><p>학급 정보를 확인하지 못했습니다. 홈에서 다시 접속해 주세요.</p></div></>;
  if (query.isLoading) return <><PageHeader title="1인1역 기록실" /><div className="pja-loading"><LoadingSpinner /><span>1인1역 기록을 불러오는 중입니다.</span></div></>;
  if (!archive || query.isError) return <><PageHeader title="1인1역 기록실" /><div className="pja-page" role="alert"><p>{query.error instanceof Error ? query.error.message : '1인1역 기록을 불러오지 못했습니다.'}</p><button type="button" className="pja-action" onClick={() => void query.refetch()}>다시 불러오기</button></div></>;

  const month = selectedMonth ?? archiveDefaultMonth(archive);
  const monthInfo = archive.months.find((m) => m.month === month);
  const roleKey = selectedRole ?? roleOptions[0]?.key ?? '';
  const myKey = studentId === null ? null : `student:${studentId}`;
  const studentKey = selectedStudent ?? (studentOptions.some((s) => s.key === myKey) ? myKey : studentOptions[0]?.key) ?? '';
  const currentStudentOption = studentOptions.find((s) => s.key === studentKey);
  const myEntries = archive.entries.filter((e) => e.month === month && e.assignment_status === 'confirmed' && e.student_id === studentId && studentId !== null);
  const myWage = myEntries.length === 1 ? myEntries[0].daily_wage : null;
  const monthEntries = archive.entries.filter((e) => e.month === month);
  const needle = search.trim().toLocaleLowerCase('ko-KR');
  const shownEntries = monthEntries.filter((e) => `${e.job_name} ${e.student_name ?? ''}`.toLocaleLowerCase('ko-KR').includes(needle)).sort((a, b) => {
    if (sort === 'wage') return (b.daily_wage ?? -1) - (a.daily_wage ?? -1) || a.job_name.localeCompare(b.job_name, 'ko');
    return a.job_name.localeCompare(b.job_name, 'ko', { numeric: true });
  });
  const confirmedPeople = new Set(monthEntries.filter((e) => e.assignment_status === 'confirmed').map(archiveStudentKey));
  const background = ROLE_BACKGROUND[roleKey];
  const roleName = roleOptions.find((r) => r.key === roleKey)?.name ?? '';
  const openRole = (key: string) => { setSelectedRole(key); setView('role'); };
  const openStudent = (key: string) => { setSelectedStudent(key); setView('student'); };
  const wageCell = (wage: number | null) => wage === null ? <span className="pja-unregistered">미등록</span> : wage.toLocaleString('ko-KR');
  const person = (entry: PrimaryJobArchiveEntry) => {
    const key = archiveStudentKey(entry);
    if (!key) return <span className="pja-pending">{archivePendingLabel(archive, entry.month)}</span>;
    return <span className="pja-person-wrap"><button type="button" className="pja-person" onClick={() => openStudent(key)}>{entry.student_name}</button>{entry.student_id === studentId ? <span className="pja-me">나</span> : entry.student_id === null ? <span className="pja-historical">과거 명단</span> : null}</span>;
  };

  return <>
    <PageHeader title="1인1역 기록실" onBack={() => navigate('/home')} />
    <div className="pja-page">
      <div className="pja-year-row"><span>{archive.school_year}학년도 · 3월–11월</span><button type="button" className="pja-text-button" disabled={query.isFetching} onClick={() => void query.refetch()}>{query.isFetching ? '불러오는 중' : '새로고침'}</button></div>
      {studentId !== null && <div className="pja-mine">
        <span className="pja-mine-label">{month}월의 나</span>
        <span className="pja-mine-role">{myEntries.length ? myEntries.map((e) => e.job_name).join(' · ') : archiveMonthEmptyLabel(archive, month)}</span>
        {myEntries.length > 0 && <strong className="pja-wage">{myEntries.length > 1 ? '역할별 일급 확인' : archiveWageLabel(myWage)}</strong>}
        <button type="button" className="pja-text-button" onClick={() => openStudent(`student:${studentId}`)}>나의 이력 ›</button>
      </div>}

      <div className="pja-tabs" role="tablist" aria-label="1인1역 기록 보기" onKeyDown={(event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const index = VIEWS.findIndex((v) => v.key === view);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (index + (event.key === 'ArrowRight' ? 1 : 2)) % 3;
        setView(VIEWS[next].key);
        event.currentTarget.querySelector<HTMLButtonElement>(`[data-view="${VIEWS[next].key}"]`)?.focus();
      }}>
        {VIEWS.map((tab) => <button type="button" key={tab.key} id={`pja-tab-${tab.key}`} data-view={tab.key} role="tab" aria-controls={`pja-panel-${tab.key}`} aria-selected={view === tab.key} onClick={() => setView(tab.key)}>{tab.label}</button>)}
      </div>

      <section id="pja-panel-month" role="tabpanel" aria-labelledby="pja-tab-month" hidden={view !== 'month'}>
        <div className="pja-months" aria-label="조회할 월">
          {ARCHIVE_MONTHS.map((m) => {
            const info = archive.months.find((item) => item.month === m);
            return <button type="button" key={m} aria-pressed={month === m} onClick={() => setSelectedMonth(m)}>{m}월{info?.status === 'record_lost' && <small>기록 분실</small>}{info?.status === 'partial' && <small>{archivePendingLabel(archive, m) === '담당자 배정 대기' ? '배정 대기' : '확인 중'}</small>}</button>;
          })}
        </div>
        {monthInfo?.note && <p className="pja-notice">{monthInfo.note}</p>}
        {monthInfo?.status === 'record_lost' || monthInfo?.status === 'unregistered' ? <div className="pja-empty"><strong>{archiveMonthEmptyLabel(archive, month)}</strong><p>{monthInfo.status === 'record_lost' ? `${month}월의 기록을 분실하여 담당 역할과 일급을 확인할 수 없습니다.` : `${month}월의 담당표는 아직 등록되지 않았습니다.`}</p></div> : <>
          <div className="pja-toolbar">
            <label className="pja-search"><span>역할·학생 찾기</span><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="역할 또는 학생 이름" /></label>
            <label><span>정렬</span><select value={sort} onChange={(e) => setSort(e.target.value as 'name' | 'wage')}><option value="name">역할명순</option><option value="wage">일급 높은순</option></select></label>
          </div>
          <div className="pja-list-heading"><h2>{month}월 담당표</h2><span>역할 {monthEntries.length}개 · 확인된 학생 {confirmedPeople.size}명</span></div>
          <div className="pja-list">
            {shownEntries.map((entry) => <div className={`pja-entry${entry.student_id === studentId && studentId !== null ? ' pja-entry-mine' : ''}`} key={entry.job_key}>
              <button type="button" className="pja-role" onClick={() => openRole(entry.job_key)}>{entry.job_name}</button>
              <strong className="pja-wage">{archiveWageLabel(entry.daily_wage)}</strong>
              <div className="pja-people">{person(entry)}</div>
              <span className="pja-delta">{entry.daily_wage !== null ? archiveWageDelta(entry, archive) : ''}</span>
            </div>)}
            {!shownEntries.length && <div className="pja-empty">일치하는 역할이나 학생이 없습니다.</div>}
          </div>
          <p className="pja-footnote">일급은 담당 학생 1인 기준의 기본 일급입니다. 증감은 같은 역할의 전월 대비입니다.</p>
        </>}
      </section>

      <section id="pja-panel-role" role="tabpanel" aria-labelledby="pja-tab-role" hidden={view !== 'role'}>
        <div className="pja-history-heading"><label><span>역할</span><select value={roleKey} onChange={(e) => setSelectedRole(e.target.value)}>{roleOptions.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}</select></label><span>당시 일급과 담당자</span></div>
        {background && <div className="pja-role-background"><p>{background.description}</p><div className="pja-related">{background.related.filter((key) => roleOptions.some((r) => r.key === key)).map((key) => <button type="button" key={key} className="pja-text-button" onClick={() => openRole(key)}>{roleOptions.find((r) => r.key === key)?.name} 기록 ›</button>)}</div></div>}
        {!roleOptions.length ? <div className="pja-empty">등록된 역할 기록이 없습니다.</div> : <table className="pja-history pja-role-history">
          <caption className="pja-sr-only">{roleName}의 월별 일급과 담당자</caption>
          <thead><tr><th scope="col">월</th><th scope="col" className="pja-number">일급 G</th><th scope="col" className="pja-comparison">전월비</th><th scope="col">담당 학생</th></tr></thead>
          <tbody>{ARCHIVE_MONTHS.map((m) => {
            const entry = archive.entries.find((e) => e.month === m && e.job_key === roleKey);
            const emptyLabel = archiveMonthEmptyLabel(archive, m);
            return <tr key={m} className={m === month ? 'pja-selected-month' : ''}><th scope="row">{m}월</th>{entry ? <><td className="pja-number pja-wage">{wageCell(entry.daily_wage)}</td><td className="pja-comparison">{archiveWageDelta(entry, archive)}</td><td>{person(entry)}</td></> : <td colSpan={3} className={emptyLabel === '기록 분실' ? 'pja-lost' : ''}>{emptyLabel}</td>}</tr>;
          })}</tbody>
        </table>}
        <p className="pja-footnote">확인되지 않은 과거 금액은 미등록으로 표시합니다. 역할이 통합되기 전의 일급은 별도 기록으로 보존합니다.</p>
      </section>

      <section id="pja-panel-student" role="tabpanel" aria-labelledby="pja-tab-student" hidden={view !== 'student'}>
        <div className="pja-history-heading"><label><span>학생</span><select value={studentKey} onChange={(e) => setSelectedStudent(e.target.value)}>{!studentOptions.some((s) => s.key === studentKey) && <option value={studentKey}>나의 기록</option>}{studentOptions.map((s) => <option key={s.key} value={s.key}>{s.name}{s.key === myKey ? ' (나)' : s.historical ? ' · 과거 명단' : ''}</option>)}</select></label><span>맡았던 역할과 당시 일급</span></div>
        <table className="pja-history pja-student-history">
          <caption className="pja-sr-only">{currentStudentOption?.name ?? '나'}의 월별 1인1역 이력</caption>
          <thead><tr><th scope="col">월</th><th scope="col" className="pja-student-role">맡았던 역할</th><th scope="col" className="pja-number">일급 G</th></tr></thead>
          <tbody>{ARCHIVE_MONTHS.map((m) => {
            const entries = archive.entries.filter((e) => e.month === m && archiveStudentKey(e) === studentKey);
            const emptyLabel = archiveMonthEmptyLabel(archive, m);
            if (!entries.length) return <tr key={m} className={m === month ? 'pja-selected-month' : ''}><th scope="row">{m}월</th><td colSpan={2} className={emptyLabel === '기록 분실' ? 'pja-lost' : ''}>{emptyLabel}</td></tr>;
            return entries.map((entry, index) => <tr key={`${m}:${entry.job_key}`} className={m === month ? 'pja-selected-month' : ''}>{index === 0 && <th scope="row" rowSpan={entries.length}>{m}월</th>}<td className="pja-student-role"><button type="button" className="pja-role" onClick={() => openRole(entry.job_key)}>{entry.job_name}</button></td><td className="pja-number pja-wage">{wageCell(entry.daily_wage)}</td></tr>);
          })}</tbody>
        </table>
        <p className="pja-footnote">기록 분실·담당자 확인 중·기록 미등록을 구분해 표시합니다.</p>
      </section>
      <div className="pja-sr-only" aria-live="polite">{VIEWS.find((v) => v.key === view)?.label} · {month}월</div>
    </div>
  </>;
}

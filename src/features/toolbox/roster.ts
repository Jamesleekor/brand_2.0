// =====================================================================
// 모험가 도구함 — 학급 명단 읽기 (읽기 전용)
// ---------------------------------------------------------------------
// 학생·길드·길드원·오늘 출석은 기존 표에서 읽기만 한다. 바꾸지 않는다.
// 출석은 '출석·과제 운영(F4C · 4.1)'에 입력된 오늘 기록을 참조한다.
// =====================================================================

import { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getKstDateString } from '@/lib/utils/format';
import { colorAt } from './ui';
import type { RosterItem, Unit } from './toolbox_types';

export interface RosterStudent {
  id: number;
  name: string;
  brand_name: string | null;
  is_test: boolean;
}

export interface RosterGuild {
  id: number;
  name: string;
  logo_url: string | null;
  member_ids: number[];
}

export type AttendanceMark = 'PRESENT' | 'LATE' | 'ABSENT' | 'EXCUSED';

export interface ClassRoster {
  students: RosterStudent[];
  guilds: RosterGuild[];
  /** 오늘 출석 기록. 교사 화면에서만 채워진다. */
  attendance: Record<number, AttendanceMark> | null;
  attendanceDate: string;
}

const cache = new Map<string, { at: number; value: ClassRoster }>();
const STUDENT_ROLES = ['STUDENT', 'STUDENT_LEADER', 'GUARD', 'TEST'];

export async function loadClassRoster(client: SupabaseClient, classroomId: number, withAttendance: boolean): Promise<ClassRoster> {
  const key = `${classroomId}:${withAttendance ? 'a' : 'n'}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 60_000) return hit.value;
  const today = getKstDateString();

  const [s, g] = await Promise.all([
    client.from('students').select('id,name,brand_name,role,is_test_account')
      .eq('classroom_id', classroomId).is('transferred_at', null).order('name'),
    client.from('guilds').select('id,name,logo_url,is_active').eq('classroom_id', classroomId).order('id'),
  ]);
  if (s.error) throw s.error;
  if (g.error) throw g.error;
  const guildRows = (g.data ?? []).filter((x: any) => x.is_active !== false);
  const guildIds = guildRows.map((x: any) => x.id as number);

  const [m, a] = await Promise.all([
    guildIds.length
      ? client.from('guild_members').select('guild_id,student_id').in('guild_id', guildIds).is('left_at', null)
      : Promise.resolve({ data: [], error: null } as any),
    withAttendance
      ? client.from('attendances').select('student_id,status').eq('classroom_id', classroomId).eq('attendance_date', today)
      : Promise.resolve({ data: null, error: null } as any),
  ]);
  if (m.error) throw m.error;
  if (a.error) throw a.error;

  const students: RosterStudent[] = (s.data ?? [])
    .filter((x: any) => STUDENT_ROLES.includes(String(x.role)))
    .map((x: any) => ({ id: x.id, name: x.name, brand_name: x.brand_name ?? null, is_test: x.is_test_account === true }));
  const studentIds = new Set(students.map((x) => x.id));
  const guilds: RosterGuild[] = guildRows.map((x: any) => ({
    id: x.id, name: x.name, logo_url: x.logo_url ?? null,
    member_ids: (m.data ?? []).filter((r: any) => r.guild_id === x.id && studentIds.has(r.student_id)).map((r: any) => r.student_id as number),
  }));
  let attendance: Record<number, AttendanceMark> | null = null;
  if (withAttendance && a.data) {
    attendance = {};
    for (const row of a.data as any[]) attendance[row.student_id] = row.status as AttendanceMark;
  }
  const value = { students, guilds, attendance, attendanceDate: today };
  cache.set(key, { at: Date.now(), value });
  return value;
}

export function useClassRoster(client: SupabaseClient, classroomId: number | null | undefined, withAttendance: boolean) {
  const [roster, setRoster] = useState<ClassRoster | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (!classroomId) return;
    let alive = true;
    loadClassRoster(client, classroomId, withAttendance)
      .then((r) => { if (alive) { setRoster(r); setError(null); } })
      .catch((e) => { if (alive) setError(e); });
    return () => { alive = false; };
  }, [client, classroomId, withAttendance]);
  return { roster, error };
}

/** 같은 이름이 둘 이상인 학생은 브랜드명을 붙여 구분한다. */
export function studentLabel(student: RosterStudent, all: RosterStudent[]): string {
  const dup = all.filter((x) => x.name === student.name).length > 1;
  if (!dup) return student.name;
  return student.brand_name ? `${student.name}(${student.brand_name})` : `${student.name}#${student.id}`;
}

export function isAbsent(roster: ClassRoster | null, studentId: number): boolean {
  return roster?.attendance?.[studentId] === 'ABSENT';
}

/**
 * 선택 항목 → 실제 참가 단위.
 * - 같은 학생은 경로가 달라도 한 번만 들어간다(학생 단위 기준).
 * - 직접 입력 항목은 학생·길드와 합치지 않는다.
 */
export function buildUnits(items: RosterItem[], roster: ClassRoster | null): Unit[] {
  const units: Unit[] = [];
  const seenStudents = new Set<number>();
  const seenKeys = new Set<string>();
  const students = roster?.students ?? [];
  const nameOf = (id: number) => {
    const s = students.find((x) => x.id === id);
    return s ? studentLabel(s, students) : `학생 ${id}`;
  };
  let colorIndex = 0;
  const push = (u: Unit) => { if (!seenKeys.has(u.key)) { seenKeys.add(u.key); units.push(u); } };

  for (const item of items) {
    if (item.type === 'STUDENT') {
      if (seenStudents.has(item.student_id)) continue;
      seenStudents.add(item.student_id);
      push({ key: `s${item.student_id}`, type: 'STUDENT', label: nameOf(item.student_id), student_id: item.student_id });
    } else if (item.type === 'GUILD' && item.as === 'MEMBERS') {
      for (const id of item.member_ids) {
        if (seenStudents.has(id)) continue;
        seenStudents.add(id);
        push({ key: `s${id}`, type: 'STUDENT', label: nameOf(id), student_id: id });
      }
    } else if (item.type === 'GUILD') {
      push({
        key: `g${item.guild_id}`, type: 'GUILD', label: item.label, guild_id: item.guild_id,
        color: item.color ?? colorAt(colorIndex++),
        members: item.member_ids.map((id) => ({ student_id: id, label: nameOf(id) })),
      });
    } else if (item.type === 'TEAM') {
      push({
        key: `t${item.key}`, type: 'TEAM', label: item.label, color: item.color ?? colorAt(colorIndex++),
        members: item.member_ids.map((id) => ({ student_id: id, label: nameOf(id) })),
      });
    } else {
      push({ key: `m${item.id}`, type: 'MANUAL', label: item.label });
    }
  }
  // 이름이 같은 직접 입력 항목은 구분 표시를 붙인다.
  const counts = new Map<string, number>();
  for (const u of units) counts.set(u.label, (counts.get(u.label) ?? 0) + 1);
  const seq = new Map<string, number>();
  for (const u of units) {
    if (u.type === 'MANUAL' && (counts.get(u.label) ?? 0) > 1) {
      const n = (seq.get(u.label) ?? 0) + 1;
      seq.set(u.label, n);
      u.label = `${u.label} ${String.fromCharCode(64 + Math.min(n, 26))}`;
    }
  }
  return units;
}

/** 여러 종류가 섞였는지 (학생과 길드 단위를 함께 쓰는 경우 안내) */
export function mixedKinds(units: Unit[]): boolean {
  const individual = units.some((u) => u.type === 'STUDENT');
  const group = units.some((u) => u.type === 'GUILD' || u.type === 'TEAM');
  return individual && group;
}

export function parseManualInput(text: string): string[] {
  return text.split(/[\n,]/).map((x) => x.trim()).filter((x) => x.length > 0).map((x) => x.slice(0, 40));
}

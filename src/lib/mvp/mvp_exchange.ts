import type {
  MvpFoundationBoard,
  MvpFoundationGrade,
  MvpFoundationInputState,
  MvpFoundationStudentRow,
} from '@/lib/rpc/mvp_foundation_rpc';

export const MVP_EXCHANGE_FORMAT_VERSION = 'BRAND_MVP_EXCHANGE_V1';

export type MvpExchangeFormat = 'xlsx' | 'tsv';

export interface MvpExchangeMetadata {
  format_version: typeof MVP_EXCHANGE_FORMAT_VERSION;
  session_id: number;
  title: string;
  evaluation_start_date: string;
  evaluation_end_date: string;
  comparison_start_date: string;
  comparison_end_date: string;
  status: 'DRAFT' | 'FINALIZED';
  exported_at: string;
}

export interface MvpExchangeInputRow extends MvpFoundationInputState {
  student_id: number;
  student_name: string;
}

export interface MvpExchangePayload {
  metadata: MvpExchangeMetadata;
  rows: MvpExchangeInputRow[];
}

export interface MvpImportPreviewRow {
  student_id: number;
  student_name: string;
  changed_fields: string[];
  has_changes: boolean;
  next: MvpExchangeInputRow;
}

export interface MvpImportPreview {
  file_name: string;
  format: MvpExchangeFormat;
  valid: boolean;
  errors: string[];
  changed_count: number;
  unchanged_count: number;
  candidate_count: number;
  rows: MvpImportPreviewRow[];
  payload: MvpExchangePayload | null;
}

const EDITABLE_HEADERS = [
  '학생ID',
  '학생명',
  '예선후보',
  '수업준비와 책임',
  '참여와 경청',
  '과제 수행',
  '개선과 성장',
  '비고',
] as const;

const MAIN_HEADERS = [
  '학생ID',
  '학생명',
  '브랜드명',
  '길드',
  '평가기간 획득 BV',
  '평가기간 차감 BV',
  '평가기간 순증 BV',
  '비교기간 획득 BV',
  'BV 성장률(%)',
  '일일퀘 완수일',
  '일일퀘 대상일',
  '일일퀘 완수율(%)',
  '업적 수',
  '업적 점수',
  '길드 점수',
  '개인 기여도',
  '기부 GOLD',
  '서비스 판매',
  '예선후보',
  '수업준비와 책임',
  '참여와 경청',
  '과제 수행',
  '개선과 성장',
  '비고',
] as const;

const META_ROWS = [
  ['format_version', '파일 형식 버전'],
  ['session_id', 'MVP 회차 ID'],
  ['title', '회차명'],
  ['evaluation_start_date', '평가 시작일'],
  ['evaluation_end_date', '평가 종료일'],
  ['comparison_start_date', '비교 시작일'],
  ['comparison_end_date', '비교 종료일'],
  ['status', '회차 상태'],
  ['exported_at', '내보낸 시각'],
] as const;

const GRADE_SET = new Set<MvpFoundationGrade>(['S+', 'S', 'A+', 'A', 'B']);

function currentIso(): string {
  return new Date().toISOString();
}

function safeFilename(value: string): string {
  const normalized = value.trim().replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ');
  return normalized.slice(0, 80) || 'MVP';
}

function numberOrBlank(value: number | null): number | '' {
  return value == null || !Number.isFinite(value) ? '' : value;
}

function inputRowFromStudent(row: MvpFoundationStudentRow): MvpExchangeInputRow {
  return {
    student_id: row.student_id,
    student_name: row.student_name,
    is_preliminary_candidate: row.is_preliminary_candidate,
    preparation_responsibility_grade: row.preparation_responsibility_grade,
    participation_listening_grade: row.participation_listening_grade,
    assignment_performance_grade: row.assignment_performance_grade,
    improvement_growth_grade: row.improvement_growth_grade,
    notes: row.notes,
  };
}

export function buildMvpExchangePayload(board: MvpFoundationBoard): MvpExchangePayload {
  const session = board.session;
  return {
    metadata: {
      format_version: MVP_EXCHANGE_FORMAT_VERSION,
      session_id: session.id,
      title: session.title,
      evaluation_start_date: session.evaluation_start_date,
      evaluation_end_date: session.evaluation_end_date,
      comparison_start_date: session.comparison_start_date,
      comparison_end_date: session.comparison_end_date,
      status: session.status,
      exported_at: currentIso(),
    },
    rows: board.students.map(inputRowFromStudent),
  };
}

function mainRow(row: MvpFoundationStudentRow): Array<string | number> {
  return [
    row.student_id,
    row.student_name,
    row.brand_name ?? '',
    row.guild_name ?? '',
    row.evaluation_bv_earned,
    row.evaluation_bv_deducted,
    row.evaluation_bv_net,
    row.comparison_bv_earned,
    numberOrBlank(row.bv_growth_rate),
    row.daily_quest_completed_days,
    row.daily_quest_target_days,
    numberOrBlank(row.daily_quest_completion_rate),
    row.achievement_count,
    row.achievement_score,
    row.guild_score,
    row.personal_contribution_score,
    row.donation_gold,
    row.secondary_job_sales_completed,
    row.is_preliminary_candidate ? 'Y' : 'N',
    row.preparation_responsibility_grade ?? '',
    row.participation_listening_grade ?? '',
    row.assignment_performance_grade ?? '',
    row.improvement_growth_grade ?? '',
    row.notes ?? '',
  ];
}

function editableRow(row: MvpFoundationStudentRow): Array<string | number> {
  return [
    row.student_id,
    row.student_name,
    row.is_preliminary_candidate ? 'Y' : 'N',
    row.preparation_responsibility_grade ?? '',
    row.participation_listening_grade ?? '',
    row.assignment_performance_grade ?? '',
    row.improvement_growth_grade ?? '',
    row.notes ?? '',
  ];
}

function tsvEscape(value: unknown): string {
  const text = value == null ? '' : String(value);
  if (!/[\t\r\n"]/u.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function toTsvLine(values: readonly unknown[]): string {
  return values.map(tsvEscape).join('\t');
}

function tsvContent(board: MvpFoundationBoard): string {
  const payload = buildMvpExchangePayload(board);
  const lines: string[] = [];
  for (const [key] of META_ROWS) {
    lines.push(`# ${key}\t${tsvEscape(payload.metadata[key])}`);
  }
  lines.push(toTsvLine(MAIN_HEADERS));
  for (const student of board.students) lines.push(toTsvLine(mainRow(student)));
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function downloadMvpExchange(board: MvpFoundationBoard, format: MvpExchangeFormat): Promise<void> {
  const base = safeFilename(board.session.title);
  if (format === 'tsv') {
    downloadBlob(new Blob([tsvContent(board)], { type: 'text/tab-separated-values;charset=utf-8' }), `${base}_MVP_기초데이터.tsv`);
    return;
  }
  downloadBlob(await buildXlsxBlob(board), `${base}_MVP_기초데이터.xlsx`);
}

function parseDelimited(text: string, delimiter = '\t'): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      if (field.endsWith('\r')) field = field.slice(0, -1);
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function parseBoolean(value: unknown): boolean | null {
  const normalized = String(value ?? '').trim().toLocaleLowerCase('ko-KR');
  if (['y', 'yes', 'true', '1', '예', 'o', '후보'].includes(normalized)) return true;
  if (['n', 'no', 'false', '0', '아니오', 'x', ''].includes(normalized)) return false;
  return null;
}

function parseGrade(value: unknown): MvpFoundationGrade | null | 'INVALID' {
  const normalized = String(value ?? '').trim().toUpperCase();
  if (!normalized) return null;
  return GRADE_SET.has(normalized as MvpFoundationGrade) ? (normalized as MvpFoundationGrade) : 'INVALID';
}

function normalizeNotes(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text ? text : null;
}

function mapRowsToObjects(rows: string[][]): Array<Record<string, string>> {
  const headerIndex = rows.findIndex((row) => row.some((cell) => cell.trim() === '학생ID'));
  if (headerIndex < 0) return [];
  const headers = rows[headerIndex].map((cell) => cell.trim());
  return rows.slice(headerIndex + 1)
    .filter((row) => row.some((cell) => cell.trim() !== ''))
    .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ''])));
}

function metadataFromTsvRows(rows: string[][]): Partial<MvpExchangeMetadata> {
  const result: Record<string, unknown> = {};
  for (const row of rows) {
    const first = String(row[0] ?? '');
    if (!first.startsWith('# ')) continue;
    const key = first.slice(2).trim();
    const value = row[1] ?? '';
    if (key === 'session_id') result[key] = Number(value);
    else result[key] = value;
  }
  return result as Partial<MvpExchangeMetadata>;
}

function payloadFromFlatRows(
  metadata: Partial<MvpExchangeMetadata>,
  rows: Array<Record<string, string>>,
): { payload: MvpExchangePayload | null; parseErrors: string[] } {
  const errors: string[] = [];
  const inputRows: MvpExchangeInputRow[] = [];

  rows.forEach((row, index) => {
    const studentId = Number(row['학생ID']);
    const studentName = String(row['학생명'] ?? '').trim();
    const candidate = parseBoolean(row['예선후보']);
    const preparation = parseGrade(row['수업준비와 책임']);
    const participation = parseGrade(row['참여와 경청']);
    const assignment = parseGrade(row['과제 수행']);
    const improvement = parseGrade(row['개선과 성장']);
    const notes = normalizeNotes(row['비고']);
    const line = index + 2;

    if (!Number.isInteger(studentId) || studentId <= 0) errors.push(`${line}행: 학생ID가 올바르지 않습니다.`);
    if (!studentName) errors.push(`${line}행: 학생명이 비어 있습니다.`);
    if (candidate == null) errors.push(`${line}행: 예선후보는 Y/N으로 입력해주세요.`);
    if (preparation === 'INVALID') errors.push(`${line}행: 수업준비와 책임 등급이 올바르지 않습니다.`);
    if (participation === 'INVALID') errors.push(`${line}행: 참여와 경청 등급이 올바르지 않습니다.`);
    if (assignment === 'INVALID') errors.push(`${line}행: 과제 수행 등급이 올바르지 않습니다.`);
    if (improvement === 'INVALID') errors.push(`${line}행: 개선과 성장 등급이 올바르지 않습니다.`);
    if (notes && notes.length > 2000) errors.push(`${line}행: 비고는 2,000자 이하로 입력해주세요.`);

    inputRows.push({
      student_id: studentId,
      student_name: studentName,
      is_preliminary_candidate: candidate ?? false,
      preparation_responsibility_grade: preparation === 'INVALID' ? null : preparation,
      participation_listening_grade: participation === 'INVALID' ? null : participation,
      assignment_performance_grade: assignment === 'INVALID' ? null : assignment,
      improvement_growth_grade: improvement === 'INVALID' ? null : improvement,
      notes,
    });
  });

  if (errors.length > 0) return { payload: null, parseErrors: errors };

  const meta = metadata as MvpExchangeMetadata;
  return {
    payload: {
      metadata: {
        format_version: String(meta.format_version ?? '') as typeof MVP_EXCHANGE_FORMAT_VERSION,
        session_id: Number(meta.session_id),
        title: String(meta.title ?? ''),
        evaluation_start_date: String(meta.evaluation_start_date ?? ''),
        evaluation_end_date: String(meta.evaluation_end_date ?? ''),
        comparison_start_date: String(meta.comparison_start_date ?? ''),
        comparison_end_date: String(meta.comparison_end_date ?? ''),
        status: meta.status === 'FINALIZED' ? 'FINALIZED' : 'DRAFT',
        exported_at: String(meta.exported_at ?? ''),
      },
      rows: inputRows,
    },
    parseErrors: [],
  };
}

function sameNullable(a: string | null, b: string | null): boolean {
  return (a ?? null) === (b ?? null);
}

function validatePayload(board: MvpFoundationBoard, payload: MvpExchangePayload | null, parseErrors: string[]): Omit<MvpImportPreview, 'file_name' | 'format'> {
  const errors = [...parseErrors];
  const previewRows: MvpImportPreviewRow[] = [];

  if (!payload) {
    return { valid: false, errors, changed_count: 0, unchanged_count: 0, candidate_count: 0, rows: [], payload: null };
  }

  const meta = payload.metadata;
  const session = board.session;
  if (meta.format_version !== MVP_EXCHANGE_FORMAT_VERSION) errors.push('지원하지 않는 파일 형식 버전입니다.');
  if (meta.session_id !== session.id) errors.push(`회차 ID가 다릅니다. 현재 ${session.id}, 파일 ${meta.session_id}.`);
  if (meta.title !== session.title) errors.push('회차명이 현재 회차와 다릅니다.');
  if (meta.evaluation_start_date !== session.evaluation_start_date || meta.evaluation_end_date !== session.evaluation_end_date) errors.push('평가기간이 현재 회차와 다릅니다.');
  if (meta.comparison_start_date !== session.comparison_start_date || meta.comparison_end_date !== session.comparison_end_date) errors.push('비교기간이 현재 회차와 다릅니다.');
  if (session.status !== 'DRAFT') errors.push('확정된 회차는 가져올 수 없습니다.');
  if (payload.rows.length !== board.students.length) errors.push(`학생 수가 다릅니다. 현재 ${board.students.length}명, 파일 ${payload.rows.length}명.`);

  const byId = new Map(board.students.map((student) => [student.student_id, student]));
  const seen = new Set<number>();

  for (const incoming of payload.rows) {
    if (seen.has(incoming.student_id)) errors.push(`${incoming.student_name || incoming.student_id}: 학생ID가 중복되었습니다.`);
    seen.add(incoming.student_id);
    const current = byId.get(incoming.student_id);
    if (!current) {
      errors.push(`학생ID ${incoming.student_id}는 현재 회차에 없는 학생입니다.`);
      continue;
    }
    if (incoming.student_name !== current.student_name) {
      errors.push(`학생ID ${incoming.student_id}: 이름이 '${incoming.student_name}'이지만 현재 학생은 '${current.student_name}'입니다.`);
      continue;
    }
    const grades = [
      incoming.preparation_responsibility_grade,
      incoming.participation_listening_grade,
      incoming.assignment_performance_grade,
      incoming.improvement_growth_grade,
    ];
    if (grades.some((grade) => grade != null && !GRADE_SET.has(grade))) errors.push(`${incoming.student_name}: 허용되지 않은 평가 등급이 있습니다.`);
    if ((incoming.notes ?? '').length > 2000) errors.push(`${incoming.student_name}: 비고는 2,000자 이하로 입력해주세요.`);

    const changed: string[] = [];
    if (incoming.is_preliminary_candidate !== current.is_preliminary_candidate) changed.push('예선후보');
    if (!sameNullable(incoming.preparation_responsibility_grade, current.preparation_responsibility_grade)) changed.push('수업준비와 책임');
    if (!sameNullable(incoming.participation_listening_grade, current.participation_listening_grade)) changed.push('참여와 경청');
    if (!sameNullable(incoming.assignment_performance_grade, current.assignment_performance_grade)) changed.push('과제 수행');
    if (!sameNullable(incoming.improvement_growth_grade, current.improvement_growth_grade)) changed.push('개선과 성장');
    if (!sameNullable(incoming.notes, current.notes)) changed.push('비고');

    previewRows.push({
      student_id: incoming.student_id,
      student_name: incoming.student_name,
      changed_fields: changed,
      has_changes: changed.length > 0,
      next: incoming,
    });
  }

  for (const student of board.students) {
    if (!seen.has(student.student_id)) errors.push(`${student.student_name}: 파일에서 누락되었습니다.`);
  }

  const candidateCount = payload.rows.filter((row) => row.is_preliminary_candidate).length;
  if (candidateCount > 12) errors.push(`예선 후보가 ${candidateCount}명입니다. 최대 12명까지 가능합니다.`);

  const changedCount = previewRows.filter((row) => row.has_changes).length;
  const unchangedCount = Math.max(0, payload.rows.length - changedCount);
  return {
    valid: errors.length === 0,
    errors,
    changed_count: changedCount,
    unchanged_count: unchangedCount,
    candidate_count: candidateCount,
    rows: previewRows,
    payload: errors.length === 0 ? payload : null,
  };
}

export async function parseMvpExchangeFile(file: File, board: MvpFoundationBoard): Promise<MvpImportPreview> {
  if (file.size > 8 * 1024 * 1024) throw new Error('가져오기 파일은 8MB 이하만 지원합니다.');
  const lower = file.name.toLocaleLowerCase('en-US');
  if (lower.endsWith('.tsv')) {
    const text = (await file.text()).replace(/^\uFEFF/u, '');
    const rows = parseDelimited(text, '\t');
    const metadata = metadataFromTsvRows(rows);
    const tableRows = mapRowsToObjects(rows);
    const parsed = payloadFromFlatRows(metadata, tableRows);
    return { file_name: file.name, format: 'tsv', ...validatePayload(board, parsed.payload, parsed.parseErrors) };
  }
  if (lower.endsWith('.xlsx')) {
    const { metadata, rows, errors } = await readXlsxExchange(file);
    const parsed = payloadFromFlatRows(metadata, rows);
    return { file_name: file.name, format: 'xlsx', ...validatePayload(board, parsed.payload, [...errors, ...parsed.parseErrors]) };
  }
  throw new Error('XLSX 또는 TSV 파일만 가져올 수 있습니다.');
}

function xmlEscape(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function columnName(index: number): string {
  let n = index + 1;
  let result = '';
  while (n > 0) {
    const remainder = (n - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
}

function cellXml(value: unknown, rowIndex: number, columnIndex: number, style = 0): string {
  const ref = `${columnName(columnIndex)}${rowIndex}`;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
  }
  const text = String(value ?? '');
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(text)}</t></is></c>`;
}

function rowXml(values: readonly unknown[], rowIndex: number, styleForColumn?: (columnIndex: number, value: unknown) => number): string {
  return `<row r="${rowIndex}">${values.map((value, columnIndex) => cellXml(value, rowIndex, columnIndex, styleForColumn?.(columnIndex, value) ?? 0)).join('')}</row>`;
}

function worksheetXml(
  rows: readonly (readonly unknown[])[],
  widths: readonly number[],
  options?: { freezeRow?: number; autoFilter?: boolean; editableColumnsFrom?: number },
): string {
  const cols = widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join('');
  const sheetRows = rows.map((row, index) => rowXml(row, index + 1, (columnIndex) => {
    if (index === 0) return 1;
    if (options?.editableColumnsFrom != null && columnIndex >= options.editableColumnsFrom) return 5;
    return 0;
  })).join('');
  const freeze = options?.freezeRow
    ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${options.freezeRow}" topLeftCell="A${options.freezeRow + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
    : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>';
  const filter = options?.autoFilter && rows.length > 0
    ? `<autoFilter ref="A1:${columnName(Math.max(0, rows[0].length - 1))}${rows.length}"/>`
    : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${freeze}<cols>${cols}</cols><sheetData>${sheetRows}</sheetData>${filter}</worksheet>`;
}

function sessionRows(metadata: MvpExchangeMetadata): Array<Array<string | number>> {
  return [
    ['항목', '값', '설명'],
    ...META_ROWS.map(([key, label]) => [key, metadata[key], label]),
    ['import_rule', '교사 입력 시트의 8개 열만 가져오기 대상', '자동 통계 열은 가져오기로 수정되지 않습니다.'],
    ['grade_rule', 'S+ / S / A+ / A / B 또는 빈칸', '등급 입력 규칙'],
    ['candidate_rule', 'Y / N', '예선 후보는 최대 12명'],
  ];
}

function stylesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="3">
    <font><sz val="11"/><name val="Aptos"/></font>
    <font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Aptos"/></font>
    <font><b/><color rgb="FF17365D"/><sz val="11"/><name val="Aptos"/></font>
  </fonts>
  <fills count="4">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF17365D"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFF2CC"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border><left style="thin"><color rgb="FFD9E2F3"/></left><right style="thin"><color rgb="FFD9E2F3"/></right><top style="thin"><color rgb="FFD9E2F3"/></top><bottom style="thin"><color rgb="FFD9E2F3"/></bottom><diagonal/></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="6">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
}

async function buildXlsxBlob(board: MvpFoundationBoard): Promise<Blob> {
  const payload = buildMvpExchangePayload(board);
  const mainRows: Array<Array<string | number>> = [Array.from(MAIN_HEADERS), ...board.students.map(mainRow)];
  const editRows: Array<Array<string | number>> = [Array.from(EDITABLE_HEADERS), ...board.students.map(editableRow)];
  const infoRows = sessionRows(payload.metadata);

  const files: ZipInput[] = [
    { name: '[Content_Types].xml', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>` },
    { name: '_rels/.rels', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>` },
    { name: 'docProps/core.xml', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlEscape(board.session.title)}</dc:title><dc:creator>B.R.A.N.D 운영국</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${payload.metadata.exported_at}</dcterms:created></cp:coreProperties>` },
    { name: 'docProps/app.xml', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>B.R.A.N.D 2.0</Application></Properties>` },
    { name: 'xl/workbook.xml', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="MVP 기초 데이터" sheetId="1" r:id="rId1"/><sheet name="교사 입력" sheetId="2" r:id="rId2"/><sheet name="회차 정보" sheetId="3" r:id="rId3"/></sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/styles.xml', content: stylesXml() },
    { name: 'xl/worksheets/sheet1.xml', content: worksheetXml(mainRows, [10, 14, 18, 18, 16, 16, 16, 16, 14, 13, 13, 14, 10, 11, 13, 13, 13, 12, 10, 14, 14, 12, 12, 36], { freezeRow: 1, autoFilter: true, editableColumnsFrom: 18 }) },
    { name: 'xl/worksheets/sheet2.xml', content: worksheetXml(editRows, [10, 14, 12, 18, 16, 14, 14, 42], { freezeRow: 1, autoFilter: true, editableColumnsFrom: 2 }) },
    { name: 'xl/worksheets/sheet3.xml', content: worksheetXml(infoRows, [28, 40, 40], { freezeRow: 1 }) },
  ];

  return new Blob([zipStore(files)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

type ZipInput = { name: string; content: string | Uint8Array };

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(value: number): Uint8Array {
  return new Uint8Array([value & 0xff, (value >>> 8) & 0xff]);
}

function u32(value: number): Uint8Array {
  return new Uint8Array([value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff]);
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function dosDateTime(date: Date): { date: number; time: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
  };
}

function zipStore(files: ZipInput[]): Uint8Array {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  const now = dosDateTime(new Date());

  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = typeof file.content === 'string' ? encoder.encode(file.content) : file.content;
    const crc = crc32(data);
    const local = concatBytes([
      u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(now.time), u16(now.date),
      u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), name, data,
    ]);
    locals.push(local);
    centrals.push(concatBytes([
      u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(now.time), u16(now.date),
      u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name,
    ]));
    offset += local.length;
  }

  const central = concatBytes(centrals);
  const end = concatBytes([
    u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(central.length), u32(offset), u16(0),
  ]);
  return concatBytes([...locals, central, end]);
}

type ZipEntry = { name: string; method: number; compressedSize: number; uncompressedSize: number; localOffset: number };

function readU16(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}

function readU32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

function findEndOfCentralDirectory(data: Uint8Array): number {
  const min = Math.max(0, data.length - 65557);
  for (let i = data.length - 22; i >= min; i -= 1) {
    if (data[i] === 0x50 && data[i + 1] === 0x4b && data[i + 2] === 0x05 && data[i + 3] === 0x06) return i;
  }
  return -1;
}

function listZipEntries(data: Uint8Array): ZipEntry[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const eocd = findEndOfCentralDirectory(data);
  if (eocd < 0) throw new Error('XLSX 압축 구조를 읽을 수 없습니다.');
  const count = readU16(view, eocd + 10);
  let offset = readU32(view, eocd + 16);
  const decoder = new TextDecoder();
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i += 1) {
    if (readU32(view, offset) !== 0x02014b50) throw new Error('XLSX 중앙 디렉터리가 손상되었습니다.');
    const method = readU16(view, offset + 10);
    const compressedSize = readU32(view, offset + 20);
    const uncompressedSize = readU32(view, offset + 24);
    const nameLength = readU16(view, offset + 28);
    const extraLength = readU16(view, offset + 30);
    const commentLength = readU16(view, offset + 32);
    const localOffset = readU32(view, offset + 42);
    const name = decoder.decode(data.subarray(offset + 46, offset + 46 + nameLength));
    entries.push({ name, method, compressedSize, uncompressedSize, localOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') throw new Error('이 브라우저는 압축된 XLSX 읽기를 지원하지 않습니다. 최신 Chrome/Edge를 사용해주세요.');
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function readZipEntry(zip: Uint8Array, entry: ZipEntry): Promise<Uint8Array> {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const offset = entry.localOffset;
  if (readU32(view, offset) !== 0x04034b50) throw new Error(`XLSX 내부 파일을 읽을 수 없습니다: ${entry.name}`);
  const nameLength = readU16(view, offset + 26);
  const extraLength = readU16(view, offset + 28);
  const dataOffset = offset + 30 + nameLength + extraLength;
  const compressed = zip.subarray(dataOffset, dataOffset + entry.compressedSize);
  if (entry.method === 0) return compressed.slice();
  if (entry.method === 8) return inflateRaw(compressed);
  throw new Error(`지원하지 않는 XLSX 압축 방식입니다: ${entry.method}`);
}

async function zipText(entries: Map<string, ZipEntry>, zip: Uint8Array, path: string): Promise<string> {
  const entry = entries.get(path);
  if (!entry) throw new Error(`XLSX 내부 파일이 없습니다: ${path}`);
  const bytes = await readZipEntry(zip, entry);
  return new TextDecoder('utf-8').decode(bytes);
}

function parseXml(xml: string): Document {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('XLSX XML을 해석하지 못했습니다.');
  return doc;
}

function normalizeZipPath(base: string, target: string): string {
  if (target.startsWith('/')) return target.replace(/^\/+/, '');
  const parts = `${base}/${target}`.split('/');
  const stack: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return stack.join('/');
}

function columnIndexFromRef(ref: string): number {
  const letters = ref.match(/^[A-Z]+/i)?.[0]?.toUpperCase() ?? 'A';
  let n = 0;
  for (const ch of letters) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
}

function parseWorksheetRows(xml: string, sharedStrings: string[]): string[][] {
  const doc = parseXml(xml);
  const rows: string[][] = [];
  for (const rowNode of Array.from(doc.getElementsByTagNameNS('*', 'row'))) {
    const row: string[] = [];
    for (const cell of Array.from(rowNode.getElementsByTagNameNS('*', 'c'))) {
      const ref = cell.getAttribute('r') ?? 'A1';
      const index = columnIndexFromRef(ref);
      const type = cell.getAttribute('t') ?? '';
      let value = '';
      if (type === 'inlineStr') {
        value = Array.from(cell.getElementsByTagNameNS('*', 't')).map((node) => node.textContent ?? '').join('');
      } else {
        const raw = cell.getElementsByTagNameNS('*', 'v')[0]?.textContent ?? '';
        if (type === 's') value = sharedStrings[Number(raw)] ?? '';
        else if (type === 'b') value = raw === '1' ? 'TRUE' : 'FALSE';
        else value = raw;
      }
      while (row.length < index) row.push('');
      row[index] = value;
    }
    rows.push(row);
  }
  return rows;
}

async function readXlsxExchange(file: File): Promise<{ metadata: Partial<MvpExchangeMetadata>; rows: Array<Record<string, string>>; errors: string[] }> {
  const zip = new Uint8Array(await file.arrayBuffer());
  const entryList = listZipEntries(zip);
  const entries = new Map(entryList.map((entry) => [entry.name, entry]));
  const errors: string[] = [];

  const workbook = parseXml(await zipText(entries, zip, 'xl/workbook.xml'));
  const rels = parseXml(await zipText(entries, zip, 'xl/_rels/workbook.xml.rels'));
  const relationshipTargets = new Map<string, string>();
  for (const rel of Array.from(rels.getElementsByTagNameNS('*', 'Relationship'))) {
    relationshipTargets.set(rel.getAttribute('Id') ?? '', rel.getAttribute('Target') ?? '');
  }

  const sheetPaths = new Map<string, string>();
  for (const sheet of Array.from(workbook.getElementsByTagNameNS('*', 'sheet'))) {
    const name = sheet.getAttribute('name') ?? '';
    const relId = sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id')
      ?? sheet.getAttribute('r:id')
      ?? '';
    const target = relationshipTargets.get(relId);
    if (target) sheetPaths.set(name, normalizeZipPath('xl', target));
  }

  let sharedStrings: string[] = [];
  if (entries.has('xl/sharedStrings.xml')) {
    const sharedDoc = parseXml(await zipText(entries, zip, 'xl/sharedStrings.xml'));
    sharedStrings = Array.from(sharedDoc.getElementsByTagNameNS('*', 'si')).map((node) =>
      Array.from(node.getElementsByTagNameNS('*', 't')).map((textNode) => textNode.textContent ?? '').join(''),
    );
  }

  const infoPath = sheetPaths.get('회차 정보');
  const editPath = sheetPaths.get('교사 입력');
  if (!infoPath) errors.push("'회차 정보' 시트를 찾을 수 없습니다.");
  if (!editPath) errors.push("'교사 입력' 시트를 찾을 수 없습니다.");
  if (!infoPath || !editPath) return { metadata: {}, rows: [], errors };

  const infoRows = parseWorksheetRows(await zipText(entries, zip, infoPath), sharedStrings);
  const metadata: Record<string, unknown> = {};
  for (const row of infoRows.slice(1)) {
    const key = String(row[0] ?? '').trim();
    const value = row[1] ?? '';
    if (!key) continue;
    metadata[key] = key === 'session_id' ? Number(value) : value;
  }

  const editRows = parseWorksheetRows(await zipText(entries, zip, editPath), sharedStrings);
  return { metadata: metadata as Partial<MvpExchangeMetadata>, rows: mapRowsToObjects(editRows), errors };
}

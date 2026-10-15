import type { ArchiveFilters, ArchiveTurn } from '@/lib/rpc/gate_chat_archive_rpc';

type ZipInput = { name: string; content: string | Uint8Array };
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
  return table;
})();
function crc32(data: Uint8Array) { let crc = 0xffffffff; for (const b of data) crc = CRC_TABLE[(crc ^ b) & 255] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; }
function u16(n: number) { return new Uint8Array([n & 255, (n >>> 8) & 255]); }
function u32(n: number) { return new Uint8Array([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]); }
function concat(parts: Uint8Array[]) { const result = new Uint8Array(parts.reduce((n, b) => n + b.length, 0)); let at = 0; for (const b of parts) { result.set(b, at); at += b.length; } return result; }
// Same uncompressed OOXML ZIP approach used by the existing MVP exporter; no new dependency.
function zipStore(files: ZipInput[]) {
  const enc = new TextEncoder(), locals: Uint8Array[] = [], centrals: Uint8Array[] = []; let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name), data = typeof f.content === 'string' ? enc.encode(f.content) : f.content, crc = crc32(data);
    const local = concat([u32(0x04034b50),u16(20),u16(0x0800),u16(0),u16(0),u16(33),u32(crc),u32(data.length),u32(data.length),u16(name.length),u16(0),name,data]);
    locals.push(local);
    centrals.push(concat([u32(0x02014b50),u16(20),u16(20),u16(0x0800),u16(0),u16(0),u16(33),u32(crc),u32(data.length),u32(data.length),u16(name.length),u16(0),u16(0),u16(0),u16(0),u32(0),u32(offset),name]));
    offset += local.length;
  }
  const central = concat(centrals);
  return concat([...locals,central,concat([u32(0x06054b50),u16(0),u16(0),u16(files.length),u16(files.length),u32(central.length),u32(offset),u16(0)])]);
}
const xml = (s: string) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const text = (s: string) => xml(s.replace(/_x[0-9a-f]{4}_/gi, m => '_x005F_' + m.slice(1))
  .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, c => `_x${c.charCodeAt(0).toString(16).padStart(4,'0')}_`));
const timeNumber = (s: string) => (new Date(s).getTime() + 9*3600000) / 86400000 + 25569;
export function buildGateArchiveXlsx(turns: ArchiveTurn[], filters: ArchiveFilters): Blob {
  const rows: (string | number | null)[][] = [
    ['B.R.A.N.D 2.0 차원관문 AI 대화 기록'],
    [`기간: ${filters.from || '전체'} ~ ${filters.to || '전체'} / 검색: ${filters.search || '없음'} / 테스트 계정 제외 / 시각: KST`],
    ['학생명','학생 ID','편린명','편린 UID','학생 발언 시각(KST)','학생 발언','AI 응답 시각(KST)','AI 응답','요청 ID','중단 여부','학생 메시지 ID','AI 메시지 ID'],
    ...turns.map(t => [t.student_name,t.student_id,t.character_name,t.character_uid,timeNumber(t.created_at),t.student_content,
      t.reply_at ? timeNumber(t.reply_at) : null,t.reply_content ?? (t.is_aborted ? '[대화 중단 · 응답 없음]' : '[저장된 응답 없음]'),
      t.request_id,t.is_aborted ? '예' : '아니요',t.student_message_id,t.reply_message_id]),
  ];
  const body = rows.map((r,i) => `<row r="${i+1}">${r.map((v,j) => {
    const col = String.fromCharCode(65+j), style = i===2 ? 1 : i>2 && (j===4 || j===6) ? 2 : 0;
    if (v===null) return `<c r="${col}${i+1}" s="${style}"/>`;
    if (typeof v==='number') return `<c r="${col}${i+1}" s="${style}"><v>${v}</v></c>`;
    if(v.length>32767) throw new Error('Excel 한 셀의 글자 수 제한을 초과한 메시지가 있습니다.');
    return `<c r="${col}${i+1}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${text(v)}</t></is></c>`;
  }).join('')}</row>`).join('');
  const prefix = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const rel = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const files: ZipInput[] = [
    { name:'[Content_Types].xml',content:prefix+'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>' },
    { name:'_rels/.rels',content:prefix+`<Relationships xmlns="${rel}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name:'xl/workbook.xml',content:prefix+`<workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="대화 기록" sheetId="1" r:id="rId1"/></sheets></workbook>` },
    { name:'xl/_rels/workbook.xml.rels',content:prefix+`<Relationships xmlns="${rel}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name:'xl/styles.xml',content:prefix+`<styleSheet xmlns="${ns}"><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd hh:mm:ss"/></numFmts><fonts count="2"><font><sz val="11"/><name val="맑은 고딕"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="맑은 고딕"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF203864"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>` },
    { name:'xl/worksheets/sheet1.xml',content:prefix+`<worksheet xmlns="${ns}"><sheetViews><sheetView workbookViewId="0"><pane ySplit="3" topLeftCell="A4" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${[14,10,14,16,23,65,23,90,40,12,16,16].map((w,i)=>`<col min="${i+1}" max="${i+1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${body}</sheetData><autoFilter ref="A3:L${rows.length}"/></worksheet>` },
  ];
  const bytes = zipStore(files), buffer = new ArrayBuffer(bytes.byteLength); new Uint8Array(buffer).set(bytes);
  return new Blob([buffer], { type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

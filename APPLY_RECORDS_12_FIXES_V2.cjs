const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const os = require('os');

const MODE = process.argv[2] || '--check';
const ALLOWED_MODES = new Set(['--check', '--apply', '--verify']);
if (!ALLOWED_MODES.has(MODE)) {
  console.error('Usage: node APPLY_RECORDS_12_FIXES.cjs --check|--apply|--verify');
  process.exit(2);
}

const EXPECTED_BRANCH = 'main';

const FILES = {
  pioneers: 'src/features/feature4/RecordsPioneersHall.tsx',
  crowns: 'src/features/feature4/RecordsRepeatedCrownsHall.tsx',
  throne: 'src/features/feature4/RecordsThroneHall.tsx',
  ascent: 'src/features/feature4/RecordsAscentHall.tsx',
  guild: 'src/features/feature4/RecordsGuildHegemonyHall.tsx',
  constellation: 'src/features/feature4/RecordsConstellationHall.tsx',
  sovereign: 'src/features/feature4/RecordsSovereignProofHall.tsx',
};

function fail(message) {
  console.error(`\n[ERROR] ${message}`);
  process.exit(1);
}

function currentBranch() {
  try {
    return execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim();
  } catch {
    fail('Git 저장소 루트에서 실행해야 합니다.');
  }
}


function targetWorkingTreeChanges(fileList) {
  try {
    const args = ['status', '--porcelain', '--', ...fileList];
    return execFileSync('git', args, { encoding: 'utf8' }).trim();
  } catch {
    fail('Git 작업 트리 상태를 확인할 수 없습니다.');
  }
}

function readFile(rel) {
  const abs = path.resolve(process.cwd(), rel);
  if (!fs.existsSync(abs)) fail(`파일을 찾을 수 없습니다: ${rel}`);
  const raw = fs.readFileSync(abs, 'utf8');
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  // Windows checkout(CRLF)에서도 패턴 비교가 동일하게 동작하도록
  // 메모리에서는 LF로 정규화하고, 실제 저장할 때 원래 줄바꿈으로 되돌립니다.
  const text = raw.replace(/\r\n/g, '\n');
  return { rel, abs, text, eol };
}

function countLiteral(text, needle) {
  if (!needle) return 0;
  return text.split(needle).length - 1;
}

function replaceExactOnce(text, oldText, newText, label) {
  const count = countLiteral(text, oldText);
  if (count !== 1) {
    fail(`${label}: 예상한 기존 코드가 정확히 1곳이어야 하는데 ${count}곳 발견되었습니다. 파일은 수정되지 않았습니다.`);
  }
  return text.replace(oldText, newText);
}

function replaceRegexOnce(text, regex, replacement, label) {
  const flags = regex.flags.includes('g') ? regex.flags : `${regex.flags}g`;
  const matches = [...text.matchAll(new RegExp(regex.source, flags))];
  if (matches.length !== 1) {
    fail(`${label}: 수정 대상이 정확히 1곳이어야 하는데 ${matches.length}곳 발견되었습니다. 파일은 수정되지 않았습니다.`);
  }
  return text.replace(regex, replacement);
}

function replaceFunction(text, functionName, nextFunctionName, newFunction, label) {
  const regex = new RegExp(
    `function ${functionName}\\([\\s\\S]*?\\n}\\n\\n(?=function ${nextFunctionName}\\()`
  );
  return replaceRegexOnce(text, regex, `${newFunction.trim()}\n\n`, label);
}

function functionSlice(text, functionName, nextFunctionName) {
  const regex = new RegExp(
    `function ${functionName}\\([\\s\\S]*?\\n}\\n\\n(?=function ${nextFunctionName}\\()`
  );
  const m = text.match(regex);
  if (!m) fail(`검증용 함수 범위를 찾지 못했습니다: ${functionName}`);
  return m[0];
}

function assertIncludes(text, needle, label) {
  if (!text.includes(needle)) fail(`검증 실패: ${label}`);
}

function assertNotIncludes(text, needle, label) {
  if (text.includes(needle)) fail(`검증 실패: ${label}`);
}

function transform(originals) {
  const out = { ...originals };

  // 1) HALL 1: 최초 월간 MVP 대적자 3명은 반드시 한 줄.
  out.pioneers = replaceExactOnce(
    out.pioneers,
`            <div className="flex flex-wrap justify-center gap-2.5">
              {FIRST_MVP_RIVALS.map((name) => (
                <div
                  key={name}
                  className="rounded-full border border-amber-200/22 bg-[linear-gradient(180deg,rgba(255,230,180,0.11),rgba(0,0,0,0.18))] px-3.5 py-2 font-display text-sm text-amber-50 shadow-[0_0_12px_rgba(217,154,78,0.08)]"
                >
                  {name}
                </div>
              ))}
            </div>`,
`            <div className="grid w-full grid-cols-3 gap-2">
              {FIRST_MVP_RIVALS.map((name) => (
                <div
                  key={name}
                  className="whitespace-nowrap rounded-full border border-amber-200/22 bg-[linear-gradient(180deg,rgba(255,230,180,0.11),rgba(0,0,0,0.18))] px-2 py-2 font-display text-[12px] text-amber-50 shadow-[0_0_12px_rgba(217,154,78,0.08)] sm:text-sm"
                >
                  {name}
                </div>
              ))}
            </div>`,
    '1) 최초 월간 MVP 대적자 한 줄'
  );

  // 2) HALL 3: 최초 2회 왕관 - 회전 광 테두리 + 글로우 복구.
  out.crowns = replaceExactOnce(
    out.crowns,
`.crown-halo-breath { animation:crownHaloBreath 6.4s ease-in-out infinite; }
.crown-thread-flow { animation:crownThreadFlow 8.8s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) {
  .crown-halo-breath,.crown-thread-flow { animation:none; }
}`,
`@keyframes secondCrownOrbit {
  from { transform:rotate(0deg); }
  to { transform:rotate(360deg); }
}
@keyframes secondCrownGlow {
  0%,100% { box-shadow:0 0 18px rgba(236,143,168,.16),0 0 38px rgba(255,205,118,.10); }
  50% { box-shadow:0 0 30px rgba(245,157,181,.28),0 0 58px rgba(255,211,126,.18); }
}
.crown-halo-breath { animation:crownHaloBreath 6.4s ease-in-out infinite; }
.crown-thread-flow { animation:crownThreadFlow 8.8s ease-in-out infinite; }
.second-crown-flow-frame {
  position:relative;
  overflow:hidden;
  isolation:isolate;
  animation:secondCrownGlow 4.8s ease-in-out infinite;
}
.second-crown-flow-frame::before {
  content:'';
  position:absolute;
  inset:-65%;
  z-index:0;
  background:conic-gradient(
    from 0deg,
    transparent 0deg 34deg,
    rgba(255,231,174,.20) 56deg,
    rgba(255,246,207,.92) 76deg,
    rgba(236,143,168,.50) 96deg,
    transparent 118deg 214deg,
    rgba(255,216,139,.26) 236deg,
    rgba(255,240,194,.82) 258deg,
    rgba(218,111,145,.42) 278deg,
    transparent 304deg 360deg
  );
  animation:secondCrownOrbit 7.2s linear infinite;
}
.second-crown-inner { position:relative; z-index:1; }
@media (prefers-reduced-motion: reduce) {
  .crown-halo-breath,.crown-thread-flow,.second-crown-flow-frame,.second-crown-flow-frame::before { animation:none; }
}`,
    '2) 최초 2회 왕관 광효과 CSS'
  );

  out.crowns = replaceFunction(
    out.crowns,
    'SecondCrownRelic',
    'CrownMedallion',
`function SecondCrownRelic({ entry }: { entry: HallOfGloryEntry }) {
  return (
    <div className="second-crown-flow-frame relative mx-auto max-w-2xl rounded-[28px] p-[2px]">
      <article className="second-crown-inner overflow-hidden rounded-[26px] border border-rose-200/18 bg-[radial-gradient(circle_at_50%_12%,rgba(235,139,164,0.10),transparent_32%),linear-gradient(180deg,rgba(49,24,38,0.96),rgba(19,11,21,0.99))] px-5 py-5 text-center sm:px-7 sm:py-6">
        <div aria-hidden="true" className="absolute inset-x-[12%] top-0 h-px bg-gradient-to-r from-transparent via-rose-50/18 to-transparent" />
        <div aria-hidden="true" className="crown-thread-flow absolute top-[91px] h-px w-[38%] bg-gradient-to-r from-transparent via-amber-100/55 to-transparent" />
        <div className="relative">
          <div className="mx-auto flex max-w-sm items-center justify-center gap-4 sm:gap-6">
            <CrownMedallion index={1} />
            <div className="h-px flex-1 bg-gradient-to-r from-rose-100/8 via-amber-100/30 to-rose-100/8" />
            <CrownMedallion index={2} featured />
          </div>
          <div className="mt-5 text-[9px] font-black tracking-[0.18em] text-rose-200/54">FIRST TO WEAR TWO CROWNS</div>
          <div className="mt-1.5 font-display text-3xl text-rose-50 sm:text-4xl [text-shadow:0_0_16px_rgba(255,203,217,0.11)]">{entry.subject_display_name}</div>
          <div className="mt-2 font-display text-xl text-amber-100 sm:text-2xl">최초의 2회 왕관</div>
          {entry.period_label && <div className="mt-2 text-xs font-bold text-rose-50/62">{entry.period_label} · 두 번째 월간 MVP</div>}
          <div className="mt-3"><CrownRecordBadge live={entry.source_kind === 'PRODUCTION_DERIVED'} /></div>
        </div>
      </article>
    </div>
  );
}`,
    '2) 최초 2회 왕관 카드'
  );

  // 5) HALL 3: MVP 최다 후보 - 1위 < 2위 < 공동3위의 피라미드 폭, 불필요한 연도/후보선정 문구 제거.
  out.crowns = replaceFunction(
    out.crowns,
    'FinalistCourt',
    'CourtSeat',
`function FinalistCourt({ rows }: { rows: HallOfGloryEntry[] }) {
  if (rows.length === 0) return null;
  const rank1 = rows.filter((row) => row.rank_position === 1);
  const rank2 = rows.filter((row) => row.rank_position === 2);
  const rank3 = rows.filter((row) => row.rank_position === 3);

  return (
    <div className="relative overflow-hidden rounded-[30px] border border-rose-100/18 bg-[radial-gradient(circle_at_50%_0%,rgba(211,116,144,0.085),transparent_30%),linear-gradient(180deg,rgba(42,22,34,0.88),rgba(17,10,20,0.98))] px-4 py-6 shadow-[inset_0_0_34px_rgba(246,176,194,0.012)] sm:px-6 sm:py-8">
      <div aria-hidden="true" className="absolute bottom-8 left-1/2 top-8 w-px -translate-x-1/2 bg-gradient-to-b from-amber-100/24 via-rose-100/10 to-transparent" />
      <div className="relative flex flex-col items-center gap-4">
        <div className="w-full max-w-md space-y-3">
          {rank1.map((entry) => <CourtSeat key={entry.id} entry={entry} rank={1} featured />)}
        </div>

        <div className="w-full max-w-2xl space-y-3">
          {rank2.map((entry) => <CourtSeat key={entry.id} entry={entry} rank={2} />)}
        </div>

        {rank3.length > 0 && (
          <div className="w-full max-w-5xl rounded-[24px] border border-rose-100/16 bg-black/18 px-4 py-4 sm:px-5">
            <div className="flex flex-col items-center text-center">
              <div className="flex h-9 w-9 items-center justify-center rounded-full border border-rose-100/22 bg-rose-100/[0.05] font-display text-base text-rose-100">3</div>
              <div className="mt-2 text-[10px] font-black tracking-[0.18em] text-rose-200/56">JOINT THIRD · THE RIVAL GALLERY</div>
              <div className="mt-1 font-display text-lg text-rose-50 sm:text-xl">공동 3위의 회랑</div>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {rank3.map((entry) => (
                <div key={entry.id} className="rounded-[18px] border border-rose-100/16 bg-[linear-gradient(180deg,rgba(111,53,75,0.22),rgba(18,11,20,0.78))] px-3 py-3 text-center">
                  <Gem className="mx-auto h-4 w-4 text-rose-100/52" strokeWidth={1.4} />
                  <div className="mt-2 whitespace-nowrap font-display text-lg text-rose-50">{entry.subject_display_name}</div>
                  <div className="mt-1 font-display text-xl text-amber-100">{formatNumber(entry.value_primary ?? 0)}회</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}`,
    '5) MVP 최다 후보 피라미드'
  );

  out.crowns = replaceFunction(
    out.crowns,
    'CourtSeat',
    'CrownRecordBadge',
`function CourtSeat({ entry, rank, featured = false }: { entry: HallOfGloryEntry; rank: number; featured?: boolean }) {
  return (
    <article className={\`w-full overflow-hidden rounded-[22px] border text-center \${featured ? 'border-amber-100/30 bg-[radial-gradient(circle_at_50%_0%,rgba(255,213,139,0.12),transparent_38%),linear-gradient(180deg,rgba(79,36,52,0.66),rgba(23,12,24,0.94))] px-4 py-4 shadow-[0_0_24px_rgba(255,190,95,0.07)]' : 'border-rose-100/19 bg-[linear-gradient(180deg,rgba(74,34,51,0.38),rgba(21,12,23,0.90))] px-4 py-4'}\`}>
      <div className="flex justify-center">
        <div className={\`flex items-center justify-center rounded-full border font-display \${featured ? 'h-11 w-11 border-amber-100/34 bg-amber-100/[0.07] text-xl text-amber-100' : 'h-10 w-10 border-rose-100/22 bg-rose-100/[0.045] text-lg text-rose-100'}\`}>{rank}</div>
      </div>
      <div className={\`mt-2.5 whitespace-nowrap font-display text-rose-50 \${featured ? 'text-2xl sm:text-3xl' : 'text-xl sm:text-2xl'}\`}>{entry.subject_display_name}</div>
      {entry.subject_brand_name && <div className="mt-1 text-xs font-bold text-rose-50/45">{entry.subject_brand_name}</div>}
      <div className={\`mt-2 font-display text-amber-100 \${featured ? 'text-2xl' : 'text-xl'}\`}>{formatNumber(entry.value_primary ?? 0)}회</div>
      {featured && <div className="mt-3"><span className="inline-flex items-center gap-1.5 rounded-full border border-amber-100/22 bg-amber-100/[0.055] px-3 py-1.5 text-xs font-black text-amber-100"><Sparkles className="h-3.5 w-3.5" />역대 최다</span></div>}
    </article>
  );
}`,
    '5) MVP 최다 후보 카드 축소'
  );

  // 3) HALL 2: GOLD 1위 - 여전히 2~5위보다 강조되지만 과도한 세로 크기 축소.
  out.throne = replaceFunction(
    out.throne,
    'GoldVaultFirst',
    'GoldVaultPlaque',
`function GoldVaultFirst({ entry }: { entry: HallOfGloryEntry }) {
  return (
    <article className="relative mx-auto max-w-lg overflow-hidden rounded-t-[88px] rounded-b-[26px] border border-amber-200/34 bg-[radial-gradient(circle_at_50%_3%,rgba(255,215,137,0.14),transparent_30%),linear-gradient(180deg,rgba(66,44,24,0.90),rgba(21,14,21,0.985))] px-5 pb-5 pt-7 text-center shadow-[0_0_30px_rgba(255,190,70,0.09),inset_0_0_30px_rgba(255,224,166,0.018)] sm:px-6 sm:pb-6 sm:pt-8">
      <Coins aria-hidden="true" className="absolute left-1/2 top-3 h-24 w-24 -translate-x-1/2 text-amber-100/[0.026]" strokeWidth={1.0} />
      <div className="relative">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-amber-100/30 bg-amber-100/[0.07] font-display text-xl text-amber-100 shadow-[0_0_22px_rgba(255,195,86,0.10)]">1</div>
        <div className="mt-3 text-[9px] font-black tracking-[0.18em] text-amber-200/62">THE GOLDEN PEAK</div>
        <div className="mt-1 font-display text-3xl text-amber-50 sm:text-4xl [text-shadow:0_0_16px_rgba(255,221,145,0.16)]">{entry.subject_display_name}</div>
        <div className="mt-3 whitespace-nowrap font-display text-3xl text-amber-100 sm:text-4xl">{formatNumber(entry.value_primary ?? 0)} <span className="text-lg">GOLD</span></div>
        {entry.period_label && <div className="mt-2 text-sm font-bold text-amber-50/62">{entry.period_label}</div>}
        <div className="mt-3"><RecordStatusBadge live={entry.source_kind === 'PRODUCTION_DERIVED'} /></div>

        <div aria-hidden="true" className="mx-auto mt-5 flex max-w-[280px] flex-col items-center gap-1 opacity-72">
          {[64, 76, 88, 100].map((width, index) => (
            <div
              key={width}
              className="h-2.5 rounded-[4px] border border-amber-100/18 bg-[linear-gradient(180deg,rgba(255,221,143,0.20),rgba(143,89,35,0.20))] shadow-[0_0_8px_rgba(255,190,70,0.035)]"
              style={{ width: \`\${width}%\`, opacity: 0.68 + index * 0.08 }}
            />
          ))}
        </div>
      </div>
    </article>
  );
}`,
    '3) GOLD 1위 카드 축소'
  );

  // 4) HALL 2: 업적 왕좌 학생 이름 아래 브랜드 이름 제거.
  out.throne = replaceExactOnce(
    out.throne,
`                  {entry.subject_brand_name && <div className="mt-1 text-[10px] font-bold text-violet-50/48">{entry.subject_brand_name}</div>}
`,
    '',
    '4) 업적 왕좌 브랜드 이름 제거'
  );

  // 6) HALL 4: 비상의 궤적 - 동적 폭/clip-path 제거, 3글자 이름 한 줄 고정.
  out.ascent = replaceExactOnce(
    out.ascent,
`  const maxValue = Number(apex.value_primary ?? 1);
`,
    '',
    '6) 비상의 궤적 동적 폭 제거'
  );

  out.ascent = replaceExactOnce(
    out.ascent,
`          <AscentMarker
            key={entry.id}
            entry={entry}
            side={index % 2 === 0 ? 'left' : 'right'}
            strength={Math.max(0.58, Number(entry.value_primary ?? 0) / maxValue)}
          />`,
`          <AscentMarker
            key={entry.id}
            entry={entry}
            side={index % 2 === 0 ? 'left' : 'right'}
          />`,
    '6) 비상의 궤적 마커 호출'
  );

  out.ascent = replaceFunction(
    out.ascent,
    'AscentMarker',
    'AscentRecordBadge',
`function AscentMarker({ entry, side }: { entry: HallOfGloryEntry; side: 'left' | 'right' }) {
  const alignClass = side === 'left'
    ? 'sm:mr-auto sm:ml-[4%]'
    : 'sm:ml-auto sm:mr-[4%]';
  const connectorClass = side === 'left'
    ? 'right-[-48px]'
    : 'left-[-48px] rotate-180';
  const dotClass = side === 'left'
    ? 'right-[-55px]'
    : 'left-[-55px]';

  return (
    <div className={\`relative mx-auto w-full sm:w-[60%] \${alignClass}\`}>
      <div aria-hidden="true" className={\`absolute top-1/2 hidden h-px w-12 -translate-y-1/2 bg-gradient-to-r from-cyan-100/30 to-transparent sm:block \${connectorClass}\`} />
      <div aria-hidden="true" className={\`absolute top-1/2 hidden h-3 w-3 -translate-y-1/2 rounded-full border border-cyan-100/30 bg-[#10202a] shadow-[0_0_12px_rgba(96,220,219,0.12)] sm:block \${dotClass}\`} />

      <article className="relative w-full min-w-0 overflow-hidden rounded-[22px] border border-cyan-100/16 bg-[linear-gradient(135deg,rgba(46,93,103,0.32),rgba(10,19,28,0.94))] px-4 py-4 shadow-[inset_0_0_24px_rgba(114,228,226,0.012)] sm:px-5">
        <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 sm:gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-cyan-100/18 bg-black/18 font-display text-lg text-cyan-100">
            {entry.rank_position}
          </div>

          <div className="min-w-0">
            <div className="whitespace-nowrap font-display text-xl leading-none text-cyan-50 sm:text-2xl">{entry.subject_display_name}</div>
            {entry.period_label && <div className="mt-1.5 whitespace-nowrap text-xs font-bold text-cyan-50/58">{entry.period_label}</div>}
          </div>

          <div className="shrink-0 text-right">
            <div className="whitespace-nowrap font-display text-xl text-cyan-100 sm:text-2xl">+{formatNumber(entry.value_primary ?? 0)}</div>
            <div className="text-[9px] font-black tracking-[0.14em] text-cyan-200/58">BV</div>
          </div>
        </div>
      </article>
    </div>
  );
}`,
    '6) 비상의 궤적 마커 레이아웃'
  );

  // 7) HALL 6: 단일 월 전과 1위 점수 - 카드 밖으로 절대 튀어나오지 않게 반응형 축소.
  out.guild = replaceExactOnce(
    out.guild,
`          <div className="whitespace-nowrap font-display text-[1.9rem] leading-none text-amber-50 sm:text-[2.35rem]">{score}</div>`,
`          <div className="whitespace-nowrap font-display text-[clamp(1.35rem,3vw,1.85rem)] leading-none tracking-[-0.045em] text-amber-50">{score}</div>`,
    '7) 단일 월 전과 점수 오버플로 방지'
  );

  // 8) HALL 6: 지휘관은 "기여도". 달성률/기여율/소속길드/퍼센트 표시 제거.
  out.guild = replaceFunction(
    out.guild,
    'CommanderRelic',
    'FinalBattle',
`function CommanderRelic({ entry, featured = false }: { entry: HallOfGloryEntry; featured?: boolean }) {
  const title = entry.record_type === 'BEST_MONTHLY_CONTRIBUTION_RATE'
    ? '역대 최고 월간 개인 기여도'
    : entry.record_type === 'BEST_SEASON_CONTRIBUTION_RATE'
      ? '역대 최고 시즌 개인 기여도'
      : entry.title;
  const unit = entry.unit?.trim() || '점';
  const score = unit === '점'
    ? \`\${formatNumber(entry.value_primary ?? 0)}점\`
    : \`\${formatNumber(entry.value_primary ?? 0)} \${unit}\`;

  return (
    <article className={\`relative overflow-hidden rounded-[26px] border px-5 py-5 text-center \${featured ? 'border-amber-100/26 bg-[radial-gradient(circle_at_50%_0%,rgba(255,214,135,0.16),transparent_34%),linear-gradient(180deg,rgba(84,35,24,0.84),rgba(18,10,11,0.97))] shadow-[0_0_32px_rgba(255,193,94,0.11)]' : 'border-red-100/18 bg-[radial-gradient(circle_at_50%_0%,rgba(236,116,81,0.12),transparent_34%),linear-gradient(180deg,rgba(53,20,20,0.82),rgba(14,10,11,0.96))] shadow-[0_0_24px_rgba(171,62,42,0.09)]'}\`}>
      <div aria-hidden="true" className={\`commander-spotlight absolute left-1/2 top-0 h-[180px] w-[62%] -translate-x-1/2 bg-[linear-gradient(180deg,rgba(255,247,220,0.22),rgba(255,247,220,0.02),transparent)] blur-lg \${featured ? 'opacity-40' : 'opacity-28'}\`} />
      <div className="relative">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-amber-100/22 bg-black/18 text-amber-100 shadow-[0_0_18px_rgba(255,205,116,0.09)]">
          <Medal className="h-5 w-5" strokeWidth={1.6} />
        </div>
        <div className="mt-3 text-[10px] font-black tracking-[0.16em] text-red-100/76">지휘관 공훈</div>
        <div className="mt-2 whitespace-nowrap font-display text-3xl text-red-50 sm:text-[2.2rem]">{entry.subject_display_name}</div>
        <div className="mt-1 text-base font-bold text-red-50/88">{title}</div>
        {entry.period_label && <div className="mt-1 whitespace-nowrap text-sm font-bold text-red-50/84">{entry.period_label}</div>}
        <div className="mt-4 whitespace-nowrap font-display text-[2rem] leading-none text-amber-100 sm:text-[2.35rem]">{score}</div>
        <div className="mt-3"><RecordBadge live={entry.source_kind === 'PRODUCTION_DERIVED'} compact /></div>
      </div>
    </article>
  );
}`,
    '8) 지휘관 기여도 표기'
  );

  // 9) HALL 6: "빛나는 은하수"를 한 줄 고정, 긴 길드명은 폰트만 축소.
  out.guild = replaceFunction(
    out.guild,
    'BattleSide',
    'BattleRoster',
`function BattleSide({ title, guildName, score, roster, note, winner = false }: { title: string; guildName: string; score: number; roster: string[]; note?: string; winner?: boolean }) {
  const logo = GUILD_LOGOS[guildName];
  const guildNameSize = guildName.length >= 6
    ? 'text-[1.55rem] sm:text-[1.85rem]'
    : 'text-[2rem] sm:text-[2.25rem]';

  const content = (
    <div className={\`rounded-[24px] px-4 py-5 text-center \${winner ? 'bg-[radial-gradient(circle_at_50%_0%,rgba(255,226,160,0.12),transparent_34%),linear-gradient(180deg,rgba(88,37,25,0.58),rgba(20,10,11,0.95))] shadow-[0_0_24px_rgba(255,194,90,0.10)]' : 'border border-red-100/18 bg-[linear-gradient(180deg,rgba(52,22,22,0.54),rgba(13,10,11,0.96))]'}\`}>
      <div className={\`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-black \${winner ? 'border-amber-100/24 bg-amber-100/[0.06] text-amber-100' : 'border-red-100/18 bg-red-100/[0.04] text-red-50/90'}\`}>
        {winner ? <Trophy className="h-3.5 w-3.5" strokeWidth={1.6} /> : <ShieldCheck className="h-3.5 w-3.5" strokeWidth={1.6} />}
        {title}
      </div>
      <div className="mt-4 flex items-center justify-center">
        <div className={\`flex h-20 w-20 items-center justify-center rounded-[20px] border \${winner ? 'border-amber-100/22 bg-black/22' : 'border-red-100/18 bg-black/18'}\`}>
          {logo ? (
            <img src={logo} alt="" aria-hidden="true" className="h-16 w-16 object-contain" />
          ) : (
            <Shield className={\`h-9 w-9 \${winner ? 'text-amber-100' : 'text-red-50/84'}\`} strokeWidth={1.4} />
          )}
        </div>
      </div>
      <div className={\`mx-auto mt-4 max-w-full whitespace-nowrap font-display leading-none \${guildNameSize} \${winner ? 'text-amber-50' : 'text-red-50'}\`}>{guildName}</div>
      <div className={\`mt-3 whitespace-nowrap font-display text-3xl \${winner ? 'text-amber-100' : 'text-red-50'} sm:text-[2.25rem]\`}>{formatNumber(score)} GS</div>
      {note && <div className="mt-2 text-sm font-bold text-slate-100/88">{note}</div>}
      <div className="mt-4 rounded-[18px] border border-white/10 bg-black/18 px-3 py-3">
        <div className="text-[11px] font-black tracking-[0.14em] text-slate-100/88">함께 싸운 길드원</div>
        <BattleRoster names={roster} />
      </div>
    </div>
  );

  if (winner) {
    return <div className="imperial-flow-frame self-center overflow-hidden rounded-[27px] p-[2px]">{content}</div>;
  }

  return <div className="self-center">{content}</div>;
}`,
    '9) 마지막 전투 길드명 한 줄'
  );

  // 오래된, 더 이상 사용하지 않는 기여율 helper도 제거(화면 로직 혼동 방지).
  out.guild = replaceRegexOnce(
    out.guild,
    /\nfunction contributionUnit\(title: string\) \{[\s\S]*?\n\}\s*$/,
    '\n',
    '8) 구형 기여율 helper 제거'
  );

  // 10) HALL 8: 좁은 카드에서 업적명/날짜가 테두리에 걸리지 않도록 3열 breakpoint와 텍스트 폭 조정.
  out.constellation = replaceExactOnce(
    out.constellation,
`      <div className="relative grid content-start gap-3 sm:grid-cols-2 lg:grid-cols-3">`,
`      <div className="relative grid content-start gap-3 sm:grid-cols-2 xl:grid-cols-3">`,
    '10) 위업 성좌 그리드 폭'
  );

  out.constellation = replaceFunction(
    out.constellation,
    'AchievementStar',
    'StarField',
`function AchievementStar({ achievement, index, tone }: { achievement: HallAchievementDetail; index: number; tone: ConstellationTone }) {
  const isTranscend = tone === 'TRANSCEND';
  const featured = /시즌1의 황제|최초의 왕좌|마스터피스/.test(achievement.name);
  const border = isTranscend ? 'border-violet-100/18' : 'border-sky-100/16';
  const bg = featured
    ? isTranscend
      ? 'bg-[radial-gradient(circle_at_50%_0%,rgba(231,196,255,0.12),transparent_34%),linear-gradient(180deg,rgba(61,42,82,0.50),rgba(12,13,26,0.80))]'
      : 'bg-[radial-gradient(circle_at_50%_0%,rgba(205,233,255,0.11),transparent_34%),linear-gradient(180deg,rgba(35,61,82,0.48),rgba(10,15,27,0.82))]'
    : 'bg-[linear-gradient(180deg,rgba(255,255,255,0.035),rgba(0,0,0,0.10))]';

  return (
    <div className={\`relative min-h-[128px] min-w-0 overflow-hidden rounded-[19px] border \${border} \${bg} px-3 py-3.5 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.025)]\`}>
      <div className={\`mx-auto flex h-9 w-9 items-center justify-center rounded-full border border-white/16 bg-black/22 \${isTranscend ? 'text-violet-100' : 'text-sky-100'} \${featured ? 'constellation-star-node' : ''}\`}>
        {featured ? <Sparkles className="h-4.5 w-4.5" strokeWidth={1.55} /> : <Star className="h-4 w-4" strokeWidth={1.55} />}
      </div>
      <div className="mx-auto mt-2.5 max-w-full font-display text-[1rem] leading-[1.35] text-slate-50 sm:text-[1.05rem] [word-break:keep-all]">{achievement.name}</div>
      {achievement.achieved_on && <div className="mt-2 whitespace-nowrap text-[10px] font-extrabold tracking-[-0.035em] text-slate-100/88 sm:text-[11px]">{koreanDate(achievement.achieved_on)}</div>}
      <div className="absolute right-2.5 top-2.5 text-[9px] font-black tracking-[0.12em] text-slate-100/62">{String(index + 1).padStart(2, '0')}</div>
    </div>
  );
}`,
    '10) 위업 성좌 카드 텍스트'
  );

  // 11) HALL 9: 시즌의 황제 카드의 중복 설명 배지 2개 제거.
  out.sovereign = replaceExactOnce(
    out.sovereign,
`        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-100/20 bg-amber-100/[0.055] px-3 py-1.5 text-xs font-black text-amber-50">
            <Sparkles className="h-3.5 w-3.5" />
            네 개의 증명 모두 충족
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-100/18 bg-slate-100/[0.045] px-3 py-1.5 text-xs font-black text-slate-100/90">
            <ShieldCheck className="h-3.5 w-3.5" />
            공식 확정 기록
          </span>
        </div>
`,
    '',
    '11) 시즌의 황제 중복 배지 제거'
  );

  out.sovereign = replaceExactOnce(
    out.sovereign,
`  Sparkles,
`,
    '',
    '11) 사용하지 않는 Sparkles import 제거'
  );

  // 12) HALL 9: 삼중왕관 빈 자리 문구 - 한국어 단어 중간 분리 금지.
  out.sovereign = replaceExactOnce(
    out.sovereign,
`          <div className="rounded-[28px] border border-dashed border-amber-100/18 bg-black/20 px-5 py-10 text-center">
            <Crown className="mx-auto h-9 w-9 text-amber-100/82" strokeWidth={1.35} />
            <div className="mt-4 font-display text-2xl text-slate-50">아직 삼중왕관의 자리는 비어 있습니다</div>
            <div className="mt-2 text-sm font-semibold leading-7 text-slate-200/84">
              첫 번째 삼중왕관 달성자가 나타나면 이 공간에 이름이 새겨집니다.
            </div>
          </div>`,
`          <div className="flex min-h-[270px] flex-col items-center justify-center rounded-[28px] border border-dashed border-amber-100/18 bg-black/20 px-6 py-9 text-center">
            <Crown className="mx-auto h-9 w-9 text-amber-100/82" strokeWidth={1.35} />
            <div className="mx-auto mt-4 max-w-lg font-display text-xl leading-8 text-slate-50 sm:text-2xl [word-break:keep-all]">아직 삼중왕관의 자리는 비어 있습니다</div>
            <div className="mx-auto mt-2 max-w-lg text-sm font-semibold leading-7 text-slate-200/84 [word-break:keep-all]">
              첫 번째 삼중왕관 달성자가 나타나면 이 공간에 이름이 새겨집니다.
            </div>
          </div>`,
    '12) 삼중왕관 빈 자리 줄바꿈'
  );

  return out;
}

function verify(out) {
  // 1
  assertIncludes(out.pioneers, 'grid w-full grid-cols-3 gap-2', '1) 대적자 3명 한 줄 grid');
  assertNotIncludes(out.pioneers, 'flex flex-wrap justify-center gap-2.5', '1) 대적자 flex-wrap 제거');

  // 2,5
  assertIncludes(out.crowns, 'second-crown-flow-frame', '2) 최초 2회 왕관 회전 광 테두리');
  assertIncludes(out.crowns, 'secondCrownOrbit', '2) 회전 애니메이션');
  assertNotIncludes(out.crowns, '· 월간 MVP 후보 선정', '5) 중복 후보선정 문구 제거');
  assertIncludes(out.crowns, 'max-w-md space-y-3', '5) 1위 피라미드 폭');
  assertIncludes(out.crowns, 'max-w-2xl space-y-3', '5) 2위 피라미드 폭');
  assertIncludes(out.crowns, 'max-w-5xl rounded-[24px]', '5) 공동3위 피라미드 폭');

  // 3,4
  const goldFn = functionSlice(out.throne, 'GoldVaultFirst', 'GoldVaultPlaque');
  assertIncludes(goldFn, 'max-w-lg', '3) GOLD 1위 적정 폭');
  assertIncludes(goldFn, 'rounded-t-[88px]', '3) GOLD 1위 세로 축소');
  const achievementFn = functionSlice(out.throne, 'AchievementThrone', 'RecordStatusBadge');
  assertNotIncludes(achievementFn, 'subject_brand_name', '4) 업적 왕좌 브랜드명 제거');

  // 6
  const ascentFn = functionSlice(out.ascent, 'AscentMarker', 'AscentRecordBadge');
  assertIncludes(ascentFn, 'whitespace-nowrap font-display text-xl', '6) 이름 한 줄');
  assertNotIncludes(ascentFn, 'clipPath', '6) 카드 잘림 원인 제거');
  assertNotIncludes(out.ascent, 'strength={', '6) 동적 폭 제거');

  // 7,8,9
  assertIncludes(out.guild, 'text-[clamp(1.35rem,3vw,1.85rem)]', '7) 단일 월 1위 점수 반응형 축소');
  const commanderFn = functionSlice(out.guild, 'CommanderRelic', 'FinalBattle');
  assertIncludes(commanderFn, '역대 최고 월간 개인 기여도', '8) 월간 개인 기여도 명칭');
  assertIncludes(commanderFn, '역대 최고 시즌 개인 기여도', '8) 시즌 개인 기여도 명칭');
  assertNotIncludes(commanderFn, '{entry.title}', '8) DB의 달성률/기여율 제목 직접노출 제거');
  assertNotIncludes(commanderFn, 'guildName', '8) 소속길드 표시 제거');
  assertNotIncludes(commanderFn, 'rate.toFixed', '8) 퍼센트 표시 제거');
  const battleFn = functionSlice(out.guild, 'BattleSide', 'BattleRoster');
  assertIncludes(battleFn, 'whitespace-nowrap font-display', '9) 길드명 한 줄');
  assertIncludes(battleFn, "guildName.length >= 6", '9) 긴 길드명 폰트 축소');

  // 10
  assertIncludes(out.constellation, 'sm:grid-cols-2 xl:grid-cols-3', '10) 성좌 카드 충분한 폭');
  const starFn = functionSlice(out.constellation, 'AchievementStar', 'StarField');
  assertIncludes(starFn, '[word-break:keep-all]', '10) 업적명 단어 단위 줄바꿈');
  assertIncludes(starFn, 'text-[10px]', '10) 날짜 축소');

  // 11,12
  const emperorFn = functionSlice(out.sovereign, 'EmperorProof', 'TripleCrownRegister');
  assertNotIncludes(emperorFn, '네 개의 증명 모두 충족', '11) 중복 배지 제거');
  assertNotIncludes(emperorFn, '공식 확정 기록', '11) 공식 확정 중복 배지 제거');
  assertIncludes(out.sovereign, 'max-w-lg font-display text-xl leading-8', '12) 삼중왕관 빈자리 제목 폭');
  assertIncludes(out.sovereign, 'text-slate-200/84 [word-break:keep-all]', '12) 삼중왕관 설명 단어중간 분리 금지');

  console.log('\n[VERIFY] 12개 요청사항 정적 검증 통과');
}

const branch = currentBranch();
if (branch !== EXPECTED_BRANCH) {
  fail(`현재 브랜치가 "${branch}"입니다. 이 최종 핫픽스 패키지는 main 브랜치에서만 실행합니다.`);
}

if (MODE !== '--verify') {
  const dirtyTargets = targetWorkingTreeChanges(Object.values(FILES));
  if (dirtyTargets) {
    fail(`수정 대상 7개 파일 중 이미 로컬 변경이 있는 파일이 있습니다. 덮어쓰지 않기 위해 중단합니다.\n${dirtyTargets}\nGitHub Desktop에서 해당 7개 파일을 먼저 원상복구하거나, 현재 상태를 보여주세요.`);
  }
}

const loaded = {};
for (const [key, rel] of Object.entries(FILES)) {
  loaded[key] = readFile(rel);
}
const originals = Object.fromEntries(Object.entries(loaded).map(([key, f]) => [key, f.text]));

if (MODE === '--verify') {
  verify(originals);
  process.exit(0);
}

const transformed = transform(originals);
verify(transformed);

console.log('\n수정 예정 파일(7개):');
for (const rel of Object.values(FILES)) console.log(`- ${rel}`);

if (MODE === '--check') {
  console.log('\n[CHECK OK] 현재 main 소스와 수정 패키지가 정확히 맞습니다.');
  console.log('[CHECK ONLY] 실제 파일은 아직 수정하지 않았습니다.');
  process.exit(0);
}

// Apply atomically after every transformation + verification has succeeded.
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDir = path.join(os.tmpdir(), `brand-records-fix-backup-${stamp}`);
fs.mkdirSync(backupDir, { recursive: true });

for (const [key, f] of Object.entries(loaded)) {
  fs.copyFileSync(f.abs, path.join(backupDir, path.basename(f.rel)));
}
for (const [key, f] of Object.entries(loaded)) {
  const output = f.eol === '\r\n'
    ? transformed[key].replace(/\n/g, '\r\n')
    : transformed[key];
  fs.writeFileSync(f.abs, output, 'utf8');
}

console.log(`\n[APPLY OK] 7개 파일 수정 완료.`);
console.log(`[BACKUP] 원본 백업: ${backupDir}`);
console.log('\n다음 단계:');
console.log('1) node APPLY_RECORDS_12_FIXES.cjs --verify');
console.log('2) npm run build');
console.log('3) GitHub Desktop에서 위 7개 TSX만 확인 후 main에 commit → Push origin');

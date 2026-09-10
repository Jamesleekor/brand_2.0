const fs = require("fs");
const path = require("path");

const root = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
const target = path.join(
  root,
  "src",
  "features",
  "wallet",
  "EconomicActionsPanel.tsx",
);

function fail(message) {
  console.error(`[ERROR] ${message}`);
  process.exit(1);
}

if (!fs.existsSync(target)) {
  fail(`대상 파일을 찾을 수 없습니다: ${target}`);
}

let text = fs.readFileSync(target, "utf8");

// Idempotent: already applied.
if (text.includes('disabled={token === "CRYSTAL"}')) {
  console.log("[OK] CRYSTAL → GOLD 비활성화가 이미 적용되어 있습니다.");
  console.log("추가 변경 없음.");
  process.exit(0);
}

// Find the exact currency-direction selector region first.
const selectorMarker = '(["GOLD", "CRYSTAL"] as const).map((token) => (';
const selectorIndex = text.indexOf(selectorMarker);

if (selectorIndex === -1) {
  fail(
    'GOLD/CRYSTAL 교환 선택 영역을 찾지 못했습니다. ' +
    'EconomicActionsPanel.tsx 구조가 변경된 것으로 보입니다.'
  );
}

// Only inspect a bounded region after the selector marker so another button is never modified.
const regionEnd = Math.min(text.length, selectorIndex + 2500);
let region = text.slice(selectorIndex, regionEnd);

const clickMarker = 'onClick={() => changeDirection(token)}';
const clickIndex = region.indexOf(clickMarker);

if (clickIndex === -1) {
  fail('교환 방향 버튼의 onClick 코드를 찾지 못했습니다.');
}

// Detect the local file's newline style (Windows CRLF / Unix LF).
const eol = text.includes("\r\n") ? "\r\n" : "\n";

// Preserve indentation from the onClick line.
const lineStart = region.lastIndexOf("\n", clickIndex) + 1;
const indentMatch = region.slice(lineStart, clickIndex).match(/^\s*/);
const indent = indentMatch ? indentMatch[0] : "                  ";

// Insert disabled immediately after the exchange-direction onClick.
const insertionPoint = clickIndex + clickMarker.length;
region =
  region.slice(0, insertionPoint) +
  eol +
  indent +
  'disabled={token === "CRYSTAL"}' +
  region.slice(insertionPoint);

// Optional visual disabled state, scoped only to this selector region.
// If the expected class string changes in the future, the functional disable still succeeds.
const classBefore = '"p-3 rounded-card-md border text-left transition-all"';
const classAfter =
  '"p-3 rounded-card-md border text-left transition-all disabled:opacity-50 disabled:cursor-not-allowed"';

if (region.includes(classBefore)) {
  region = region.replace(classBefore, classAfter);
}

// Write only the bounded selector region back.
text =
  text.slice(0, selectorIndex) +
  region +
  text.slice(regionEnd);

fs.writeFileSync(target, text, "utf8");

// Post-check.
const verify = fs.readFileSync(target, "utf8");

if (!verify.includes('disabled={token === "CRYSTAL"}')) {
  fail("적용 후 검증 실패: CRYSTAL 비활성화 속성이 없습니다.");
}

const selectorVerifyIndex = verify.indexOf(selectorMarker);
const disabledVerifyIndex = verify.indexOf(
  'disabled={token === "CRYSTAL"}',
  selectorVerifyIndex,
);

if (
  selectorVerifyIndex === -1 ||
  disabledVerifyIndex === -1 ||
  disabledVerifyIndex > selectorVerifyIndex + 2500
) {
  fail("적용 후 검증 실패: 비활성화 속성이 교환 선택 영역에 있지 않습니다.");
}

console.log("[B.R.A.N.D. 2.0] 화폐 교환 UI 수정 완료");
console.log(`Target: ${target}`);
console.log("- GOLD → CRYSTAL: 사용 가능");
console.log("- CRYSTAL → GOLD: 선택 버튼 비활성화");
console.log("- DB / RPC / 환율 로직: 변경 없음");
console.log(`- 감지한 줄바꿈: ${eol === "\r\n" ? "CRLF (Windows)" : "LF"}`);

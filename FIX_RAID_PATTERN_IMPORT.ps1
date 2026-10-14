$ErrorActionPreference = 'Stop'

$raidFolder = Join-Path $PSScriptRoot 'src\features\teacher\raid'
$component = Join-Path $raidFolder 'RaidPatternGenerator.tsx'
$editor = Join-Path $raidFolder 'RaidV15ConfigPanel.tsx'
$oldEngine = Join-Path $raidFolder 'raidPatternGenerator.ts'
$newEngine = Join-Path $raidFolder 'raidPatternEngine.ts'
$oldImport = "from './raidPatternGenerator'"
$newImport = "from './raidPatternEngine'"

try {
    if (!(Test-Path -LiteralPath (Join-Path $PSScriptRoot 'package.json'))) {
        throw 'Run this fix from the brand_2.0 project root (next to package.json).'
    }
    if (!(Test-Path -LiteralPath $component) -or !(Test-Path -LiteralPath $editor)) {
        throw 'Required files are missing. Apply the original pattern generator patch first.'
    }

    $oldPresent = Test-Path -LiteralPath $oldEngine
    $newPresent = Test-Path -LiteralPath $newEngine
    if ($oldPresent -and $newPresent) {
        throw 'Both old and new engine files exist. Refusing to overwrite either file; please inspect them manually.'
    }
    if (!$oldPresent -and !$newPresent) {
        throw 'Pattern generator engine file is missing; no changes made.'
    }

    $uiText = [System.IO.File]::ReadAllText($component, [System.Text.Encoding]::UTF8)
    $editorText = [System.IO.File]::ReadAllText($editor, [System.Text.Encoding]::UTF8)
    if (!$editorText.Contains("from './RaidPatternGenerator'")) {
        throw 'RaidV15ConfigPanel import is not the expected version; no changes made.'
    }
    if (!$uiText.Contains('export default function RaidPatternGenerator')) {
        throw 'UI component default export was not found; no changes made.'
    }
    if (!$uiText.Contains($oldImport) -and !$uiText.Contains($newImport)) {
        throw 'UI engine import is not the expected version; no changes made.'
    }

    $didRename = $false
    if ($oldPresent) {
        Move-Item -LiteralPath $oldEngine -Destination $newEngine -ErrorAction Stop
        $didRename = $true
    }
    try {
        if ($uiText.Contains($oldImport)) {
            $updatedText = $uiText.Replace($oldImport, $newImport)
            $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
            [System.IO.File]::WriteAllText($component, $updatedText, $utf8NoBom)
        }
    } catch {
        if ($didRename -and (Test-Path -LiteralPath $newEngine)) {
            Move-Item -LiteralPath $newEngine -Destination $oldEngine
        }
        throw
    }

    $newUiText = [System.IO.File]::ReadAllText($component, [System.Text.Encoding]::UTF8)
    if ((Test-Path -LiteralPath $oldEngine) -or !(Test-Path -LiteralPath $newEngine) -or
        !($newUiText.Contains($newImport))) {
        throw 'Post-fix verification failed. Inspect the engine file and UI import.'
    }

    Write-Host '[OK] raidPatternGenerator.ts -> raidPatternEngine.ts' -ForegroundColor Green
    Write-Host '[OK] RaidPatternGenerator.tsx now imports ./raidPatternEngine' -ForegroundColor Green
    Write-Host '[OK] RaidV15ConfigPanel.tsx unchanged (imports the UI component)' -ForegroundColor Green
    Write-Host '[OK] This fix did not touch any database, gameplay logic, git commits, or npm.' -ForegroundColor Green
    Write-Host 'Next: run npm run build on your local PC.'
    exit 0
} catch {
    Write-Host ('[ERROR] ' + $_.Exception.Message) -ForegroundColor Red
    exit 1
}

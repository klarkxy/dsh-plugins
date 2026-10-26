$ErrorActionPreference = 'Stop'
$root = Join-Path ([System.IO.Path]::GetTempPath()) ('dsh-discovery-installer-' + [guid]::NewGuid().ToString('N'))
$resources = Join-Path $root 'application/resources'
$null = New-Item -ItemType Directory -Path $resources
$target = Join-Path $resources 'app.asar'
$staged = Join-Path $root 'candidate.asar'
$receiptPath = Join-Path $root 'receipt.json'
$installer = Join-Path $PSScriptRoot 'install.ps1'
[System.IO.File]::WriteAllText((Join-Path $root 'application/DeepSeek Harness.exe'), 'test fixture')
[System.IO.File]::WriteAllText($target, 'original fixture')
[System.IO.File]::WriteAllText($staged, 'patched fixture')
$originalHash = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()
$patchedHash = (Get-FileHash -LiteralPath $staged -Algorithm SHA256).Hash.ToLowerInvariant()
@{ schemaVersion = 1; original = $target; staged = $staged; originalSha256 = $originalHash; stagedSha256 = $patchedHash } | ConvertTo-Json | Set-Content -LiteralPath $receiptPath -Encoding utf8NoBOM
# The process boundary is the only fixture: never inspect or stop the actual app.
$global:discoveryFixtureDesktopRunning = $false
function Get-Process { param($Name, $ErrorAction) if ($global:discoveryFixtureDesktopRunning) { [pscustomobject]@{ Id = 1 } } }
try {
    & $installer -Receipt $receiptPath -Action check
    if ((Get-FileHash -LiteralPath $target).Hash.ToLowerInvariant() -ne $originalHash) { throw 'Check changed installation.' }
    $global:discoveryFixtureDesktopRunning = $true
    $refused = $false
    try { & $installer -Receipt $receiptPath -Action apply } catch { if ($_.Exception.Message -match 'Fully quit') { $refused = $true } else { throw } }
    if (-not $refused) { throw 'Installation did not refuse a running desktop.' }
    $global:discoveryFixtureDesktopRunning = $false
    & $installer -Receipt $receiptPath -Action apply
    if ((Get-FileHash -LiteralPath $target).Hash.ToLowerInvariant() -ne $patchedHash) { throw 'Patch was not installed.' }
    & $installer -Receipt $receiptPath -Action apply
    & $installer -Receipt $receiptPath -Action restore
    if ((Get-FileHash -LiteralPath $target).Hash.ToLowerInvariant() -ne $originalHash) { throw 'Original was not restored.' }
    [System.IO.File]::WriteAllText($target, 'different release')
    $refused = $false
    try { & $installer -Receipt $receiptPath -Action apply } catch { if ($_.Exception.Message -match 'different release') { $refused = $true } else { throw } }
    if (-not $refused) { throw 'Installation did not refuse a changed release.' }
    Write-Output 'PASS: check, running-app refusal, atomic install, repeat install, restore, changed-release refusal.'
} finally {
    $resolved = [System.IO.Path]::GetFullPath($root)
    if (-not $resolved.StartsWith([System.IO.Path]::GetTempPath(), [System.StringComparison]::OrdinalIgnoreCase) -or [System.IO.Path]::GetFileName($resolved) -notlike 'dsh-discovery-installer-*') { throw 'Unexpected fixture cleanup target.' }
    Write-Output "Remove only owned test fixture: $resolved"
    Remove-Item -LiteralPath $resolved -Recurse -Force
}

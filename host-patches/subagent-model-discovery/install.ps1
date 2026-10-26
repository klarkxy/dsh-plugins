param(
    [Parameter(Mandatory = $true)][string]$Receipt,
    [ValidateSet('check', 'apply', 'restore')][string]$Action = 'check'
)
$ErrorActionPreference = 'Stop'
$record = Get-Content -LiteralPath (Resolve-Path -LiteralPath $Receipt).Path -Raw | ConvertFrom-Json
if ($record.schemaVersion -ne 1) { throw 'Unsupported patch receipt.' }
$target = [System.IO.Path]::GetFullPath($record.original)
$staged = [System.IO.Path]::GetFullPath($record.staged)
if ([System.IO.Path]::GetFileName($target) -ne 'app.asar' -or [System.IO.Path]::GetFileName([System.IO.Path]::GetDirectoryName($target)) -ne 'resources') { throw 'Target must be the reviewed resources/app.asar.' }
$appDirectory = [System.IO.Path]::GetDirectoryName([System.IO.Path]::GetDirectoryName($target))
$executable = Join-Path $appDirectory 'DeepSeek Harness.exe'
if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) { throw 'Target is not a DeepSeek Harness desktop installation.' }
if ($record.originalSha256 -notmatch '^[a-f0-9]{64}$' -or $record.stagedSha256 -notmatch '^[a-f0-9]{64}$') { throw 'Invalid receipt hashes.' }
$backup = "$target.subagent-model-discovery-$($record.originalSha256.Substring(0, 12)).bak"
$temporary = "$target.subagent-model-discovery.next"
$restoredPatch = "$target.subagent-model-discovery-$($record.stagedSha256.Substring(0, 12)).bak"
$targetHash = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()
$stagedHash = (Get-FileHash -LiteralPath $staged -Algorithm SHA256).Hash.ToLowerInvariant()
if ($stagedHash -ne $record.stagedSha256) { throw 'Staged archive changed after verification.' }
if ($targetHash -ne $record.originalSha256 -and $targetHash -ne $record.stagedSha256) { throw 'Installed archive changed; do not overwrite a different release or patch.' }
$running = @(Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue)
Write-Output "Target: $target"
Write-Output "Reviewed patch: $staged"
Write-Output "Original backup: $backup"
Write-Output "Desktop processes: $($running.Count)"
Write-Output "Installed state: $(if ($targetHash -eq $record.stagedSha256) { 'patched' } else { 'original' })"
if ($Action -eq 'check') { return }
if ($running.Count -ne 0) { throw 'Fully quit DeepSeek Harness, including its tray process, then run this command again. No installed files were changed.' }
if (Test-Path -LiteralPath $temporary) { throw "A previous installation candidate exists: $temporary. Inspect it before retrying." }
if ($Action -eq 'apply') {
    if ($targetHash -eq $record.stagedSha256) { Write-Output 'This patch is already installed.'; return }
    if (Test-Path -LiteralPath $backup) { throw 'The original backup already exists. Inspect it before retrying; it will not be overwritten.' }
    $source = $staged
    $expected = $record.stagedSha256
    $replacementBackup = $backup
} else {
    if ($targetHash -eq $record.originalSha256) { Write-Output 'The original archive is already installed.'; return }
    if ((Get-FileHash -LiteralPath $backup -Algorithm SHA256).Hash.ToLowerInvariant() -ne $record.originalSha256) { throw 'Original backup is missing or changed.' }
    if (Test-Path -LiteralPath $restoredPatch) { throw 'A preserved patched archive already exists; it will not be overwritten.' }
    $source = $backup
    $expected = $record.originalSha256
    $replacementBackup = $restoredPatch
}
# All replacement paths are resolved and printed before any move. File.Replace
# atomically keeps the previous archive as a backup; a failed replacement leaves
# the installed archive untouched, and the candidate remains available to inspect.
Write-Output "Replacement candidate: $temporary"
Write-Output "Preserved archive: $replacementBackup"
Copy-Item -LiteralPath $source -Destination $temporary
if ((Get-FileHash -LiteralPath $temporary -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) { throw 'Replacement copy verification failed; installed archive was not changed.' }
if ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant() -ne $targetHash) { throw 'Installed archive changed during preparation; refusing replacement.' }
if (@(Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue).Count -ne 0) { throw 'DeepSeek Harness restarted during preparation; refusing replacement.' }
[System.IO.File]::Replace($temporary, $target, $replacementBackup, $false)
if ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) { throw 'Post-install verification failed. Preserve the backup and restore before launching.' }
Write-Output "Completed: $Action. All archive hashes verified. You may start DeepSeek Harness now."

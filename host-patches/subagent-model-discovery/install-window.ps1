param(
    [Parameter(Mandatory = $true)][string]$Receipt
)
$ErrorActionPreference = 'Stop'
$Host.UI.RawUI.WindowTitle = 'DSH 子代理模型发现修复'
$receiptPath = (Resolve-Path -LiteralPath $Receipt).Path
$record = Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json
$installer = Join-Path $PSScriptRoot 'install.ps1'
$executable = Join-Path ([System.IO.Path]::GetDirectoryName([System.IO.Path]::GetDirectoryName($record.original))) 'DeepSeek Harness.exe'
Write-Host '修复已通过测试。此窗口负责安装，不会强制关闭应用。' -ForegroundColor Cyan
Write-Host '请先保存工作，完全退出 DeepSeek Harness（包括托盘进程）。'
Write-Host '退出后回到本窗口按回车。安装成功将自动重新打开应用。'
try {
    & $installer -Receipt $receiptPath -Action check
    do {
        $null = Read-Host '完全退出后按回车继续；按 Ctrl+C 取消'
        $running = @(Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue)
        if ($running.Count -ne 0) { Write-Host 'DeepSeek Harness 仍在运行，请先退出，之后再按回车。' -ForegroundColor Yellow }
    } while ($running.Count -ne 0)
    & $installer -Receipt $receiptPath -Action apply
    $installed = (Get-FileHash -LiteralPath $record.original -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($installed -ne $record.stagedSha256) { throw '安装后的文件校验失败，未启动应用。' }
    @{ installedAt = (Get-Date).ToString('o'); archiveSha256 = $installed; status = 'installed' } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path (Split-Path -Parent $receiptPath) 'installed.json') -Encoding utf8NoBOM
    Start-Process -FilePath $executable
    Write-Host '安装成功，已重新启动 DeepSeek Harness。请回到原会话，发送“继续验证修复”。' -ForegroundColor Green
    Write-Host '如需回滚，退出应用后运行：'
    Write-Host ('& "{0}" -Receipt "{1}" -Action restore' -f $installer, $receiptPath)
} catch {
    Write-Host ('未完成安装：{0}' -f $_.Exception.Message) -ForegroundColor Red
    Write-Host '不要删除原始备份。当前窗口和补丁文件均已保留，可检查后重试。'
}
$null = Read-Host '按回车关闭此窗口'

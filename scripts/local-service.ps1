param(
  [ValidateSet('Start', 'Stop', 'Status')][string]$Action = 'Start',
  [switch]$NoBrowser,
  [switch]$ForceBuild
)

$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$entryPath = Join-Path $projectRoot 'server\index.mjs'
$runtimeOnly = !(Test-Path -LiteralPath (Join-Path $projectRoot 'src') -PathType Container)
$runtimeDir = Join-Path $projectRoot 'qa\runtime'
$statePath = Join-Path $runtimeDir 'service.json'
$siteUrl = 'http://127.0.0.1:3001'
$sha = [Security.Cryptography.SHA256]::Create()
try { $projectKey = [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($projectRoot.ToLowerInvariant()))).Replace('-', '') }
finally { $sha.Dispose() }
$mutex = New-Object Threading.Mutex($false, ('Local\VehicleSite_' + $projectKey))
$hasLock = $false

function Read-ServiceState {
  if (Test-Path -LiteralPath $statePath -PathType Leaf) {
    return (Get-Content -LiteralPath $statePath -Raw -Encoding UTF8 | ConvertFrom-Json)
  }
  return $null
}
function Find-Process([int]$ProcessId) {
  return Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
}
function Is-ProjectProcess($Process) {
  if (!$Process -or !$Process.CommandLine -or $Process.Name -ne 'node.exe') { return $false }
  $commandPattern = '^(?:"[^"\r\n]*\\node\.exe"|[^\s"]*\\node\.exe|node\.exe)\s+"?' + [Regex]::Escape($entryPath) + '"?\s*$'
  return [Regex]::IsMatch($Process.CommandLine, $commandPattern, [Text.RegularExpressions.RegexOptions]::IgnoreCase)
}
function Is-RecordedProcess($State, $Process) {
  return $State -and $Process -and (Is-ProjectProcess $Process) -and $State.project -eq $projectRoot -and [string]$State.creationTicks -eq [string]$Process.CreationDate.ToUniversalTime().Ticks
}
function Is-Healthy {
  try { return (Invoke-RestMethod -Uri "$siteUrl/api/health" -TimeoutSec 2).ok -eq $true }
  catch { return $false }
}
function Get-PortOwners {
  return @(Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
}
function Save-ServiceState($Process, [string]$OutputLog, [string]$ErrorLog) {
  $record = [ordered]@{ pid = $Process.ProcessId; project = $projectRoot; entry = $entryPath; creationTicks = [string]$Process.CreationDate.ToUniversalTime().Ticks; port = 3001; outputLog = $OutputLog; errorLog = $ErrorLog; startedAt = (Get-Date).ToString('o') }
  [IO.File]::WriteAllText($statePath, ($record | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
}
function Show-Ready {
  Write-Host "网站已在后台运行：$siteUrl"
  Write-Host "管理后台：$siteUrl/admin"
  Write-Host '关闭此窗口不会停止网站。需要停止时，请双击“停止网站.cmd”。'
  if (!$NoBrowser) { Start-Process -FilePath $siteUrl }
}

try {
  $hasLock = $mutex.WaitOne(0)
  if (!$hasLock) { Write-Host '另一个启动或停止操作正在执行，请稍后重试。'; exit 0 }
  $state = Read-ServiceState
  $recordedProcess = if ($state) { Find-Process ([int]$state.pid) } else { $null }
  if ($Action -eq 'Stop') {
    if (!$state) { Write-Host '没有本启动脚本记录的后台进程；未停止任何其他进程。'; exit 0 }
    if (!$recordedProcess) {
      Remove-Item -LiteralPath $statePath -Force
      Write-Host '网站后台进程已经停止。'; exit 0
    }
    if (!(Is-RecordedProcess $state $recordedProcess)) { throw '记录的 PID 已不属于本项目进程，为避免误停其他程序，本次未执行停止。' }
    Stop-Process -Id ([int]$state.pid) -ErrorAction Stop
    Wait-Process -Id ([int]$state.pid) -Timeout 5 -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $statePath -Force
    Write-Host '网站后台进程已停止，车型和网站设置保留。'; exit 0
  }
  $portOwners = Get-PortOwners
  if ($Action -eq 'Status') {
    if ($state -and (Is-RecordedProcess $state $recordedProcess) -and ($portOwners -contains [int]$state.pid) -and (Is-Healthy)) {
      Write-Host "本项目正在后台运行，PID $($state.pid)，地址 $siteUrl"
    } elseif ($portOwners.Count -gt 0) {
      Write-Host "3001 端口已有进程（PID $($portOwners -join ', ')），但不属于当前有效启动记录。"
    } else { Write-Host '3001 端口未监听，网站未运行。' }
    exit 0
  }
  if ($portOwners.Count -gt 0) {
    foreach ($ownerId in $portOwners) {
      $ownerProcess = Find-Process ([int]$ownerId)
      if (!(Is-ProjectProcess $ownerProcess)) { throw "3001 端口已有另一份网站或其他程序运行（PID $ownerId）。如要运行当前文件夹这份网站，请先在原网站文件夹双击《停止网站.cmd》，再重试。不同文件夹的数据各自独立，本次未启动或停止任何进程。" }
    }
    if (!(Is-Healthy)) { throw '本项目进程已占用 3001 端口，但健康检查失败。未重复启动；请检查 qa/runtime 日志，或停止后重新启动。' }
    if (!(Test-Path -LiteralPath $runtimeDir -PathType Container)) { New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null }
    $existingProcess = Find-Process ([int]$portOwners[0])
    if (!(Is-RecordedProcess $state $existingProcess)) { Save-ServiceState $existingProcess '' '' }
    Show-Ready; exit 0
  }
  if ($state -and (Is-RecordedProcess $state $recordedProcess)) { throw '已记录的本项目进程仍在运行，但未监听 3001 端口。请先检查日志或使用停止脚本，未重复启动。' }
  if (!(Test-Path -LiteralPath $runtimeDir -PathType Container)) { New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null }
  if (!(Test-Path -LiteralPath $entryPath -PathType Leaf)) { throw '找不到 server/index.mjs，请保留完整的网站文件夹后重试。' }
  $buildIndex = Join-Path $projectRoot 'dist\index.html'
  if ($runtimeOnly -and !(Test-Path -LiteralPath $buildIndex -PathType Leaf)) { throw '精简包缺少 dist/index.html，请重新获取完整部署包。' }
  if ($runtimeOnly -and $ForceBuild) { throw '这是已构建的精简运行包，请不要使用 ForceBuild。重新构建需要在原开发项目中执行。' }
  $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
  if (!$nodeCommand) { throw '请先从 https://nodejs.org/ 安装 Node.js 24.15 或更高版本（包含 npm），安装后重新双击“启动网站.cmd”。' }
  $nodeExe = $nodeCommand.Source
  $nodeVersion = (& $nodeExe --version).Trim().TrimStart('v')
  if ([version]$nodeVersion -lt [version]'24.15.0') { throw '请先安装 Node.js 24.15 或更高版本。' }
  $npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if (!$npmCommand) { throw '未找到 npm，请重新安装包含 npm 的 Node.js 24.15 或更高版本。' }
  $npmExe = $npmCommand.Source
  $installStamp = Join-Path $projectRoot 'node_modules\.package-lock.json'
  $packageLock = Join-Path $projectRoot 'package-lock.json'
  $needsInstall = !(Test-Path -LiteralPath (Join-Path $projectRoot 'node_modules\express\package.json')) -or !(Test-Path -LiteralPath (Join-Path $projectRoot 'node_modules\multer\package.json')) -or !(Test-Path -LiteralPath $installStamp)
  if (!$runtimeOnly -and !(Test-Path -LiteralPath (Join-Path $projectRoot 'node_modules\vite\package.json'))) { $needsInstall = $true }
  if (!$needsInstall -and (Get-Item -LiteralPath $packageLock).LastWriteTimeUtc -gt (Get-Item -LiteralPath $installStamp).LastWriteTimeUtc) { $needsInstall = $true }
  Push-Location -LiteralPath $projectRoot
  try {
    if ($needsInstall) {
      if ($runtimeOnly) {
        Write-Host '首次启动精简包：正在安装网站运行依赖，请保持网络连接…'
        & $npmExe ci --omit=dev
      } else {
        Write-Host '正在安装网站运行和构建依赖…'
        & $npmExe ci
      }
      if ($LASTEXITCODE -ne 0) { throw '依赖安装失败，请检查上方错误后重试。' }
    }
    $needsBuild = !$runtimeOnly -and ($ForceBuild -or $needsInstall -or !(Test-Path -LiteralPath $buildIndex -PathType Leaf))
    if (!$runtimeOnly -and !$needsBuild) {
      $buildTime = (Get-Item -LiteralPath $buildIndex).LastWriteTimeUtc
      $inputs = @(Get-ChildItem -LiteralPath (Join-Path $projectRoot 'src') -File -Recurse)
      foreach ($name in @('index.html', 'vite.config.ts', 'tsconfig.json', 'tsconfig.app.json', 'package.json', 'package-lock.json')) {
        $inputPath = Join-Path $projectRoot $name
        if (Test-Path -LiteralPath $inputPath -PathType Leaf) { $inputs += Get-Item -LiteralPath $inputPath }
      }
      $needsBuild = @($inputs | Where-Object { $_.LastWriteTimeUtc -gt $buildTime }).Count -gt 0
    }
    if ($needsBuild) {
      Write-Host '正在构建网站…'
      & $npmExe run build
      if ($LASTEXITCODE -ne 0) { throw '网站构建失败，请检查上方错误后重试。' }
    }
  } finally { Pop-Location }
  $logStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $outputLog = Join-Path $runtimeDir "server-$logStamp.stdout.log"
  $errorLog = Join-Path $runtimeDir "server-$logStamp.stderr.log"
  # This launcher is explicitly for local HTTP use. Production uses its own HTTPS configuration.
  $env:NODE_ENV = 'development'
  $env:HOST = '127.0.0.1'
  $env:API_PORT = '3001'
  $env:PUBLIC_ORIGIN = $siteUrl
  $env:COOKIE_SECURE = 'false'
  $started = Start-Process -FilePath $nodeExe -ArgumentList ('"' + $entryPath + '"') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput $outputLog -RedirectStandardError $errorLog -PassThru
  $newProcess = Find-Process $started.Id
  if (!$newProcess -or !(Is-ProjectProcess $newProcess)) { throw "后台进程未能启动，请查看 $errorLog" }
  Save-ServiceState $newProcess $outputLog $errorLog
  $ready = $false
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    $started.Refresh()
    if ($started.HasExited) { break }
    if ((Get-PortOwners) -contains $started.Id) { if (Is-Healthy) { $ready = $true; break } }
    Start-Sleep -Milliseconds 500
  }
  if (!$ready) { throw "网站尚未通过健康检查，请查看日志：$errorLog。未停止其他进程。" }
  Show-Ready
} catch {
  Write-Host ('操作未完成：' + $_.Exception.Message) -ForegroundColor Red
  exit 1
} finally {
  if ($hasLock) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}

param(
  [switch]$NoBrowser,
  [switch]$WithWorkers
)

$ErrorActionPreference = "Stop"

# Some launch environments expose both PATH and Path. Windows process startup is
# case-insensitive and can fail when both keys are present, so normalize early.
$processPath = [Environment]::GetEnvironmentVariable("Path", "Process")
if (-not $processPath) {
  $processPath = [Environment]::GetEnvironmentVariable("PATH", "Process")
}
if ($processPath) {
  [Environment]::SetEnvironmentVariable("PATH", $null, "Process")
  [Environment]::SetEnvironmentVariable("Path", $processPath, "Process")
}

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$RuntimeDir = Join-Path $ProjectRoot ".signal-hub\runtime"
$LogDir = Join-Path $ProjectRoot ".signal-hub\logs"
$Url = "http://127.0.0.1:3000/"

New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

$NodeCandidates = @(
  (Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"),
  "node.exe"
)

$NodePath = $NodeCandidates | Where-Object {
  try {
    $command = Get-Command $_ -ErrorAction Stop
    Test-Path $command.Source
  } catch {
    $false
  }
} | Select-Object -First 1

if (-not $NodePath) {
  throw "Node.js was not found. Install Node.js or keep the Codex bundled runtime available."
}

function Test-WebReady {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 2
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
  } catch {
    return $false
  }
}

function Read-PidFile {
  param([string]$Path)
  if (-not (Test-Path $Path)) {
    return $null
  }

  $raw = (Get-Content -Path $Path -ErrorAction SilentlyContinue | Select-Object -First 1)
  $pidValue = 0
  if ([int]::TryParse([string]$raw, [ref]$pidValue) -and $pidValue -gt 0) {
    return $pidValue
  }

  return $null
}

function Test-ProcessId {
  param([int]$ProcessId)
  return [bool](Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)
}

function Get-ProjectEnvValue {
  param([string]$Name)
  $processValue = [Environment]::GetEnvironmentVariable($Name, "Process")
  if ($processValue) {
    return $processValue
  }

  $envFiles = @(
    (Join-Path $ProjectRoot ".env.local"),
    (Join-Path $ProjectRoot ".env")
  )

  foreach ($envFile in $envFiles) {
    if (-not (Test-Path $envFile)) {
      continue
    }

    foreach ($line in (Get-Content -Path $envFile -ErrorAction SilentlyContinue)) {
      $trimmed = ([string]$line).Trim()
      if (-not $trimmed -or $trimmed.StartsWith("#")) {
        continue
      }

      $separator = $trimmed.IndexOf("=")
      if ($separator -lt 1) {
        continue
      }

      $key = $trimmed.Substring(0, $separator).Trim()
      if ($key -ne $Name) {
        continue
      }

      return $trimmed.Substring($separator + 1).Trim().Trim('"').Trim("'")
    }
  }

  return $null
}

function Test-EnvEnabled {
  param([string]$Value)
  $normalized = ([string]$Value).Trim().ToLowerInvariant()
  return @("1", "true", "yes", "on") -contains $normalized
}

function Start-ManagedNodeProcess {
  param(
    [string]$Name,
    [string[]]$Arguments,
    [switch]$SkipWhenWebReady,
    [switch]$RestartExisting
  )

  if ($SkipWhenWebReady -and (Test-WebReady)) {
    Write-Host "$Name already responds at $Url"
    return
  }

  $pidFile = Join-Path $RuntimeDir "$Name.pid"
  $existingPid = Read-PidFile -Path $pidFile
  if ($existingPid -and (Test-ProcessId -ProcessId $existingPid)) {
    if ($RestartExisting) {
      Stop-Process -Id $existingPid -Force -ErrorAction SilentlyContinue
      Start-Sleep -Milliseconds 800
    } else {
      Write-Host "$Name already running (PID $existingPid)"
      return
    }
  }

  $stdout = Join-Path $LogDir "$Name.log"
  $stderr = Join-Path $LogDir "$Name.err.log"
  $process = Start-Process `
    -FilePath $NodePath `
    -ArgumentList $Arguments `
    -WorkingDirectory $ProjectRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $stdout `
    -RedirectStandardError $stderr `
    -PassThru

  Set-Content -Path $pidFile -Value $process.Id -Encoding ascii
  Write-Host "Started $Name (PID $($process.Id))"
}

function Stop-ManagedNodeProcess {
  param([string]$Name)

  $pidFile = Join-Path $RuntimeDir "$Name.pid"
  $existingPid = Read-PidFile -Path $pidFile
  if ($existingPid -and (Test-ProcessId -ProcessId $existingPid)) {
    Stop-Process -Id $existingPid -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500
    Write-Host "Stopped local $Name (PID $existingPid)"
  }

  if (Test-Path $pidFile) {
    Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
  }
}

function Wait-ForWeb {
  for ($i = 0; $i -lt 40; $i += 1) {
    if (Test-WebReady) {
      return $true
    }
    Start-Sleep -Seconds 1
  }
  return $false
}

try {
  Push-Location $ProjectRoot

  Start-ManagedNodeProcess `
    -Name "signal-hub-web" `
    -Arguments @("scripts\start-next-dev-inline.mjs") `
    -SkipWhenWebReady

  if (-not $WithWorkers) {
    Stop-ManagedNodeProcess -Name "signal-hub-telegram"
    Stop-ManagedNodeProcess -Name "signal-hub-x-hybrid"
    Stop-ManagedNodeProcess -Name "signal-hub-monitor985"
    Stop-ManagedNodeProcess -Name "signal-hub-alpha-summary"
    Write-Host "Local background workers are disabled. Use -WithWorkers only for deliberate local worker testing."
  } else {
    Start-ManagedNodeProcess `
      -Name "signal-hub-telegram" `
      -Arguments @("--experimental-strip-types", "--experimental-transform-types", "scripts\telegram-pipeline-worker.mjs") `
      -RestartExisting

    $xHybridEnabled = Get-ProjectEnvValue "X_HYBRID_ENABLED"
    if (-not $xHybridEnabled -or (Test-EnvEnabled $xHybridEnabled)) {
      Start-ManagedNodeProcess `
        -Name "signal-hub-x-hybrid" `
        -Arguments @("--experimental-strip-types", "--experimental-transform-types", "scripts\x-hybrid-worker.mjs") `
        -RestartExisting
    } else {
      Write-Host "signal-hub-x-hybrid disabled (X_HYBRID_ENABLED=false)"
    }

    if (Test-EnvEnabled (Get-ProjectEnvValue "MONITOR985_ENABLED")) {
      Start-ManagedNodeProcess `
        -Name "signal-hub-monitor985" `
        -Arguments @("--experimental-strip-types", "--experimental-transform-types", "scripts\monitor985-worker.mjs") `
        -RestartExisting
    } else {
      Write-Host "signal-hub-monitor985 disabled (MONITOR985_ENABLED=false)"
    }

    $alphaSummaryPrewarmEnabled = Get-ProjectEnvValue "AI_SUMMARY_PREWARM_ENABLED"
    if (-not $alphaSummaryPrewarmEnabled -or (Test-EnvEnabled $alphaSummaryPrewarmEnabled)) {
      Start-ManagedNodeProcess `
        -Name "signal-hub-alpha-summary" `
        -Arguments @("--experimental-strip-types", "--experimental-transform-types", "scripts\alpha-summary-worker.mjs") `
        -RestartExisting
    } else {
      Write-Host "signal-hub-alpha-summary disabled (AI_SUMMARY_PREWARM_ENABLED=false)"
    }
  }

  $ready = Wait-ForWeb
  if ($ready) {
    Write-Host "Signal Hub is ready: $Url"
  } else {
    Write-Warning "Signal Hub did not respond within 40 seconds. Check logs in $LogDir"
  }

  if (-not $NoBrowser) {
    Start-Process $Url
  }
} catch {
  Write-Host ""
  Write-Host "Failed to start Signal Hub:" -ForegroundColor Red
  Write-Host $_.Exception.Message -ForegroundColor Red
  Write-Host ""
  Read-Host "Press Enter to close"
  exit 1
} finally {
  Pop-Location -ErrorAction SilentlyContinue
}

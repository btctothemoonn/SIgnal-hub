$ErrorActionPreference = "Stop"

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$LauncherScript = Join-Path $ProjectRoot "scripts\start-signal-hub.ps1"
$Desktop = [Environment]::GetFolderPath("Desktop")
$ShortcutPath = Join-Path $Desktop "启动 Signal Hub.lnk"
$PowerShell = Join-Path $env:WINDIR "System32\WindowsPowerShell\v1.0\powershell.exe"

$Shell = New-Object -ComObject WScript.Shell
$Shortcut = $Shell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = $PowerShell
$Shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$LauncherScript`""
$Shortcut.WorkingDirectory = $ProjectRoot
$Shortcut.Description = "Start Signal Hub dashboard, Telegram worker, and X worker"
$Shortcut.IconLocation = "$PowerShell,0"
$Shortcut.Save()

Write-Host "Created shortcut: $ShortcutPath"

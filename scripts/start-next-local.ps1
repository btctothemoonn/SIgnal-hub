$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $root

$node = "C:\Users\34668\AppData\Local\Programs\nodejs\node.exe"
$env:Path = "C:\Users\34668\AppData\Local\Programs\nodejs;$env:Path"

& $node "node_modules/next/dist/bin/next" "start" *>> ".next-start.log"

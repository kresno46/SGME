$ErrorActionPreference = 'Stop'
$taskRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$taskSource = Join-Path $taskRoot 'infrastructure/browser-dm-sender'
$taskDestination = Join-Path $taskRoot 'apps/dashboard/public/downloads'
New-Item -ItemType Directory -Path $taskDestination -Force | Out-Null
$taskFiles = @('manifest.json', 'popup.html', 'popup.css', 'popup.js', 'worker.js', 'page.js', 'native-input.js', 'diagnostics.js') | ForEach-Object { Join-Path $taskSource $_ }
Compress-Archive -LiteralPath $taskFiles -DestinationPath (Join-Path $taskDestination 'smge-browser-dm-sender.zip') -Force

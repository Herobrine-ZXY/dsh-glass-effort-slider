# Pack this plugin into dist/<name>-<version>.zip (same layout as the GitHub release asset).
# Zero dependencies, no build step: the zip is just the repository contents.
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$pkg = Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json

$dist = Join-Path $root 'dist'
New-Item -ItemType Directory -Force -Path $dist | Out-Null

$zip = Join-Path $dist ('{0}-{1}.zip' -f $pkg.name, $pkg.version)
Remove-Item $zip -ErrorAction SilentlyContinue

$items = Get-ChildItem $root -Force | Where-Object { $_.Name -notin @('dist', '.git', 'node_modules') }
Compress-Archive -Path $items.FullName -DestinationPath $zip -CompressionLevel Optimal

$size = [math]::Round((Get-Item $zip).Length / 1MB, 2)
$count = (Get-ChildItem $root -Recurse -File | Where-Object { $_.FullName -notlike '*\dist\*' }).Count
Write-Host ('packed {0} ({1} MB, {2} files)' -f $zip, $size, $count)
Write-Host 'Attach this zip to a GitHub release; the plugin installs straight from the unpacked folder.'

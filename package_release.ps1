# ==============================================================================
# Tìm Bus Promax - Clean Release Packaging Script
# Excludes node_modules, temp files, and logs
# ==============================================================================

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

# 1. Read version from version.json or package.json
$versionFile = Join-Path $scriptDir "version.json"
if (Test-Path $versionFile) {
    $verObj = Get-Content $versionFile -Raw | ConvertFrom-Json
    $currentVer = $verObj.version
} else {
    $pkgFile = Join-Path $scriptDir "package.json"
    $pkgObj = Get-Content $pkgFile -Raw | ConvertFrom-Json
    $currentVer = $pkgObj.version
}

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  PACKAGING TIM BUS PROMAX - VERSION v$currentVer" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# 2. Prepare release_dist folder
$distDir = Join-Path $scriptDir "release_dist"
if (Test-Path $distDir) {
    Remove-Item -Path $distDir -Recurse -Force
}
New-Item -ItemType Directory -Path $distDir | Out-Null

$tempPackDir = Join-Path $distDir "timbus_promax"
New-Item -ItemType Directory -Path $tempPackDir | Out-Null

# 3. Copy clean source files
Write-Host "[1/4] Sao chep ma nguon sach (loai tru node_modules, log)..." -ForegroundColor Yellow

$includeFiles = @(
    "server.js",
    "package.json",
    "bus_data.json",
    "fleet_83.json",
    "polyline.js",
    "start_app.bat",
    "version.json",
    "README.md"
)

foreach ($f in $includeFiles) {
    $src = Join-Path $scriptDir $f
    if (Test-Path $src) {
        Copy-Item -Path $src -Destination $tempPackDir -Force
    } else {
        Write-Host "  [WARN] File not found: $f" -ForegroundColor Yellow
    }
}

# Copy public folder
$pubDir = Join-Path $scriptDir "public"
if (Test-Path $pubDir) {
    Copy-Item -Path $pubDir -Destination $tempPackDir -Recurse -Force
}

# 4. Create ZIP archives
Write-Host "[2/4] Dong goi file ZIP phat hanh..." -ForegroundColor Yellow

$zipVerName = "timbus_promax_v$currentVer.zip"
$zipLatestName = "timbus_promax_latest.zip"

$zipVerPath = Join-Path $distDir $zipVerName
$zipLatestPath = Join-Path $distDir $zipLatestName

Compress-Archive -Path "$tempPackDir\*" -DestinationPath $zipVerPath -Force
Copy-Item -Path $zipVerPath -Destination $zipLatestPath -Force

# 5. Export release version.json
Write-Host "[3/4] Tao file thong tin cap nhat version.json..." -ForegroundColor Yellow
$destVersionJson = Join-Path $distDir "version.json"
Copy-Item -Path $versionFile -Destination $destVersionJson -Force

# Clean temporary packaging directory
Remove-Item -Path $tempPackDir -Recurse -Force

Write-Host "[4/4] Hoan tat dong goi ban cap nhat!" -ForegroundColor Green
Write-Host "----------------------------------------------------------" -ForegroundColor Gray
Write-Host "  File phien ban:  $zipVerPath" -ForegroundColor White
Write-Host "  File latest:     $zipLatestPath" -ForegroundColor White
Write-Host "  File manifest:   $destVersionJson" -ForegroundColor White
Write-Host "==========================================================" -ForegroundColor Green

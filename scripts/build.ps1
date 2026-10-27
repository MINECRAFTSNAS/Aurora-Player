#!/usr/bin/env powershell
# 一键构建：类型检查 -> 编译 -> 打包 exe -> 验证
# 用法：pwsh -File scripts/build.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root

# ELECTRON_RUN_AS_NODE 会让 Electron 退化为纯 Node，必须清除
Remove-Item env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue

# 国内网络镜像
$env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
$env:ELECTRON_BUILDER_BINARIES_MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries/'

Write-Host '==> 生成图标' -ForegroundColor Cyan
python scripts/make_icon.py

Write-Host '==> 类型检查' -ForegroundColor Cyan
npx tsc --noEmit -p tsconfig.node.json
npx tsc --noEmit -p tsconfig.web.json

Write-Host '==> 编译' -ForegroundColor Cyan
npx electron-vite build

Write-Host '==> 打包 exe' -ForegroundColor Cyan
npx electron-builder --win --x64

Write-Host '==> 验证打包产物' -ForegroundColor Cyan
node scripts/verify-packaged.cjs
node scripts/verify-packaged.cjs "$root\release\Aurora Player-1.0.0-portable.exe"

Write-Host ''
Write-Host '构建完成，产物位于 release/：' -ForegroundColor Green
Get-ChildItem release -File -Filter *.exe |
  Select-Object Name, @{ N = 'SizeMB'; E = { [math]::Round($_.Length / 1MB, 1) } } |
  Format-Table -AutoSize

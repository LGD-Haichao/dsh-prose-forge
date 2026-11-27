<#
.SYNOPSIS
  在 github.com:443 不通、但 api.github.com 可达时，用 Git 数据 API 把最新一次提交推上去。

.DESCRIPTION
  流程：读远端 main 的父提交 -> 逐个上传 blob -> 拼新 tree -> 建 commit -> 更新 ref。
  token 从 git credential 读，不打印、不落盘。

.PARAMETER Repo
  仓库全名，默认 LGD-Haichao/dsh-prose-forge。

.PARAMETER ApiIp
  api.github.com 的可解析地址。网络有污染时传一个可用 IP。

.EXAMPLE
  powershell -File scripts/push-via-api.ps1 -ApiIp 140.82.113.5
#>
param(
  [string]$Repo = 'LGD-Haichao/dsh-prose-forge',
  [string]$ApiIp = ''
)

$ErrorActionPreference = 'Stop'
$api = "https://api.github.com/repos/$Repo"
$resolveArgs = @()
if ($ApiIp -ne '') { $resolveArgs = @('--resolve', "api.github.com:443:$ApiIp") }

$payload = "protocol=https`nhost=github.com`n`n"
$cred = $payload | git credential fill 2>$null
$token = ($cred | Where-Object { $_ -like 'password=*' }) -replace '^password=', ''
if (-not $token) { throw '读不到 token。先让 git push 成功一次，凭据管理器里就会存好。' }

$tmp = Join-Path $env:TEMP ('ghapi-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp -Force | Out-Null
$utf8 = New-Object System.Text.UTF8Encoding($false)

$headers = @('-H', "Authorization: Bearer $token", '-H', 'Accept: application/vnd.github+json')

$refJson = curl.exe -sS --ssl-no-revoke --max-time 45 @resolveArgs @headers "$api/git/ref/heads/main"
$base = ($refJson | ConvertFrom-Json).object.sha
if (-not $base) { throw "取远端 ref 失败：$refJson" }
$baseJson = curl.exe -sS --ssl-no-revoke --max-time 45 @resolveArgs @headers "$api/git/commits/$base"
$baseTree = ($baseJson | ConvertFrom-Json).tree.sha
Write-Output "远端当前提交: $base"

$files = git show --name-only --pretty=format: HEAD | Where-Object { $_ -ne '' }
Write-Output "本次涉及文件: $($files -join ', ')"

$treeParts = @()
foreach ($file in $files) {
  $full = Join-Path (Get-Location) $file
  if (-not (Test-Path -LiteralPath $full)) { throw "文件不存在：$file" }
  $b64 = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($full))
  $bodyFile = Join-Path $tmp 'blob.json'
  [System.IO.File]::WriteAllText($bodyFile, ('{"content":"' + $b64 + '","encoding":"base64"}'), $utf8)
  $resp = curl.exe -sS --ssl-no-revoke --max-time 90 @resolveArgs -X POST @headers --data-binary "@$bodyFile" "$api/git/blobs"
  $sha = ($resp | ConvertFrom-Json).sha
  if (-not $sha) { throw "blob 上传失败 $file : $resp" }
  $treeParts += ('{"path":"' + $file.Replace('\', '/') + '","mode":"100644","type":"blob","sha":"' + $sha + '"}')
  Write-Output "  blob $file"
}

$treeFile = Join-Path $tmp 'tree.json'
[System.IO.File]::WriteAllText($treeFile, ('{"base_tree":"' + $baseTree + '","tree":[' + ($treeParts -join ',') + ']}'), $utf8)
$treeSha = ((curl.exe -sS --ssl-no-revoke --max-time 90 @resolveArgs -X POST @headers --data-binary "@$treeFile" "$api/git/trees") | ConvertFrom-Json).sha
if (-not $treeSha) { throw '建 tree 失败' }

$message = (git log -1 --pretty=%B).Trim()
$message = $message.Replace('\', '\\').Replace('"', '\"').Replace("`r`n", '\n').Replace("`n", '\n')
$commitFile = Join-Path $tmp 'commit.json'
[System.IO.File]::WriteAllText($commitFile, ('{"message":"' + $message + '","tree":"' + $treeSha + '","parents":["' + $base + '"]}'), $utf8)
$commitSha = ((curl.exe -sS --ssl-no-revoke --max-time 90 @resolveArgs -X POST @headers --data-binary "@$commitFile" "$api/git/commits") | ConvertFrom-Json).sha
if (-not $commitSha) { throw '建 commit 失败' }

$refFile = Join-Path $tmp 'ref.json'
[System.IO.File]::WriteAllText($refFile, ('{"sha":"' + $commitSha + '","force":false}'), $utf8)
$newRef = ((curl.exe -sS --ssl-no-revoke --max-time 90 @resolveArgs -X PATCH @headers --data-binary "@$refFile" "$api/git/refs/heads/main") | ConvertFrom-Json).object.sha

Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
Write-Output "远端 main -> $newRef"
Write-Output "本地 tree: $(git rev-parse 'HEAD^{tree}')"
Write-Output "远端 tree: $treeSha"
Write-Output '提交号会不同，内容一致。网络恢复后 git fetch && git reset --hard origin/main 对齐。'

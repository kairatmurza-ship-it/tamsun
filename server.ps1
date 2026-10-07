$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$root = $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($root)) {
  $root = Split-Path -Parent $MyInvocation.MyCommand.Path
}
$port = 8765
if ($env:TAMSUN_PORT -match '^\d+$') {
  $parsedPort = [int]$env:TAMSUN_PORT
  if ($parsedPort -ge 1 -and $parsedPort -le 65535) { $port = $parsedPort }
}
$bind = "127.0.0.1"
if ($env:TAMSUN_BIND -match '^[A-Za-z0-9.\-]+$' -or $env:TAMSUN_BIND -eq '+' -or $env:TAMSUN_BIND -eq '*') {
  $bind = $env:TAMSUN_BIND
}
$prefix = "http://{0}:{1}/" -f $bind, $port

function Import-TamsunEnv([string]$file) {
  if (-not (Test-Path -LiteralPath $file)) { return }
  foreach ($line in [IO.File]::ReadAllLines($file)) {
    $text = ([string]$line).Trim()
    if ($text.Length -eq 0 -or $text.StartsWith("#")) { continue }
    $eq = $text.IndexOf("=")
    if ($eq -lt 1) { continue }
    $name = $text.Substring(0, $eq).Trim()
    if ($name -notmatch '^[A-Za-z_][A-Za-z0-9_]*$') { continue }
    if (-not [string]::IsNullOrEmpty([Environment]::GetEnvironmentVariable($name, "Process"))) { continue }
    $value = $text.Substring($eq + 1).Trim()
    if ($value.Length -ge 2) {
      $quote = $value.Substring(0, 1)
      if (($quote -eq '"' -or $quote -eq "'") -and $value.EndsWith($quote)) {
        $value = $value.Substring(1, $value.Length - 2)
      }
    }
    [Environment]::SetEnvironmentVariable($name, $value, "Process")
  }
}

function Get-TamsunHostName([string]$raw) {
  $text = ([string]$raw).Trim().ToLowerInvariant()
  if ($text.StartsWith("[")) {
    $end = $text.IndexOf("]")
    if ($end -gt 1) { return $text.Substring(1, $end - 1) }
  }
  $colon = $text.LastIndexOf(":")
  if ($colon -gt 0 -and $text.IndexOf(":") -eq $colon) { return $text.Substring(0, $colon) }
  return $text
}

function Test-TamsunAllowedHost([string]$name) {
  if ([string]::IsNullOrWhiteSpace($name)) { return $false }
  if ($name -eq "127.0.0.1" -or $name -eq "localhost" -or $name -eq "::1") { return $true }
  foreach ($item in ([string]$env:TAMSUN_HOSTS).Split(",")) {
    $allowed = Get-TamsunHostName $item
    if ($allowed -and $allowed -eq $name) { return $true }
  }
  return $false
}

function Test-TamsunOrigin([string]$origin) {
  try {
    $uri = [Uri]$origin
    if ($uri.Scheme -ne "http" -and $uri.Scheme -ne "https") { return $false }
    return (Test-TamsunAllowedHost $uri.Host.ToLowerInvariant())
  } catch {
    return $false
  }
}

function Add-Cors($ctx) {
  try {
    $ctx.Response.Headers["X-Content-Type-Options"] = "nosniff"
    $ctx.Response.Headers["X-Frame-Options"] = "SAMEORIGIN"
    $ctx.Response.Headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    $origin = ""
    try { $origin = [string]$ctx.Request.Headers["Origin"] } catch {}
    if ($origin -and (Test-TamsunOrigin $origin)) {
      $ctx.Response.Headers["Access-Control-Allow-Origin"] = $origin
      $ctx.Response.Headers["Vary"] = "Origin"
      $ctx.Response.Headers["Access-Control-Allow-Headers"] = "Content-Type, X-Admin-Token, If-None-Match"
      $ctx.Response.Headers["Access-Control-Expose-Headers"] = "ETag"
      $ctx.Response.Headers["Access-Control-Allow-Methods"] = "GET, POST, PATCH, DELETE, OPTIONS"
    }
  } catch {}
}

function Write-Json($ctx, $status, $obj) {
  $json = $obj | ConvertTo-Json -Compress -Depth 8
  $bytes = [Text.Encoding]::UTF8.GetBytes($json)
  Add-Cors $ctx
  $ctx.Response.StatusCode = $status
  $ctx.Response.ContentType = "application/json; charset=utf-8"
  $ctx.Response.ContentLength64 = $bytes.Length
  $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
}

function Write-RawJson($ctx, $status, $jsonText) {
  if (-not $jsonText) { $jsonText = '{"error":"unavailable"}' }
  $bytes = [Text.Encoding]::UTF8.GetBytes([string]$jsonText)
  Add-Cors $ctx
  $ctx.Response.StatusCode = $status
  $ctx.Response.ContentType = "application/json; charset=utf-8"
  $ctx.Response.ContentLength64 = $bytes.Length
  $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
}

function Get-NodeExe {
  if (-not [string]::IsNullOrWhiteSpace($env:TAMSUN_NODE) -and (Test-Path -LiteralPath $env:TAMSUN_NODE)) { return $env:TAMSUN_NODE }
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd -and $cmd.Source) { return $cmd.Source }
  $portable = Join-Path $env:LOCALAPPDATA "nodejs-portable"
  if (Test-Path -LiteralPath $portable) {
    $found = Get-ChildItem -LiteralPath $portable -Filter node.exe -Recurse -Depth 2 -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($found) { return $found.FullName }
  }
  $candidates = @(
    (Join-Path $env:ProgramFiles "nodejs\node.exe"),
    (Join-Path $env:LOCALAPPDATA "Programs\cursor\resources\app\resources\helpers\node.exe")
  )
  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path $candidate)) { return $candidate }
  }
  return "node"
}

function Invoke-AiCore($serverRoot, $rawJson) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = Get-NodeExe
  $psi.Arguments = "ai/cli.mjs"
  $psi.WorkingDirectory = $serverRoot
  $psi.UseShellExecute = $false
  $psi.RedirectStandardInput = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.CreateNoWindow = $true
  $utf8 = New-Object System.Text.UTF8Encoding $false
  $psi.StandardOutputEncoding = $utf8
  $psi.StandardErrorEncoding = $utf8
  $proc = New-Object System.Diagnostics.Process
  $proc.StartInfo = $psi
  [void]$proc.Start()
  try {
    $bytes = $utf8.GetBytes([string]$rawJson)
    $proc.StandardInput.BaseStream.Write($bytes, 0, $bytes.Length)
    $proc.StandardInput.Close()
    $outBuffer = New-Object System.IO.MemoryStream
    $errBuffer = New-Object System.IO.MemoryStream
    $outCopy = $proc.StandardOutput.BaseStream.CopyToAsync($outBuffer)
    $errCopy = $proc.StandardError.BaseStream.CopyToAsync($errBuffer)
    if (-not $proc.WaitForExit(25000)) {
      try { $proc.Kill() } catch {}
      Write-TamsunErrorLog "ai_timeout"
      return @{ status = 502; raw = '{"error":"unavailable"}' }
    }
    try { $outCopy.Wait(5000) } catch {}
    try { $errCopy.Wait(5000) } catch {}
    $stdout = $utf8.GetString($outBuffer.ToArray())
    $stderr = $utf8.GetString($errBuffer.ToArray())
    if ($stderr) { Write-TamsunErrorLog ("ai_stderr bytes=" + $stderr.Length) }
    if ($proc.ExitCode -ne 0) { Write-TamsunErrorLog ("ai_exit_" + $proc.ExitCode) }
    $split = $stdout.IndexOf([char]10)
    if ($split -lt 1) { return @{ status = 502; raw = '{"error":"unavailable"}' } }
    $statusText = $stdout.Substring(0, $split).Trim()
    $status = 502
    $parsedStatus = 0
    if ([int]::TryParse($statusText, [ref]$parsedStatus)) { $status = $parsedStatus }
    $body = $stdout.Substring($split + 1).Trim()
    if (-not $body) { $body = '{"error":"unavailable"}' }
    return @{ status = $status; raw = $body }
  } catch {
    try { if (-not $proc.HasExited) { $proc.Kill() } } catch {}
    return @{ status = 502; raw = '{"error":"unavailable"}' }
  }
}

function Read-LimitedBody($request, [int]$maxBytes) {
  $length = $request.ContentLength64
  if ($length -gt $maxBytes) { return @{ error = "too_large"; raw = "" } }
  return Read-TamsunStream $request.InputStream $maxBytes 5000
}

function Test-TamsunRequestHost($ctx) {
  $hostName = ""
  try { $hostName = [string]$ctx.Request.Headers["Host"] } catch {}
  if ([string]::IsNullOrWhiteSpace($hostName)) {
    try { $hostName = [string]$ctx.Request.UserHostName } catch {}
  }
  return (Test-TamsunAllowedHost (Get-TamsunHostName $hostName))
}

function Test-ChatRate {
  $now = [DateTime]::UtcNow
  if ($null -eq $script:ChatPostTimes) { $script:ChatPostTimes = @() }
  $fresh = New-Object System.Collections.Generic.List[datetime]
  foreach ($time in @($script:ChatPostTimes)) {
    if ([DateTime]$time -gt $now.AddMinutes(-1)) { [void]$fresh.Add([DateTime]$time) }
  }
  if ($fresh.Count -ge 30) {
    $script:ChatPostTimes = $fresh.ToArray()
    return $false
  }
  [void]$fresh.Add($now)
  $script:ChatPostTimes = $fresh.ToArray()
  return $true
}

function Limit-ChatText($value, [int]$max) {
  $text = ([string]$value).Trim()
  if ($text.Length -gt $max) { return $text.Substring(0, $max) }
  return $text
}

function Merge-ChatCatalog([string]$rawJson) {
  $payload = $rawJson | ConvertFrom-Json
  Initialize-TamsunDb
  $catalog = (Get-TamsunCatalogJson) | ConvertFrom-Json
  $products = New-Object System.Collections.Generic.List[object]
  foreach ($item in @($catalog.products)) {
    if ($null -eq $item) { continue }
    $visible = $true
    if ($null -ne $item.visible) { $visible = [bool]$item.visible }
    if (-not $visible) { continue }
    $name = Limit-ChatText $item.name 160
    if (-not $name) { continue }
    $price = 0
    try { $price = [int]$item.priceKzt } catch { $price = 0 }
    [void]$products.Add(@{
      id = Limit-ChatText $item.id 80
      name = $name
      description = Limit-ChatText $item.description 400
      priceKzt = $price
      size = Limit-ChatText $item.size 80
      material = Limit-ChatText $item.material 80
      origin = Limit-ChatText $item.origin 80
    })
  }
  $services = New-Object System.Collections.Generic.List[object]
  foreach ($item in @($catalog.services)) {
    if ($null -eq $item) { continue }
    $visible = $true
    if ($null -ne $item.visible) { $visible = [bool]$item.visible }
    if (-not $visible) { continue }
    $title = Limit-ChatText $item.title 160
    if (-not $title) { continue }
    [void]$services.Add(@{
      title = $title
      description = Limit-ChatText $item.description 400
    })
  }
  $messages = New-Object System.Collections.Generic.List[object]
  foreach ($item in @($payload.messages)) {
    if ($null -ne $item) { [void]$messages.Add($item) }
  }
  $attachments = New-Object System.Collections.Generic.List[object]
  foreach ($item in @($payload.attachments)) {
    if ($null -ne $item) { [void]$attachments.Add($item) }
  }
  $focus = New-Object System.Collections.Generic.List[string]
  foreach ($id in @($payload.focusIds)) {
    if ($null -eq $id) { continue }
    $text = Limit-ChatText $id 80
    if ($text) { [void]$focus.Add($text) }
  }
  $currency = "kzt"
  if ([string]$payload.currency -eq "usd") { $currency = "usd" }
  $rate = 500
  try { $rate = [int]$catalog.settings.usdRate } catch { $rate = 500 }
  if ($rate -lt 1) { $rate = 500 }
  $body = @{
    messages = $messages.ToArray()
    attachments = $attachments.ToArray()
    products = $products.ToArray()
    services = $services.ToArray()
    currency = $currency
    usdRate = $rate
    focusIds = $focus.ToArray()
  }
  return ($body | ConvertTo-Json -Compress -Depth 8)
}

function Start-TamsunChatWorker {
  if ($script:ChatWorkerStarted) { return }
  $script:ChatWorkerStarted = $true
  $script:ChatQueue = [System.Collections.Concurrent.ConcurrentQueue[object]]::new()
  $script:ChatSlots = [System.Threading.SemaphoreSlim]::new(1, 1)
  $rs = [runspacefactory]::CreateRunspace()
  $rs.Open()
  $ps = [powershell]::Create()
  $ps.Runspace = $rs
  $script:ChatRunspace = $rs
  $script:ChatWorker = $ps
  $worker = {
    param($serverRoot, $queue, $slots)
    $ready = $false
    try {
      $global:TamsunAsLibrary = $true
      . (Join-Path $serverRoot "server.ps1")
      Initialize-TamsunDb
      $ready = $true
    } catch {
      Write-Output ("chat_worker_load " + $_.Exception.GetType().Name)
    }
    while ($true) {
      $job = $null
      $hasJob = $false
      try { $hasJob = $queue.TryDequeue([ref]$job) } catch { $hasJob = $false }
      if (-not $hasJob -or $null -eq $job) {
        Start-Sleep -Milliseconds 40
        continue
      }
      try {
        if (-not $ready) {
          try {
            Initialize-TamsunDb
            $ready = $true
          } catch {
            Write-Json $job.Ctx 502 @{ error = "unavailable" }
            continue
          }
        }
        $safe = $null
        try { $safe = Merge-ChatCatalog $job.Raw } catch { $safe = $null }
        if (-not $safe) {
          Write-Json $job.Ctx 502 @{ error = "unavailable" }
        } else {
          $reply = Invoke-AiCore $serverRoot $safe
          Write-RawJson $job.Ctx ([int]$reply.status) ([string]$reply.raw)
        }
      } catch {
        try { Write-Json $job.Ctx 500 @{ error = "unavailable" } } catch {}
      } finally {
        try { $job.Ctx.Response.Close() } catch {}
        try { [void]$slots.Release() } catch {}
      }
    }
  }
  [void]$ps.AddScript($worker).AddArgument($root).AddArgument($script:ChatQueue).AddArgument($script:ChatSlots)
  [void]$ps.BeginInvoke()
}

function Ensure-TamsunChatWorker {
  $state = ""
  if ($script:ChatWorker) { $state = [string]$script:ChatWorker.InvocationStateInfo.State }
  if ($state -eq "Running" -or $state -eq "NotStarted") { return }
  if ($script:ChatQueue) {
    $job = $null
    while ($script:ChatQueue.TryDequeue([ref]$job)) {
      try { Write-Json $job.Ctx 503 @{ error = "unavailable" } } catch {}
      try { $job.Ctx.Response.Close() } catch {}
    }
  }
  try { if ($script:ChatWorker) { $script:ChatWorker.Dispose() } } catch {}
  try { if ($script:ChatRunspace) { $script:ChatRunspace.Dispose() } } catch {}
  $script:ChatWorker = $null
  $script:ChatRunspace = $null
  $script:ChatWorkerStarted = $false
  Start-TamsunChatWorker
}

. (Join-Path $root "orders-db.ps1")
if (-not $global:TamsunAsLibrary) {
Import-TamsunEnv (Join-Path $root ".env")
if ([string]::IsNullOrWhiteSpace([string]$env:ADMIN_PASSWORD)) {
  Write-Output "Критическая ошибка: ADMIN_PASSWORD не задан в переменных окружения"
  exit 1
}
Initialize-TamsunDb
Initialize-TamsunCatalog
Sync-TamsunClients
Start-TamsunChatWorker

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($prefix)
$listener.Start()
Write-Output "listening $prefix"

$types = @{
  ".html" = "text/html; charset=utf-8"
  ".css" = "text/css; charset=utf-8"
  ".js" = "text/javascript; charset=utf-8"
  ".mjs" = "text/javascript; charset=utf-8"
  ".json" = "application/json; charset=utf-8"
  ".jpg" = "image/jpeg"
  ".jpeg" = "image/jpeg"
  ".png" = "image/png"
  ".gif" = "image/gif"
  ".mp4" = "video/mp4"
  ".webm" = "video/webm"
  ".webp" = "image/webp"
  ".svg" = "image/svg+xml"
  ".ico" = "image/x-icon"
  ".woff2" = "font/woff2"
}
$dist = Join-Path $root "dist"
$mediaExt = @(".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".mp4", ".webm", ".ico")

while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $handed = $false
  $tookSlot = $false
  try {
    Add-Cors $ctx
    $path = [Uri]::UnescapeDataString($ctx.Request.Url.LocalPath)
    if (-not (Test-TamsunRequestHost $ctx)) {
      Write-Json $ctx 403 @{ error = "forbidden" }
    } elseif ($ctx.Request.HttpMethod -eq "OPTIONS") {
      $ctx.Response.StatusCode = 204
    } elseif ($path -eq "/api/chat" -and $ctx.Request.HttpMethod -eq "POST") {
      Ensure-TamsunChatWorker
      $read = Read-LimitedBody $ctx.Request 12000000
      if ($read.error -eq "too_large") {
        Write-Json $ctx 413 @{ error = "too_large" }
      } elseif ($read.error -eq "timeout") {
        Write-Json $ctx 408 @{ error = "timeout"; message = "Превышено время ожидания запроса." }
      } elseif ($read.error) {
        Write-Json $ctx 503 @{ error = "unavailable" }
      } elseif (-not (Test-ChatRate)) {
        Write-Json $ctx 429 @{ error = "rate" }
      } elseif ($null -eq $script:ChatSlots -or -not $script:ChatSlots.Wait(0)) {
        Write-Json $ctx 503 @{ error = "unavailable" }
      } else {
        $tookSlot = $true
        $script:ChatQueue.Enqueue(@{ Ctx = $ctx; Raw = $read.raw })
        $handed = $true
      }
    } elseif (Handle-TamsunOrderApi $ctx) {
    } else {
      $parts = New-Object System.Collections.Generic.List[string]
      foreach ($seg in (($path.TrimStart("/") -replace '\\','/') -split '/')) {
        if ($seg -eq '' -or $seg -eq '.') { continue }
        if ($seg -eq '..') {
          if ($parts.Count -gt 0) { $parts.RemoveAt($parts.Count - 1) }
          continue
        }
        $parts.Add($seg)
      }
      $rel = ($parts -join '/')
      $leaf = if ($parts.Count -gt 0) { $parts[$parts.Count - 1] } else { '' }
      $blocked = $false
      foreach ($seg in $parts) {
        if ($seg -match '(?i)^(data|src|node_modules|ai)$') { $blocked = $true }
      }
      if (-not $blocked) {
        $blocked = $leaf -match '(?i)^\.(env|git)' -or $rel -match '(?i)\.(ps1|db|sqlite|sqlite3|jsx)$' -or $rel -match '(?i)^(package(-lock)?\.json|vite\.config\.js)$'
      }
      $fullRoot = [IO.Path]::GetFullPath($root)
      $fullDist = [IO.Path]::GetFullPath($dist)
      function Test-Inside($base, $candidate) {
        $full = [IO.Path]::GetFullPath($candidate)
        $rootFull = [IO.Path]::GetFullPath($base)
        if (-not $rootFull.EndsWith([IO.Path]::DirectorySeparatorChar)) { $rootFull = $rootFull + [IO.Path]::DirectorySeparatorChar }
        return $full.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase) -or ($full.TrimEnd('\','/') -eq $rootFull.TrimEnd('\','/'))
      }
      function Send-File($fullFile) {
        $stream = [IO.File]::Open($fullFile, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
        try {
          $ext = [IO.Path]::GetExtension($fullFile).ToLower()
          if ($types.ContainsKey($ext)) { $ctx.Response.ContentType = $types[$ext] } else { $ctx.Response.ContentType = "application/octet-stream" }
          if ($fullFile -match '[\\/]assets[\\/]') {
            $ctx.Response.Headers["Cache-Control"] = "public, max-age=31536000, immutable"
          } elseif ($ext -eq ".html") {
            $ctx.Response.Headers["Cache-Control"] = "no-cache"
          }
          $ctx.Response.ContentLength64 = $stream.Length
          $buffer = New-Object byte[] 65536
          while ($true) {
            $read = $stream.Read($buffer, 0, $buffer.Length)
            if ($read -le 0) { break }
            $ctx.Response.OutputStream.Write($buffer, 0, $read)
          }
        } finally {
          $stream.Dispose()
        }
      }
      $served = $false
      if ($blocked) {
        $ctx.Response.StatusCode = 404
        $served = $true
      }
      if (-not $served -and -not [string]::IsNullOrWhiteSpace($rel)) {
        $distFile = Join-Path $dist $rel
        if ((Test-Inside $fullDist $distFile) -and (Test-Path $distFile -PathType Leaf)) {
          Send-File $distFile
          $served = $true
        }
      }
      if (-not $served -and -not [string]::IsNullOrWhiteSpace($rel)) {
        $ext = [IO.Path]::GetExtension($rel).ToLower()
        $siteFile = Join-Path $root $rel
        if ($mediaExt -contains $ext -and (Test-Inside $fullRoot $siteFile) -and (Test-Path $siteFile -PathType Leaf)) {
          Send-File $siteFile
          $served = $true
        }
      }
      if (-not $served) {
        $ext = ""
        if (-not [string]::IsNullOrWhiteSpace($rel)) { $ext = [IO.Path]::GetExtension($rel).ToLower() }
        $spa = [string]::IsNullOrWhiteSpace($rel) -or $ext -eq "" -or $ext -eq ".html"
        $indexFile = Join-Path $dist "index.html"
        if ($spa -and (Test-Path $indexFile -PathType Leaf)) {
          Send-File $indexFile
          $served = $true
        }
      }
      if (-not $served) { $ctx.Response.StatusCode = 404 }
    }
  } catch {
    if ($tookSlot -and -not $handed) {
      try { [void]$script:ChatSlots.Release() } catch {}
    }
    $route = ""
    try { $route = ([string]$ctx.Request.HttpMethod) + " " + ([string]$ctx.Request.Url.LocalPath) } catch {}
    Write-TamsunErrorLog ("server_error " + $route + " " + $_.Exception.GetType().Name)
    try { Write-Json $ctx 500 @{ error = "server_error" } } catch {}
  } finally {
    if (-not $handed) {
      try { $ctx.Response.Close() } catch {}
    }
  }
}
}

function Initialize-TamsunDb {
  if (-not ("System.Data.SQLite.SQLiteConnection" -as [type])) {
    $lib = Join-Path $root "lib"
    if (-not [string]::IsNullOrWhiteSpace($env:TAMSUN_SQLITE_LIB)) { $lib = $env:TAMSUN_SQLITE_LIB }
    [Environment]::SetEnvironmentVariable("PreLoadSQLite_BaseDirectory", $lib)
    Add-Type -Path (Join-Path $lib "System.Data.SQLite.dll")
  }
  [void](Open-TamsunDb)
}

function Open-TamsunDb {
  if ($global:TamsunDb -and $global:TamsunDb.State -eq [System.Data.ConnectionState]::Open) {
    return $global:TamsunDb
  }
  $dir = Join-Path $root "data"
  if (-not (Test-Path $dir)) {
    New-Item -ItemType Directory -Path $dir | Out-Null
  }
  $file = Join-Path $dir "tamsun.sqlite"
  $cs = 'Data Source="' + $file.Replace('"', '""') + '";Version=3;Pooling=False;Foreign Keys=True;Journal Mode=Wal;Busy Timeout=5000;'
  $global:TamsunDb = New-Object System.Data.SQLite.SQLiteConnection $cs
  $global:TamsunDb.Open()
  [void](Invoke-TamsunExec "PRAGMA foreign_keys=ON;")
  Ensure-TamsunSchema
  return $global:TamsunDb
}

function Save-TamsunDb {
  if ($script:TamsunTx) { return }
  if ($global:TamsunDb -and $global:TamsunDb.State -eq [System.Data.ConnectionState]::Open) {
    try { [void](Invoke-TamsunScalar "PRAGMA wal_checkpoint(PASSIVE);") } catch {
      Write-TamsunErrorLog ("sqlite_checkpoint " + $_.Exception.GetType().Name)
    }
  }
}

function Write-TamsunErrorLog([string]$message) {
  try {
    $dir = Join-Path $root "data"
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
    $line = ([DateTime]::UtcNow.ToString("o")) + " " + $message
    Add-Content -LiteralPath (Join-Path $dir "tamsun-error.log") -Value $line -Encoding UTF8
  } catch { }
}

function Add-TamsunParams($cmd, $params) {
  if ($null -eq $params) { return }
  foreach ($key in @($params.Keys)) {
    $value = $params[$key]
    if ($null -eq $value) { $value = [DBNull]::Value }
    if ($value -is [byte[]]) {
      $param = $cmd.Parameters.Add([string]$key, [System.Data.DbType]::Binary)
      $param.Value = $value
    } else {
      [void]$cmd.Parameters.AddWithValue([string]$key, $value)
    }
  }
}

function New-TamsunCommand([string]$sql, $params) {
  $db = Open-TamsunDb
  $cmd = $db.CreateCommand()
  $cmd.CommandText = $sql
  if ($script:TamsunTx) { $cmd.Transaction = $script:TamsunTx }
  Add-TamsunParams $cmd $params
  return $cmd
}

function Invoke-TamsunExec([string]$sql, $params) {
  $cmd = New-TamsunCommand $sql $params
  try { return [int]$cmd.ExecuteNonQuery() }
  finally { $cmd.Dispose() }
}

function Invoke-TamsunScalar([string]$sql, $params) {
  $cmd = New-TamsunCommand $sql $params
  try {
    $value = $cmd.ExecuteScalar()
    if ($null -eq $value -or $value -is [DBNull]) { return $null }
    return $value
  } finally { $cmd.Dispose() }
}

function Invoke-TamsunQuery([string]$sql, $params) {
  $cmd = New-TamsunCommand $sql $params
  $reader = $cmd.ExecuteReader()
  $rows = New-Object System.Collections.Generic.List[object]
  try {
    while ($reader.Read()) {
      $row = @{}
      for ($i = 0; $i -lt $reader.FieldCount; $i++) {
        $name = $reader.GetName($i)
        if ($reader.IsDBNull($i)) { $row[$name] = $null } else { $row[$name] = $reader.GetValue($i) }
      }
      [void]$rows.Add($row)
    }
  } finally {
    $reader.Close()
    $cmd.Dispose()
  }
  return [pscustomobject]@{ Rows = $rows.ToArray() }
}

function Get-TamsunRow([string]$sql, $params) {
  $packed = Invoke-TamsunQuery $sql $params
  foreach ($row in @($packed.Rows)) {
    if ($null -ne $row) { return $row }
  }
  return $null
}

function Use-TamsunTransaction([scriptblock]$body) {
  $db = Open-TamsunDb
  $tx = $db.BeginTransaction()
  $previous = $script:TamsunTx
  $script:TamsunTx = $tx
  try {
    & $body
    $tx.Commit()
  } catch {
    try { $tx.Rollback() } catch { }
    throw
  } finally {
    $script:TamsunTx = $previous
    $tx.Dispose()
  }
}

function Ensure-TamsunSchema {
  $statements = @(
    "CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', label TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', price_kzt INTEGER NOT NULL DEFAULT 0, image TEXT NOT NULL DEFAULT '', size TEXT NOT NULL DEFAULT '', material TEXT NOT NULL DEFAULT '', origin TEXT NOT NULL DEFAULT '', visible INTEGER NOT NULL DEFAULT 1)",
    "CREATE TABLE IF NOT EXISTS services (id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', visible INTEGER NOT NULL DEFAULT 1)",
    "CREATE TABLE IF NOT EXISTS settings (id TEXT PRIMARY KEY, currency TEXT NOT NULL DEFAULT 'kzt', usd_rate INTEGER NOT NULL DEFAULT 500)",
    "CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, number INTEGER NOT NULL, created_at TEXT NOT NULL, source TEXT NOT NULL, status TEXT NOT NULL, page TEXT NOT NULL, currency TEXT NOT NULL, usd_rate INTEGER NOT NULL, message TEXT NOT NULL, customer_name TEXT NOT NULL, customer_phone TEXT NOT NULL, total_kzt INTEGER NOT NULL, note TEXT NOT NULL DEFAULT '')",
    "CREATE TABLE IF NOT EXISTS order_items (order_id TEXT NOT NULL, position INTEGER NOT NULL, product_id TEXT NOT NULL DEFAULT '', name TEXT NOT NULL DEFAULT '', label TEXT NOT NULL DEFAULT '', qty INTEGER NOT NULL, price_kzt INTEGER NOT NULL, line_total_kzt INTEGER NOT NULL, PRIMARY KEY (order_id, position), FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE)",
    "CREATE TABLE IF NOT EXISTS clients (id TEXT PRIMARY KEY, client_key TEXT NOT NULL UNIQUE, customer_name TEXT NOT NULL DEFAULT '', customer_phone TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, note TEXT NOT NULL DEFAULT '')",
    "CREATE TABLE IF NOT EXISTS meta (id TEXT PRIMARY KEY, seeded TEXT NOT NULL DEFAULT '')"
  )
  foreach ($sql in $statements) { [void](Invoke-TamsunExec $sql) }
  Ensure-TamsunOrderScale
}

function Ensure-TamsunColumn([string]$table, [string]$column, [string]$definition) {
  $packed = Invoke-TamsunQuery ("PRAGMA table_info(" + $table + ")")
  foreach ($row in @($packed.Rows)) {
    if ($null -ne $row -and [string]$row["name"] -eq $column) { return }
  }
  [void](Invoke-TamsunExec ("ALTER TABLE " + $table + " ADD COLUMN " + $column + " " + $definition))
}

function Ensure-TamsunOrderScale {
  [void](Invoke-TamsunExec "CREATE TABLE IF NOT EXISTS order_tombstones (id TEXT PRIMARY KEY, deleted_at TEXT NOT NULL)")
  Ensure-TamsunColumn "orders" "updated_at" "TEXT NOT NULL DEFAULT ''"
  [void](Invoke-TamsunExec "UPDATE orders SET updated_at = created_at WHERE updated_at IS NULL OR updated_at = ''")
  [void](Invoke-TamsunExec "CREATE INDEX IF NOT EXISTS idx_orders_updated ON orders(updated_at)")
  [void](Invoke-TamsunExec "CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)")
  [void](Invoke-TamsunExec "CREATE INDEX IF NOT EXISTS idx_tombstones_deleted ON order_tombstones(deleted_at)")
  [void](Invoke-TamsunExec "CREATE INDEX IF NOT EXISTS idx_clients_updated ON clients(updated_at)")
  [void](Invoke-TamsunExec "CREATE TABLE IF NOT EXISTS images (path TEXT PRIMARY KEY, mime TEXT NOT NULL, bytes BLOB NOT NULL, created_at TEXT NOT NULL)")
}

function Escape-JsonText([string]$text) {
  if ($null -eq $text -or $text.Length -eq 0) { return "" }
  $sb = New-Object System.Text.StringBuilder
  foreach ($ch in $text.ToCharArray()) {
    $code = [int]$ch
    if ($code -eq 34) { [void]$sb.Append('\"') }
    elseif ($code -eq 92) { [void]$sb.Append('\\') }
    elseif ($code -eq 8) { [void]$sb.Append('\b') }
    elseif ($code -eq 12) { [void]$sb.Append('\f') }
    elseif ($code -eq 10) { [void]$sb.Append('\n') }
    elseif ($code -eq 13) { [void]$sb.Append('\r') }
    elseif ($code -eq 9) { [void]$sb.Append('\t') }
    elseif ($code -lt 32) { [void]$sb.Append(("\u{0:x4}" -f $code)) }
    else { [void]$sb.Append($ch) }
  }
  return $sb.ToString()
}

function ConvertTo-TamsunJson($value) {
  if ($null -eq $value) { return "null" }
  if ($value -is [bool]) {
    if ($value) { return "true" }
    return "false"
  }
  if ($value -is [byte] -or $value -is [int] -or $value -is [long] -or $value -is [double] -or $value -is [decimal] -or $value -is [single]) {
    return $value.ToString([System.Globalization.CultureInfo]::InvariantCulture)
  }
  if ($value -is [string]) { return '"' + (Escape-JsonText ([string]$value)) + '"' }
  if ($value -is [System.Collections.IDictionary]) {
    $parts = New-Object System.Collections.Generic.List[string]
    foreach ($key in $value.Keys) {
      $encoded = '"' + (Escape-JsonText ([string]$key)) + '":' + (ConvertTo-TamsunJson $value[$key])
      [void]$parts.Add($encoded)
    }
    return "{" + ($parts -join ",") + "}"
  }
  if ($value -is [System.Collections.IEnumerable]) {
    $parts = New-Object System.Collections.Generic.List[string]
    foreach ($item in $value) {
      [void]$parts.Add((ConvertTo-TamsunJson $item))
    }
    return "[" + ($parts -join ",") + "]"
  }
  return '"' + (Escape-JsonText ([string]$value)) + '"'
}

function Read-Field($obj, [string]$name, $default) {
  if ($null -eq $obj) { return $default }
  if ($obj -is [System.Collections.IDictionary]) {
    if (-not $obj.Contains($name) -or $null -eq $obj[$name]) { return $default }
    return $obj[$name]
  }
  $prop = $obj.PSObject.Properties[$name]
  if ($null -eq $prop -or $null -eq $prop.Value) { return $default }
  return $prop.Value
}

function Get-TamsunAdminKey {
  $value = [string]$env:ADMIN_PASSWORD
  if ([string]::IsNullOrWhiteSpace($value)) { return $null }
  return $value.Trim()
}

if (-not $script:AdminTokens) { $script:AdminTokens = @{} }
if (-not $script:OrderPostTimes) { $script:OrderPostTimes = @() }

function New-TamsunAdminToken([string]$password) {
  $expected = [string](Get-TamsunAdminKey)
  if ($password.Length -eq 0 -or $expected.Length -eq 0 -or $password -ne $expected) { return $null }
  $bytes = New-Object byte[] 24
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $rng.GetBytes($bytes)
  $rng.Dispose()
  $token = ([Convert]::ToBase64String($bytes)).TrimEnd("=").Replace("+", "-").Replace("/", "_")
  $script:AdminTokens[$token] = [DateTime]::UtcNow.AddHours(18)
  return $token
}

function Test-TamsunAdmin($ctx) {
  $token = [string]$ctx.Request.Headers["X-Admin-Token"]
  if ($token.Length -eq 0) { return $false }
  if (-not $script:AdminTokens.ContainsKey($token)) { return $false }
  if ([DateTime]$script:AdminTokens[$token] -le [DateTime]::UtcNow) {
    $script:AdminTokens.Remove($token)
    return $false
  }
  return $true
}

function Test-TamsunOrderRate {
  $now = [DateTime]::UtcNow
  $fresh = @()
  foreach ($time in @($script:OrderPostTimes)) {
    if ([DateTime]$time -gt $now.AddMinutes(-1)) { $fresh += [DateTime]$time }
  }
  if ($fresh.Count -ge 120) {
    $script:OrderPostTimes = $fresh
    return $false
  }
  $fresh += $now
  $script:OrderPostTimes = $fresh
  return $true
}

function Limit-Text($value, $max) {
  $text = ([string]$value).Trim()
  if ($text.Length -gt $max) { return $text.Substring(0, $max) }
  return $text
}

function Convert-OrderItems($raw) {
  $list = @()
  foreach ($item in @($raw)) {
    if ($null -eq $item) { continue }
    $name = Limit-Text $item.name 160
    $id = Limit-Text $item.id 80
    if ($name.Length -eq 0 -and $id.Length -eq 0) { continue }
    $qty = 1
    try { $qty = [int]$item.qty } catch { $qty = 1 }
    if ($qty -lt 1) { $qty = 1 }
    if ($qty -gt 99) { $qty = 99 }
    $price = 0
    $line = 0
    try { $price = [int][math]::Round([double]$item.priceKzt) } catch { $price = 0 }
    try { $line = [int][math]::Round([double]$item.lineTotalKzt) } catch { $line = 0 }
    if ($price -lt 0) { $price = 0 }
    if ($line -lt 0) { $line = 0 }
    if ($list.Count -ge 30) { return @{ error = "too_many" } }
    $list += @{ id = $id; name = $name; qty = $qty; priceKzt = $price; lineTotalKzt = $line }
  }
  return ,$list
}

function Read-TamsunStream($stream, [int]$maxBytes, [int]$timeoutMs) {
  $buffer = New-Object byte[] 65536
  $ms = New-Object System.IO.MemoryStream
  $deadline = [DateTime]::UtcNow.AddMilliseconds($timeoutMs)
  try {
    while ($true) {
      $left = [int]($deadline - [DateTime]::UtcNow).TotalMilliseconds
      if ($left -lt 1) { return @{ error = "timeout"; raw = "" } }
      $pending = $stream.ReadAsync($buffer, 0, $buffer.Length)
      if (-not $pending.Wait($left)) { return @{ error = "timeout"; raw = "" } }
      $read = 0
      try { $read = [int]$pending.Result } catch { return @{ error = "timeout"; raw = "" } }
      if ($read -le 0) { break }
      if (($ms.Length + $read) -gt $maxBytes) { return @{ error = "too_large"; raw = "" } }
      $ms.Write($buffer, 0, $read)
    }
  } catch {
    return @{ error = "timeout"; raw = "" }
  }
  return @{ error = ""; raw = [Text.Encoding]::UTF8.GetString($ms.ToArray()) }
}

function Read-JsonBody($ctx, $maxBytes) {
  $length = $ctx.Request.ContentLength64
  if ($length -gt $maxBytes) { return @{ error = "too_large" } }
  $read = Read-TamsunStream $ctx.Request.InputStream $maxBytes 5000
  if ($read.error) { return @{ error = $read.error } }
  $raw = [string]$read.raw
  if ([string]::IsNullOrWhiteSpace($raw)) { return @{ error = "empty" } }
  try { return @{ data = ($raw | ConvertFrom-Json) } }
  catch { return @{ error = "bad_json" } }
}

function Complete-TamsunBodyRead($ctx, $parsed) {
  if ($null -eq $parsed -or -not $parsed.error -or $parsed.error -ne "timeout") { return $false }
  Write-Json $ctx 408 @{ error = "timeout"; message = "Превышено время ожидания запроса." }
  return $true
}

function Read-OrderBody($ctx) {
  return Read-JsonBody $ctx 100000
}

function Get-DocString($doc, [string]$name) {
  return [string](Read-Field $doc $name "")
}

function Get-DocInt($doc, [string]$name) {
  $value = Read-Field $doc $name 0
  try { return [int]$value } catch { return 0 }
}

function Get-DocBool($doc, [string]$name, [bool]$fallback) {
  if ($null -eq $doc) { return $fallback }
  $value = $null
  if ($doc -is [System.Collections.IDictionary]) {
    if (-not $doc.Contains($name)) { return $fallback }
    $value = $doc[$name]
  } else {
    $prop = $doc.PSObject.Properties[$name]
    if ($null -eq $prop) { return $fallback }
    $value = $prop.Value
  }
  if ($null -eq $value) { return $fallback }
  if ($value -is [bool]) { return [bool]$value }
  $text = ([string]$value).ToLowerInvariant()
  if ($text -eq "1" -or $text -eq "true") { return $true }
  if ($text -eq "0" -or $text -eq "false") { return $false }
  return $fallback
}

function Get-NextOrderNumber {
  $current = Invoke-TamsunScalar "SELECT COALESCE(MAX(number), 0) FROM orders"
  $max = 0
  try { $max = [int]$current } catch { $max = 0 }
  return $max + 1
}

function Get-ClientPhoneKey([string]$phone) {
  $digits = [regex]::Replace([string]$phone, "\D", "")
  if ($digits.Length -eq 11 -and $digits.StartsWith("8")) {
    $digits = "7" + $digits.Substring(1)
  }
  if ($digits.Length -eq 10) { $digits = "7" + $digits }
  return $digits
}

function Get-ClientKey([string]$name, [string]$phone) {
  $phoneKey = Get-ClientPhoneKey $phone
  if ($phoneKey.Length -gt 0) { return "p:" + $phoneKey }
  $trimmed = ([string]$name).Trim().ToLowerInvariant()
  if ($trimmed.Length -gt 0) { return "n:" + $trimmed }
  return ""
}

function Save-TamsunClient([string]$name, [string]$phone) {
  $cleanName = Limit-Text $name 80
  $cleanPhone = Limit-Text $phone 32
  $key = Get-ClientKey $cleanName $cleanPhone
  if ($key.Length -eq 0) { return $null }
  $now = [DateTime]::UtcNow.ToString("o")
  $existing = Get-TamsunRow "SELECT * FROM clients WHERE client_key=@key" @{ "@key" = $key }
  if ($existing) {
    if ($cleanName.Length -eq 0) { $cleanName = [string]$existing["customer_name"] }
    if ($cleanPhone.Length -eq 0) { $cleanPhone = [string]$existing["customer_phone"] }
    [void](Invoke-TamsunExec "UPDATE clients SET customer_name=@name, customer_phone=@phone, updated_at=@updated WHERE client_key=@key" @{
      "@name" = $cleanName
      "@phone" = $cleanPhone
      "@updated" = $now
      "@key" = $key
    })
    Save-TamsunDb
    return $false
  }
  $id = [guid]::NewGuid().ToString("n").Substring(0, 12)
  [void](Invoke-TamsunExec "INSERT INTO clients (id, client_key, customer_name, customer_phone, created_at, updated_at, note) VALUES (@id, @key, @name, @phone, @created, @updated, '')" @{
    "@id" = $id
    "@key" = $key
    "@name" = $cleanName
    "@phone" = $cleanPhone
    "@created" = $now
    "@updated" = $now
  })
  Save-TamsunDb
  return $true
}

function Sync-TamsunClients {
  try {
    $packed = Invoke-TamsunQuery "SELECT customer_name, customer_phone FROM orders ORDER BY created_at"
  } catch {
    Write-TamsunErrorLog ("client_sync_failed " + $_.Exception.GetType().Name)
    return
  }
  $keys = @{}
  foreach ($row in @($packed.Rows)) {
    if ($null -eq $row) { continue }
    $orderName = [string]$row["customer_name"]
    $orderPhone = [string]$row["customer_phone"]
    $key = Get-ClientKey $orderName $orderPhone
    if ($key.Length -gt 0) { $keys[$key] = $true }
    try { Save-TamsunClient $orderName $orderPhone | Out-Null } catch {
      Write-TamsunErrorLog ("client_save_failed " + $_.Exception.GetType().Name)
      return
    }
  }
  try {
    $clients = Invoke-TamsunQuery "SELECT client_key FROM clients"
  } catch {
    Write-TamsunErrorLog ("client_sync_failed " + $_.Exception.GetType().Name)
    return
  }
  foreach ($row in @($clients.Rows)) {
    if ($null -eq $row) { continue }
    $key = [string]$row["client_key"]
    if ($key.Length -eq 0 -or -not $keys.ContainsKey($key)) {
      try { [void](Invoke-TamsunExec "DELETE FROM clients WHERE client_key=@key" @{ "@key" = $key }) } catch {
        Write-TamsunErrorLog ("client_delete_failed " + $_.Exception.GetType().Name)
        return
      }
    }
  }
  Save-TamsunDb
}

function Update-TamsunClientNote($payload) {
  $key = Limit-Text $payload.key 120
  if ($key.Length -lt 3) { return $false }
  $prefix = $key.Substring(0, 2)
  if ($prefix -ne "p:" -and $prefix -ne "n:") { return $false }
  $note = Limit-Text $payload.note 1000
  $updated = Invoke-TamsunExec "UPDATE clients SET note=@note, updated_at=@updated WHERE client_key=@key" @{
    "@note" = $note
    "@updated" = [DateTime]::UtcNow.ToString("o")
    "@key" = $key
  }
  if ($updated -gt 0) { Save-TamsunDb }
  return ($updated -gt 0)
}

function Get-ClientsStamp {
  $row = Get-TamsunRow "SELECT COUNT(*) AS total, COALESCE(MAX(updated_at), '') AS stamp FROM clients"
  if (-not $row) { return "0" }
  $total = 0
  try { $total = [int]$row["total"] } catch { $total = 0 }
  $stamp = [string]$row["stamp"] -replace '[^0-9A-Za-zT:._+-]', ''
  return ([string]$total) + "-" + $stamp
}

function Write-NotModified($ctx, [string]$etag) {
  Add-Cors $ctx
  $ctx.Response.Headers["ETag"] = $etag
  $ctx.Response.Headers["Cache-Control"] = "no-cache"
  $ctx.Response.StatusCode = 304
  $ctx.Response.ContentLength64 = 0
}

function Get-TamsunClientsJson {
  $list = New-Object System.Collections.Generic.List[object]
  $packed = Invoke-TamsunQuery "SELECT * FROM clients"
  foreach ($row in @($packed.Rows)) {
    if ($null -eq $row) { continue }
    [void]$list.Add(@{
      id = [string]$row["id"]
      key = [string]$row["client_key"]
      customerName = [string]$row["customer_name"]
      customerPhone = [string]$row["customer_phone"]
      createdAt = [string]$row["created_at"]
      updatedAt = [string]$row["updated_at"]
      note = [string]$row["note"]
    })
  }
  return ConvertTo-TamsunJson @{ clients = $list }
}

function Get-TamsunUsdRate {
  $row = Get-TamsunRow "SELECT usd_rate FROM settings WHERE id=@id" @{ "@id" = "main" }
  if (-not $row) { return 500 }
  $rate = 0
  try { $rate = [int]$row["usd_rate"] } catch { $rate = 0 }
  if ($rate -lt 1) { return 500 }
  return $rate
}

function Convert-ProductRow($row) {
  return @{
    id = [string]$row["id"]
    name = [string]$row["name"]
    label = [string]$row["label"]
    description = [string]$row["description"]
    priceKzt = [int]$row["price_kzt"]
    image = [string]$row["image"]
    size = [string]$row["size"]
    material = [string]$row["material"]
    origin = [string]$row["origin"]
    visible = (([int]$row["visible"]) -ne 0)
  }
}

function Convert-ServiceRow($row) {
  return @{
    id = [string]$row["id"]
    title = [string]$row["title"]
    description = [string]$row["description"]
    visible = (([int]$row["visible"]) -ne 0)
  }
}

function Convert-SettingsRow($row) {
  $currency = [string]$row["currency"]
  if ($currency -ne "usd") { $currency = "kzt" }
  $rate = 500
  try { $rate = [int]$row["usd_rate"] } catch { $rate = 500 }
  if ($rate -lt 1) { $rate = 500 }
  return @{ id = "main"; currency = $currency; usdRate = $rate }
}

function Find-TamsunProduct([string]$id) {
  if ([string]::IsNullOrWhiteSpace($id)) { return $null }
  $row = Get-TamsunRow "SELECT * FROM products WHERE id=@id" @{ "@id" = $id }
  if (-not $row) { return $null }
  return Convert-ProductRow $row
}

function Resolve-TamsunOrderItems($payload, [string]$source) {
  $converted = Convert-OrderItems $payload.items
  if ($converted -isnot [System.Array] -and $converted.error) { return @{ error = [string]$converted.error } }
  $raw = $converted
  $needsProduct = @("cart", "product", "chat") -contains $source
  $resolved = New-Object System.Collections.Generic.List[object]
  foreach ($item in @($raw)) {
    $prod = Find-TamsunProduct ([string]$item.id)
    if (-not $prod) {
      if ($needsProduct) { return @{ error = "unknown_product" } }
      continue
    }
    if (-not (Get-DocBool $prod "visible" $true)) { return @{ error = "unavailable" } }
    $price = Get-DocInt $prod "priceKzt"
    if ($price -lt 0) { $price = 0 }
    $qty = [int]$item.qty
    if ($qty -lt 1) { $qty = 1 }
    if ($qty -gt 99) { $qty = 99 }
    $line = [int64]$price * [int64]$qty
    if ($line -gt [int]::MaxValue) { $line = [int]::MaxValue }
    if ($line -lt 0) { $line = 0 }
    [void]$resolved.Add(@{
      id = Get-DocString $prod "id"
      name = Get-DocString $prod "name"
      label = Get-DocString $prod "label"
      qty = $qty
      priceKzt = $price
      lineTotalKzt = [int]$line
    })
  }
  if ($needsProduct -and $resolved.Count -eq 0) { return @{ error = "empty_cart" } }
  $total = 0
  foreach ($row in @($resolved.ToArray())) { $total += [int]$row.lineTotalKzt }
  return @{ items = $resolved.ToArray(); total = $total }
}

function New-OrderItemRecord($line) {
  $qty = 1
  try { $qty = [int]$line["qty"] } catch { $qty = 1 }
  if ($qty -lt 1) { $qty = 1 }
  $price = 0
  $total = 0
  try { $price = [int]$line["price_kzt"] } catch { $price = 0 }
  try { $total = [int]$line["line_total_kzt"] } catch { $total = 0 }
  return @{
    id = [string]$line["product_id"]
    name = [string]$line["name"]
    label = [string]$line["label"]
    qty = $qty
    priceKzt = $price
    lineTotalKzt = $total
  }
}

function Group-OrderItemRows($rows) {
  $map = @{}
  foreach ($line in @($rows)) {
    if ($null -eq $line) { continue }
    $orderId = [string]$line["order_id"]
    if (-not $map.ContainsKey($orderId)) {
      $map[$orderId] = New-Object System.Collections.Generic.List[object]
    }
    [void]$map[$orderId].Add((New-OrderItemRecord $line))
  }
  return $map
}

function Get-OrderItemMap($ids, [bool]$all) {
  if ($all) {
    $packed = Invoke-TamsunQuery "SELECT order_id, product_id, name, label, qty, price_kzt, line_total_kzt FROM order_items ORDER BY order_id, position"
    return Group-OrderItemRows $packed.Rows
  }
  $map = @{}
  $idList = New-Object System.Collections.Generic.List[string]
  foreach ($id in @($ids)) {
    if ($id) { [void]$idList.Add([string]$id) }
  }
  if ($idList.Count -eq 0) { return $map }
  $step = 80
  for ($offset = 0; $offset -lt $idList.Count; $offset += $step) {
    $params = @{}
    $names = New-Object System.Collections.Generic.List[string]
    $end = $offset + $step
    if ($end -gt $idList.Count) { $end = $idList.Count }
    for ($i = $offset; $i -lt $end; $i++) {
      $key = "@p" + ($i - $offset)
      $params[$key] = $idList[$i]
      [void]$names.Add($key)
    }
    $sql = "SELECT order_id, product_id, name, label, qty, price_kzt, line_total_kzt FROM order_items WHERE order_id IN (" + ($names -join ",") + ") ORDER BY position"
    $packed = Invoke-TamsunQuery $sql $params
    $grouped = Group-OrderItemRows $packed.Rows
    foreach ($key in @($grouped.Keys)) { $map[$key] = $grouped[$key] }
  }
  return $map
}

function Convert-OrderRow($row, $itemMap) {
  $id = [string]$row["id"]
  $items = New-Object System.Collections.Generic.List[object]
  if ($null -eq $itemMap) {
    $packed = Invoke-TamsunQuery "SELECT order_id, product_id, name, label, qty, price_kzt, line_total_kzt FROM order_items WHERE order_id=@id ORDER BY position" @{ "@id" = $id }
    $itemMap = Group-OrderItemRows $packed.Rows
  }
  if ($itemMap.ContainsKey($id)) {
    $bucket = $itemMap[$id]
    for ($n = 0; $n -lt $bucket.Count; $n++) {
      $item = $bucket[$n]
      if ($null -ne $item) { [void]$items.Add($item) }
    }
  }
  $status = [string]$row["status"]
  if ($status.Length -eq 0) { $status = "new" }
  return @{
    id = $id
    requestId = [string]$row["request_id"]
    number = [int]$row["number"]
    createdAt = [string]$row["created_at"]
    source = [string]$row["source"]
    status = $status
    page = [string]$row["page"]
    currency = [string]$row["currency"]
    usdRate = [int]$row["usd_rate"]
    message = [string]$row["message"]
    customerName = [string]$row["customer_name"]
    customerPhone = [string]$row["customer_phone"]
    totalKzt = [int]$row["total_kzt"]
    note = [string]$row["note"]
    items = $items
  }
}

function Read-OrderItemRows($doc) {
  $list = New-Object System.Collections.Generic.List[object]
  $raw = Read-Field $doc "items" $null
  foreach ($item in @($raw)) {
    if ($null -eq $item) { continue }
    if ($item -is [System.Array]) {
      foreach ($inner in @($item)) {
        if ($null -ne $inner) { [void]$list.Add($inner) }
      }
      continue
    }
    [void]$list.Add($item)
  }
  return $list
}

function Test-OrderSyncMessage($payload) {
  try {
    if ($null -eq $payload.syncMessage) { return $false }
    return [bool]$payload.syncMessage
  } catch {
    return $false
  }
}

function New-OrderResult($id, $number, $total, $usdRate, $currency, $message, $status, $items, [bool]$duplicate) {
  $rows = New-Object System.Collections.Generic.List[object]
  foreach ($item in @($items)) {
    if ($null -eq $item) { continue }
    if ($item -is [System.Array]) {
      foreach ($inner in @($item)) {
        if ($null -ne $inner) { [void]$rows.Add($inner) }
      }
      continue
    }
    [void]$rows.Add($item)
  }
  $state = [string]$status
  if ($state.Length -eq 0) { $state = "new" }
  return @{
    id = [string]$id
    number = [int]$number
    totalKzt = [int]$total
    usdRate = [int]$usdRate
    currency = [string]$currency
    message = [string]$message
    status = $state
    items = $rows.ToArray()
    duplicate = [bool]$duplicate
  }
}

function Save-ExistingOrder($existing, $payload) {
  if ($existing -is [System.Array]) { $existing = $existing[0] }
  $name = Get-DocString $existing "customerName"
  $phone = Get-DocString $existing "customerPhone"
  $message = Get-DocString $existing "message"
  $status = Get-DocString $existing "status"
  if ($status.Length -eq 0) { $status = "new" }
  if ($status -eq "new") {
    $nextName = Limit-Text $payload.customerName 80
    $nextPhone = Limit-Text $payload.customerPhone 32
    $nextMessage = Limit-Text $payload.message 1500
    $changed = $false
    if ($nextName.Length -gt 0 -and $nextName -ne $name) {
      $name = $nextName
      $changed = $true
    }
    if ($nextPhone.Length -gt 0 -and $nextPhone -ne $phone) {
      $phone = $nextPhone
      $changed = $true
    }
    if ((Test-OrderSyncMessage $payload) -and $nextMessage.Length -gt 0 -and $nextMessage -ne $message) {
      $message = $nextMessage
      $changed = $true
    }
    if ($changed) {
      $existing["customerName"] = $name
      $existing["customerPhone"] = $phone
      $existing["message"] = $message
      [void](Invoke-TamsunExec "UPDATE orders SET customer_name=@name, customer_phone=@phone, message=@message, updated_at=@updated WHERE id=@id" @{
        "@name" = $name
        "@phone" = $phone
        "@message" = $message
        "@updated" = [DateTime]::UtcNow.ToString("o")
        "@id" = (Get-DocString $existing "id")
      })
      Save-TamsunDb
      try {
        $clientSaved = Save-TamsunClient $name $phone
        if ($null -eq $clientSaved) { Write-TamsunErrorLog ("client_save_missing id=" + (Get-DocString $existing "id")) }
      } catch {
        Write-TamsunErrorLog ("client_save_failed id=" + (Get-DocString $existing "id") + " " + $_.Exception.GetType().Name)
      }
    }
  }
  $storedItems = Read-OrderItemRows $existing
  return New-OrderResult (Get-DocString $existing "id") (Get-DocInt $existing "number") (Get-DocInt $existing "totalKzt") (Get-DocInt $existing "usdRate") (Get-DocString $existing "currency") $message $status $storedItems $true
}

function Find-OrderByRequestId([string]$requestId) {
  if ($requestId -notmatch '^[a-f0-9]{12}$') { return $null }
  $row = Get-TamsunRow "SELECT * FROM orders WHERE request_id=@id" @{ "@id" = $requestId }
  if (-not $row) { return $null }
  return Convert-OrderRow $row
}

function Add-OrderItems([string]$orderId, $items) {
  $pos = 0
  foreach ($item in @($items)) {
    if ($null -eq $item) { continue }
    [void](Invoke-TamsunExec "INSERT INTO order_items (order_id, position, product_id, name, label, qty, price_kzt, line_total_kzt) VALUES (@order_id, @position, @product_id, @name, @label, @qty, @price_kzt, @line_total_kzt)" @{
      "@order_id" = $orderId
      "@position" = $pos
      "@product_id" = [string](Read-Field $item "id" "")
      "@name" = [string](Read-Field $item "name" "")
      "@label" = [string](Read-Field $item "label" "")
      "@qty" = [int](Read-Field $item "qty" 1)
      "@price_kzt" = [int](Read-Field $item "priceKzt" 0)
      "@line_total_kzt" = [int](Read-Field $item "lineTotalKzt" 0)
    })
    $pos++
  }
}

function Add-TamsunOrder($payload) {
  $allowed = @("cart", "product", "chat", "service", "whatsapp")
  $source = Limit-Text $payload.source 20
  if ($allowed -notcontains $source) { $source = "whatsapp" }
  $page = Limit-Text $payload.page 80
  if ($page -notmatch '^[A-Za-z0-9._-]+$') { $page = "site" }
  $currency = Limit-Text $payload.currency 8
  if ($currency -ne "usd") { $currency = "kzt" }
  $requestId = Limit-Text $payload.requestId 20
  if ($requestId -match '^[a-f0-9]{12}$') {
    $known = Find-OrderByRequestId $requestId
    if ($known) { return (Save-ExistingOrder $known $payload) }
  } else {
    $requestId = [guid]::NewGuid().ToString("n").Substring(0, 12)
  }
  $priced = Resolve-TamsunOrderItems $payload $source
  if ($priced.error) { return @{ error = $priced.error } }
  $items = @($priced.items)
  $total = [int]$priced.total
  $usdRate = Get-TamsunUsdRate
  $id = [guid]::NewGuid().ToString("n").Substring(0, 12)
  $number = 0
  $message = Limit-Text $payload.message 2000
  $customerName = Limit-Text $payload.customerName 80
  $customerPhone = Limit-Text $payload.customerPhone 32
  $createdAt = [DateTime]::UtcNow.ToString("o")

  try {
    Use-TamsunTransaction {
      $existing = Get-TamsunRow "SELECT id FROM orders WHERE request_id=@id" @{ "@id" = $requestId }
      if ($existing) { $script:TamsunOrderDuplicate = $true; return }
      $script:TamsunOrderDuplicate = $false
      $number = Get-NextOrderNumber
      $script:TamsunOrderNumber = $number
      [void](Invoke-TamsunExec "INSERT INTO orders (id, request_id, number, created_at, source, status, page, currency, usd_rate, message, customer_name, customer_phone, total_kzt, note, updated_at) VALUES (@id, @request_id, @number, @created_at, @source, 'new', @page, @currency, @usd_rate, @message, @customer_name, @customer_phone, @total_kzt, '', @updated_at)" @{
        "@id" = $id
        "@request_id" = $requestId
        "@number" = $number
        "@created_at" = $createdAt
        "@source" = $source
        "@page" = $page
        "@currency" = $currency
        "@usd_rate" = $usdRate
        "@message" = $message
        "@customer_name" = $customerName
        "@customer_phone" = $customerPhone
        "@total_kzt" = $total
        "@updated_at" = $createdAt
      })
      Add-OrderItems $id $items
      $clientSaved = Save-TamsunClient $customerName $customerPhone
      if ($null -eq $clientSaved) { throw "Заказ не сохранён: нет карточки клиента." }
    }
  } catch {
    $reason = $_.Exception.Message
    if ([string]::IsNullOrWhiteSpace($reason)) { $reason = $_.Exception.GetType().Name }
    Write-TamsunErrorLog ("order_transaction_failed id=" + $id + " " + $reason)
    return @{ error = "order_failed"; message = "Не удалось оформить заказ. Попробуйте ещё раз." }
  }
  if ($script:TamsunOrderDuplicate) {
    $known = Find-OrderByRequestId $requestId
    if ($known) { return (Save-ExistingOrder $known $payload) }
  }
  Save-TamsunDb
  return New-OrderResult $id $script:TamsunOrderNumber $total $usdRate $currency $message "new" $items $false
}

function Test-TamsunSince([string]$since) {
  if ([string]::IsNullOrWhiteSpace($since) -or $since.Length -gt 40) { return $false }
  return $since -match '^\d{4}-\d{2}-\d{2}T'
}

function Get-TamsunOrdersJson([string]$since) {
  $serverTime = [DateTime]::UtcNow.ToString("o")
  $full = -not (Test-TamsunSince $since)
  if (-not $full) {
    try {
      $parsedSince = [DateTime]::Parse($since, [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::RoundtripKind).ToUniversalTime()
      if ($parsedSince -lt [DateTime]::UtcNow.AddDays(-14)) { $full = $true }
    } catch {
      $full = $true
    }
  }
  if (-not $full) {
    $cut = [DateTime]::UtcNow.AddDays(-14).ToString("o")
    try { [void](Invoke-TamsunExec "DELETE FROM order_tombstones WHERE deleted_at < @cut" @{ "@cut" = $cut }) } catch { }
  }
  $orderSql = "SELECT * FROM orders"
  $orderParams = @{}
  if (-not $full) {
    $orderSql += " WHERE updated_at >= @since"
    $orderParams["@since"] = $since
  }
  $orderSql += " ORDER BY number"
  $packed = Invoke-TamsunQuery $orderSql $orderParams
  $ids = New-Object System.Collections.Generic.List[string]
  foreach ($row in @($packed.Rows)) {
    if ($null -ne $row) { [void]$ids.Add([string]$row["id"]) }
  }
  $itemMap = Get-OrderItemMap -ids $ids -all:$full
  $list = New-Object System.Collections.Generic.List[object]
  foreach ($row in @($packed.Rows)) {
    if ($null -eq $row) { continue }
    [void]$list.Add((Convert-OrderRow $row $itemMap))
  }
  $deleted = New-Object System.Collections.Generic.List[string]
  if (-not $full) {
    $gone = Invoke-TamsunQuery "SELECT id FROM order_tombstones WHERE deleted_at >= @since" @{ "@since" = $since }
    foreach ($row in @($gone.Rows)) {
      if ($null -ne $row) { [void]$deleted.Add([string]$row["id"]) }
    }
  }
  return ConvertTo-TamsunJson @{
    orders = $list
    deletedIds = $deleted
    serverTime = $serverTime
    full = [bool]$full
  }
}

function Update-TamsunOrder($payload) {
  $id = Limit-Text $payload.id 20
  if ($id -notmatch '^[a-f0-9]{12}$') { return $false }
  $status = Limit-Text $payload.status 20
  $allowed = @("new", "progress", "done", "cancelled")
  if ($allowed -notcontains $status) { return $false }
  $updated = Invoke-TamsunExec "UPDATE orders SET status=@status, note=@note, updated_at=@updated WHERE id=@id" @{
    "@status" = $status
    "@note" = (Limit-Text $payload.note 1000)
    "@updated" = [DateTime]::UtcNow.ToString("o")
    "@id" = $id
  }
  if ($updated -gt 0) { Save-TamsunDb }
  return ($updated -gt 0)
}

function Remove-TamsunOrder($payload) {
  $id = Limit-Text $payload.id 20
  if ($id -notmatch '^[a-f0-9]{12}$') { return $false }
  $script:TamsunRemoved = 0
  $deletedAt = [DateTime]::UtcNow.ToString("o")
  Use-TamsunTransaction {
    [void](Invoke-TamsunExec "DELETE FROM order_items WHERE order_id=@id" @{ "@id" = $id })
    $script:TamsunRemoved = Invoke-TamsunExec "DELETE FROM orders WHERE id=@id" @{ "@id" = $id }
    if ($script:TamsunRemoved -gt 0) {
      [void](Invoke-TamsunExec "INSERT OR REPLACE INTO order_tombstones (id, deleted_at) VALUES (@id, @deleted_at)" @{
        "@id" = $id
        "@deleted_at" = $deletedAt
      })
    }
  }
  if ($script:TamsunRemoved -gt 0) {
    Save-TamsunDb
    try { Sync-TamsunClients } catch {
      Write-TamsunErrorLog ("client_sync_failed " + $_.Exception.GetType().Name)
    }
  }
  return ($script:TamsunRemoved -gt 0)
}

function Test-CatalogImagePath([string]$image) {
  if ([string]::IsNullOrWhiteSpace($image)) { return $false }
  if ($image.Length -gt 240) { return $false }
  if ($image -match '^(?i)(data:|https?:|//)') { return $false }
  if ($image -match '\.\.|[\\:\r\n]') { return $false }
  return $true
}

function Convert-IncomingProducts($raw) {
  $list = New-Object System.Collections.Generic.List[object]
  $seen = @{}
  foreach ($item in @($raw)) {
    if ($null -eq $item) { continue }
    $id = Limit-Text $item.id 40
    if ($id -notmatch '^[A-Za-z0-9_-]+$') { return @{ error = "bad_id" } }
    if ($seen.ContainsKey($id)) { continue }
    $seen[$id] = $true
    $name = Limit-Text $item.name 160
    if ($name.Length -lt 1) { return @{ error = "name" } }
    $image = Limit-Text $item.image 240
    if (-not (Test-CatalogImagePath $image)) { return @{ error = "image" } }
    $price = 0
    try { $price = [int][math]::Round([double]$item.priceKzt) } catch { $price = 0 }
    if ($price -lt 0) { $price = 0 }
    if ($price -gt 20000000) { $price = 20000000 }
    $visible = $true
    if ($null -ne $item.visible) { $visible = [bool]$item.visible }
    [void]$list.Add(@{
      id = $id
      name = $name
      label = (Limit-Text $item.label 80)
      description = (Limit-Text $item.description 4000)
      priceKzt = $price
      image = $image
      size = (Limit-Text $item.size 80)
      material = (Limit-Text $item.material 160)
      origin = (Limit-Text $item.origin 160)
      visible = [bool]$visible
    })
  }
  if ($list.Count -gt 1000) { return @{ error = "too_many" } }
  return @{ products = $list.ToArray() }
}

function Convert-IncomingServices($raw) {
  $list = New-Object System.Collections.Generic.List[object]
  $seen = @{}
  foreach ($item in @($raw)) {
    if ($null -eq $item) { continue }
    $id = Limit-Text $item.id 40
    if ($id -notmatch '^[A-Za-z0-9_-]+$') { return @{ error = "bad_id" } }
    if ($seen.ContainsKey($id)) { continue }
    $seen[$id] = $true
    $title = Limit-Text $item.title 160
    if ($title.Length -lt 1) { return @{ error = "name" } }
    $visible = $true
    if ($null -ne $item.visible) { $visible = [bool]$item.visible }
    [void]$list.Add(@{
      id = $id
      title = $title
      description = (Limit-Text $item.description 4000)
      visible = [bool]$visible
    })
  }
  if ($list.Count -gt 400) { return @{ error = "too_many" } }
  return @{ services = $list.ToArray() }
}

function Add-ProductRecord($item) {
  $visible = 1
  if (-not (Get-DocBool $item "visible" $true)) { $visible = 0 }
  [void](Invoke-TamsunExec "INSERT OR REPLACE INTO products (id, name, label, description, price_kzt, image, size, material, origin, visible) VALUES (@id, @name, @label, @description, @price, @image, @size, @material, @origin, @visible)" @{
    "@id" = [string](Read-Field $item "id" "")
    "@name" = [string](Read-Field $item "name" "")
    "@label" = [string](Read-Field $item "label" "")
    "@description" = [string](Read-Field $item "description" "")
    "@price" = [int](Read-Field $item "priceKzt" 0)
    "@image" = [string](Read-Field $item "image" "")
    "@size" = [string](Read-Field $item "size" "")
    "@material" = [string](Read-Field $item "material" "")
    "@origin" = [string](Read-Field $item "origin" "")
    "@visible" = $visible
  })
}

function Add-ServiceRecord($item) {
  $visible = 1
  if (-not (Get-DocBool $item "visible" $true)) { $visible = 0 }
  [void](Invoke-TamsunExec "INSERT OR REPLACE INTO services (id, title, description, visible) VALUES (@id, @title, @description, @visible)" @{
    "@id" = [string](Read-Field $item "id" "")
    "@title" = [string](Read-Field $item "title" "")
    "@description" = [string](Read-Field $item "description" "")
    "@visible" = $visible
  })
}

function Add-SettingsRecord($item) {
  $currency = [string](Read-Field $item "currency" "kzt")
  if ($currency -ne "usd") { $currency = "kzt" }
  $rate = 500
  try { $rate = [int](Read-Field $item "usdRate" 500) } catch { $rate = 500 }
  if ($rate -lt 1) { $rate = 500 }
  if ($rate -gt 1000000) { $rate = 1000000 }
  [void](Invoke-TamsunExec "INSERT OR REPLACE INTO settings (id, currency, usd_rate) VALUES ('main', @currency, @rate)" @{
    "@currency" = $currency
    "@rate" = $rate
  })
}

function Get-CatalogRevision {
  $row = Get-TamsunRow "SELECT seeded FROM meta WHERE id=@id" @{ "@id" = "catalog_rev" }
  if (-not $row) { return "1" }
  $value = [string]$row["seeded"]
  if ($value -match '^\d+$') { return $value }
  return "1"
}

function Bump-CatalogRevision {
  $next = 2
  try { $next = [int](Get-CatalogRevision) + 1 } catch { $next = 2 }
  if ($next -lt 2) { $next = 2 }
  [void](Invoke-TamsunExec "INSERT OR REPLACE INTO meta (id, seeded) VALUES ('catalog_rev', @value)" @{ "@value" = [string]$next })
}

function Remove-MissingRecords([string]$table, $keep) {
  if ($table -ne "products" -and $table -ne "services") { return }
  $packed = Invoke-TamsunQuery ("SELECT id FROM " + $table)
  foreach ($row in @($packed.Rows)) {
    if ($null -eq $row) { continue }
    $id = [string]$row["id"]
    if (-not $keep.ContainsKey($id)) {
      [void](Invoke-TamsunExec ("DELETE FROM " + $table + " WHERE id=@id") @{ "@id" = $id })
    }
  }
}

function Set-TamsunProducts($raw) {
  $parsed = Convert-IncomingProducts $raw
  if ($parsed.error) { return $parsed.error }
  Use-TamsunTransaction {
    $keep = @{}
    foreach ($item in @($parsed.products)) {
      if ($null -eq $item) { continue }
      Add-ProductRecord $item
      $keep[(Get-DocString $item "id")] = $true
    }
    Remove-MissingRecords "products" $keep
    Bump-CatalogRevision
  }
  Save-TamsunDb
  return $null
}

function Set-TamsunServices($raw) {
  $parsed = Convert-IncomingServices $raw
  if ($parsed.error) { return $parsed.error }
  Use-TamsunTransaction {
    $keep = @{}
    foreach ($item in @($parsed.services)) {
      if ($null -eq $item) { continue }
      Add-ServiceRecord $item
      $keep[(Get-DocString $item "id")] = $true
    }
    Remove-MissingRecords "services" $keep
    Bump-CatalogRevision
  }
  Save-TamsunDb
  return $null
}

function Set-TamsunSettings($payload) {
  Use-TamsunTransaction {
    Add-SettingsRecord $payload
    Bump-CatalogRevision
  }
  Save-TamsunDb
  return $null
}

function Get-TamsunCatalogJson {
  $products = New-Object System.Collections.Generic.List[object]
  $productRows = Invoke-TamsunQuery "SELECT * FROM products"
  foreach ($row in @($productRows.Rows)) {
    if ($null -eq $row) { continue }
    [void]$products.Add((Convert-ProductRow $row))
  }
  $services = New-Object System.Collections.Generic.List[object]
  $serviceRows = Invoke-TamsunQuery "SELECT * FROM services"
  foreach ($row in @($serviceRows.Rows)) {
    if ($null -eq $row) { continue }
    [void]$services.Add((Convert-ServiceRow $row))
  }
  $settings = @{ id = "main"; currency = "kzt"; usdRate = 500 }
  $settingsRow = Get-TamsunRow "SELECT * FROM settings WHERE id=@id" @{ "@id" = "main" }
  if ($settingsRow) { $settings = Convert-SettingsRow $settingsRow }
  return ConvertTo-TamsunJson @{ products = $products; services = $services; settings = $settings }
}

function Import-OrderRecord($item) {
  $id = [string](Read-Field $item "id" "")
  $requestId = [string](Read-Field $item "requestId" "")
  if ($id -notmatch '^[a-f0-9]{12}$') { return }
  if ($requestId -notmatch '^[a-f0-9]{12}$') { $requestId = $id }
  $number = 0
  try { $number = [int](Read-Field $item "number" 0) } catch { $number = 0 }
  $total = 0
  try { $total = [int](Read-Field $item "totalKzt" 0) } catch { $total = 0 }
  $usdRate = 500
  try { $usdRate = [int](Read-Field $item "usdRate" 500) } catch { $usdRate = 500 }
  $currency = [string](Read-Field $item "currency" "kzt")
  if ($currency -ne "usd") { $currency = "kzt" }
  $status = [string](Read-Field $item "status" "new")
  if (@("new", "progress", "done", "cancelled") -notcontains $status) { $status = "new" }
  $createdAt = [string](Read-Field $item "createdAt" ([DateTime]::UtcNow.ToString("o")))
  $updatedAt = [string](Read-Field $item "updatedAt" $createdAt)
  if ([string]::IsNullOrWhiteSpace($updatedAt)) { $updatedAt = $createdAt }
  [void](Invoke-TamsunExec "INSERT OR REPLACE INTO orders (id, request_id, number, created_at, source, status, page, currency, usd_rate, message, customer_name, customer_phone, total_kzt, note, updated_at) VALUES (@id, @request_id, @number, @created_at, @source, @status, @page, @currency, @usd_rate, @message, @customer_name, @customer_phone, @total_kzt, @note, @updated_at)" @{
    "@id" = $id
    "@request_id" = $requestId
    "@number" = $number
    "@created_at" = $createdAt
    "@source" = [string](Read-Field $item "source" "whatsapp")
    "@status" = $status
    "@page" = [string](Read-Field $item "page" "site")
    "@currency" = $currency
    "@usd_rate" = $usdRate
    "@message" = [string](Read-Field $item "message" "")
    "@customer_name" = [string](Read-Field $item "customerName" "")
    "@customer_phone" = [string](Read-Field $item "customerPhone" "")
    "@total_kzt" = $total
    "@note" = [string](Read-Field $item "note" "")
    "@updated_at" = $updatedAt
  })
  [void](Invoke-TamsunExec "DELETE FROM order_items WHERE order_id=@id" @{ "@id" = $id })
  Add-OrderItems $id (Read-Field $item "items" @())
}

function Add-ClientRecord($item) {
  $key = [string](Read-Field $item "key" "")
  if ($key.Length -eq 0) { return }
  $id = [string](Read-Field $item "id" "")
  if ($id -notmatch '^[a-f0-9]{12}$') { $id = [guid]::NewGuid().ToString("n").Substring(0, 12) }
  $now = [DateTime]::UtcNow.ToString("o")
  [void](Invoke-TamsunExec "INSERT OR REPLACE INTO clients (id, client_key, customer_name, customer_phone, created_at, updated_at, note) VALUES (@id, @key, @name, @phone, @created, @updated, @note)" @{
    "@id" = $id
    "@key" = $key
    "@name" = [string](Read-Field $item "customerName" "")
    "@phone" = [string](Read-Field $item "customerPhone" "")
    "@created" = [string](Read-Field $item "createdAt" $now)
    "@updated" = [string](Read-Field $item "updatedAt" $now)
    "@note" = [string](Read-Field $item "note" "")
  })
}

function Import-LiteCollection($lite, [string]$name, [scriptblock]$save) {
  $names = @($lite.GetCollectionNames())
  $found = $false
  foreach ($item in $names) {
    if ([string]$item -eq $name) { $found = $true }
  }
  if (-not $found) { return 0 }
  $added = 0
  foreach ($doc in $lite.GetCollection($name).FindAll()) {
    $json = $doc.ToString()
    if ([string]::IsNullOrWhiteSpace($json)) { continue }
    $row = $json | ConvertFrom-Json
    if ($null -eq $row) { continue }
    if (& $save $row) { $added++ }
  }
  return $added
}

function Import-ExistingLiteDb {
  $flag = Get-TamsunRow "SELECT id FROM meta WHERE id=@id" @{ "@id" = "litedb" }
  if ($flag) { return }
  $path = Join-Path $root "data\tamsun.db"
  if (-not (Test-Path -LiteralPath $path)) {
    [void](Invoke-TamsunExec "INSERT OR REPLACE INTO meta (id, seeded) VALUES ('litedb', 'skip')")
    return
  }
  if (-not ("LiteDB.LiteDatabase" -as [type])) {
    Add-Type -Path (Join-Path $root "lib\LiteDB.dll")
  }
  $lite = New-Object LiteDB.LiteDatabase ("Filename=" + $path + ";ReadOnly=true")
  $added = 0
  try {
    Use-TamsunTransaction {
      $added += Import-LiteCollection $lite "products" {
        param($item)
        $id = [string](Read-Field $item "id" "")
        if ($id.Length -eq 0) { return $false }
        $exists = Get-TamsunRow "SELECT id FROM products WHERE id=@id" @{ "@id" = $id }
        if ($exists) { return $false }
        Add-ProductRecord $item
        return $true
      }
      $added += Import-LiteCollection $lite "services" {
        param($item)
        $id = [string](Read-Field $item "id" "")
        if ($id.Length -eq 0) { return $false }
        $exists = Get-TamsunRow "SELECT id FROM services WHERE id=@id" @{ "@id" = $id }
        if ($exists) { return $false }
        Add-ServiceRecord $item
        return $true
      }
      $settings = Get-TamsunRow "SELECT id FROM settings WHERE id=@id" @{ "@id" = "main" }
      if (-not $settings) {
        $added += Import-LiteCollection $lite "settings" {
          param($item)
          Add-SettingsRecord $item
          return $true
        }
      }
      $added += Import-LiteCollection $lite "orders" {
        param($item)
        $id = [string](Read-Field $item "id" "")
        if ($id -notmatch '^[a-f0-9]{12}$') { return $false }
        $exists = Get-TamsunRow "SELECT id FROM orders WHERE id=@id" @{ "@id" = $id }
        if ($exists) { return $false }
        Import-OrderRecord $item
        return $true
      }
      $added += Import-LiteCollection $lite "clients" {
        param($item)
        $key = [string](Read-Field $item "key" "")
        if ($key.Length -eq 0) { $key = [string](Read-Field $item "clientKey" "") }
        if ($key.Length -eq 0) { return $false }
        $exists = Get-TamsunRow "SELECT id FROM clients WHERE client_key=@key" @{ "@key" = $key }
        if ($exists) { return $false }
        if (-not (Read-Field $item "key" $null)) {
          $item | Add-Member -NotePropertyName key -NotePropertyValue $key -Force
        }
        Add-ClientRecord $item
        return $true
      }
      [void](Invoke-TamsunExec "INSERT OR REPLACE INTO meta (id, seeded) VALUES ('litedb', '1')")
    }
  } finally {
    $lite.Dispose()
  }
  Save-TamsunDb
  if ($added -gt 0) { Write-Output ("imported_litedb " + $added) }
}

function Get-ImageMime([string]$ext) {
  $kind = $ext.ToLower()
  if ($kind -eq ".png") { return "image/png" }
  if ($kind -eq ".gif") { return "image/gif" }
  if ($kind -eq ".webp") { return "image/webp" }
  return "image/jpeg"
}

function Save-TamsunImageBytes([string]$rel, [string]$mime, [byte[]]$bytes) {
  [void](Invoke-TamsunExec "INSERT OR REPLACE INTO images (path, mime, bytes, created_at) VALUES (@path, @mime, @bytes, @created)" @{
    "@path" = $rel
    "@mime" = $mime
    "@bytes" = $bytes
    "@created" = [DateTime]::UtcNow.ToString("o")
  })
}

function Import-TamsunUploadFiles {
  $dir = Join-Path $root "uploads"
  if (-not (Test-Path -LiteralPath $dir)) { return }
  $added = 0
  foreach ($file in @(Get-ChildItem -LiteralPath $dir -File)) {
    $ext = $file.Extension.ToLower()
    if (@(".jpg", ".jpeg", ".png", ".gif", ".webp") -notcontains $ext) { continue }
    $rel = "uploads/" + $file.Name
    $exists = Get-TamsunRow "SELECT path FROM images WHERE path=@path" @{ "@path" = $rel }
    if ($exists) { continue }
    $bytes = [System.IO.File]::ReadAllBytes($file.FullName)
    if ($bytes.Length -lt 1) { continue }
    Save-TamsunImageBytes $rel (Get-ImageMime $ext) $bytes
    $added++
  }
  if ($added -gt 0) {
    Save-TamsunDb
    Write-Output ("imported_uploads " + $added)
  }
}

function Write-TamsunBytes($ctx, [string]$mime, [byte[]]$bytes) {
  Add-Cors $ctx
  $ctx.Response.StatusCode = 200
  $ctx.Response.ContentType = $mime
  $ctx.Response.Headers["Cache-Control"] = "public, max-age=86400"
  $ctx.Response.ContentLength64 = $bytes.Length
  $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
}

function Import-LiteDbSnapshot {
  $path = Join-Path $root "data\litedb-export.json"
  if (-not (Test-Path -LiteralPath $path)) { return }
  $flag = Get-TamsunRow "SELECT id FROM meta WHERE id=@id" @{ "@id" = "catalog" }
  if ($flag) { return }
  $raw = [System.IO.File]::ReadAllText($path, (New-Object System.Text.UTF8Encoding $false))
  $data = $raw | ConvertFrom-Json
  Use-TamsunTransaction {
    foreach ($item in @($data.products)) { if ($null -ne $item) { Add-ProductRecord $item } }
    foreach ($item in @($data.services)) { if ($null -ne $item) { Add-ServiceRecord $item } }
    foreach ($item in @($data.settings)) { if ($null -ne $item) { Add-SettingsRecord $item } }
    foreach ($item in @($data.orders)) { if ($null -ne $item) { Import-OrderRecord $item } }
    foreach ($item in @($data.clients)) { if ($null -ne $item) { Add-ClientRecord $item } }
    $seeded = $false
    foreach ($item in @($data.meta)) {
      if ($null -eq $item) { continue }
      $metaId = [string](Read-Field $item "id" "")
      if ($metaId.Length -eq 0) { continue }
      [void](Invoke-TamsunExec "INSERT OR REPLACE INTO meta (id, seeded) VALUES (@id, @seeded)" @{
        "@id" = $metaId
        "@seeded" = [string](Read-Field $item "seeded" "1")
      })
      $seeded = $true
    }
    if (-not $seeded) {
      [void](Invoke-TamsunExec "INSERT OR REPLACE INTO meta (id, seeded) VALUES ('catalog', '1')")
    }
  }
  Save-TamsunDb
}

function Initialize-TamsunCatalog {
  Import-ExistingLiteDb
  Import-TamsunUploadFiles
  Import-LiteDbSnapshot
  $flag = Get-TamsunRow "SELECT id FROM meta WHERE id=@id" @{ "@id" = "catalog" }
  if ($flag) { return }
  $path = Join-Path $root "catalog-seed.json"
  if (-not (Test-Path $path)) { return }
  $raw = [System.IO.File]::ReadAllText($path, (New-Object System.Text.UTF8Encoding $false))
  $data = $raw | ConvertFrom-Json
  $productCount = 0
  try { $productCount = [int](Invoke-TamsunScalar "SELECT COUNT(*) FROM products") } catch { $productCount = 0 }
  if ($productCount -eq 0) {
    foreach ($item in @($data.products)) {
      if ($null -eq $item) { continue }
      Add-ProductRecord @{
        id = [string]$item.id
        name = [string]$item.name
        label = [string]$item.label
        description = [string]$item.description
        priceKzt = [int]$item.priceKzt
        image = [string]$item.image
        size = [string]$item.size
        material = [string]$item.material
        origin = [string]$item.origin
        visible = [bool]$item.visible
      }
    }
  }
  $serviceCount = 0
  try { $serviceCount = [int](Invoke-TamsunScalar "SELECT COUNT(*) FROM services") } catch { $serviceCount = 0 }
  if ($serviceCount -eq 0) {
    foreach ($item in @($data.services)) {
      if ($null -eq $item) { continue }
      Add-ServiceRecord @{
        id = [string]$item.id
        title = [string]$item.title
        description = [string]$item.description
        visible = [bool]$item.visible
      }
    }
  }
  $settingsRow = Get-TamsunRow "SELECT id FROM settings WHERE id=@id" @{ "@id" = "main" }
  if (-not $settingsRow) {
    $rate = 500
    try { $rate = [int]$data.settings.usdRate } catch { $rate = 500 }
    $currency = [string]$data.settings.currency
    if ($currency -ne "usd") { $currency = "kzt" }
    Add-SettingsRecord @{ currency = $currency; usdRate = $rate }
  }
  [void](Invoke-TamsunExec "INSERT OR REPLACE INTO meta (id, seeded) VALUES ('catalog', '1')")
  Save-TamsunDb
}

function Get-ChatBytes($data) {
  $clean = ([string]$data) -replace '\s', ''
  if ($clean.Length -lt 8 -or $clean.Length -gt 6000000) { return $null }
  if ($clean -notmatch '^[A-Za-z0-9+/]+={0,2}$') { return $null }
  $pad = $clean.Length % 4
  if ($pad -gt 0) { $clean = $clean + ("=" * (4 - $pad)) }
  try { return [Convert]::FromBase64String($clean) } catch { return $null }
}

function Save-TamsunImage($payload) {
  $bytes = Get-ChatBytes $payload.data
  if (-not $bytes) { return @{ error = "bad_file" } }
  if ($bytes.Length -gt 3500000) { return @{ error = "too_large" } }
  $mime = ([string]$payload.type).ToLower()
  $ext = ""
  if ($mime -eq "image/jpeg" -or $mime -eq "image/jpg") { $ext = ".jpg" }
  elseif ($mime -eq "image/png") { $ext = ".png" }
  elseif ($mime -eq "image/webp") { $ext = ".webp" }
  elseif ($mime -eq "image/gif") { $ext = ".gif" }
  else { return @{ error = "bad_file" } }
  $dir = Join-Path $root "uploads"
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
  $leaf = [guid]::NewGuid().ToString("n").Substring(0, 16) + $ext
  $rel = "uploads/$leaf"
  Save-TamsunImageBytes $rel $mime $bytes
  [System.IO.File]::WriteAllBytes((Join-Path $dir $leaf), $bytes)
  Save-TamsunDb
  return @{ path = $rel }
}

function Convert-CatalogBytes($value) {
  if ($null -eq $value) { return $null }
  if ($value -is [byte[]]) {
    if ($value.Length -gt 0) { return $value }
    return $null
  }
  if ($value -is [System.Array]) {
    $bytes = [byte[]]$value
    if ($bytes.Length -gt 0) { return $bytes }
  }
  return $null
}

function Get-CatalogAssetBytes([string]$rel) {
  if (-not (Test-CatalogImagePath $rel)) { return $null }
  $row = Get-TamsunRow "SELECT bytes FROM images WHERE path=@path" @{ "@path" = $rel }
  if ($row) {
    $stored = Convert-CatalogBytes $row["bytes"]
    if ($stored) { return $stored }
  }
  $fullRoot = [IO.Path]::GetFullPath($root)
  $candidate = [IO.Path]::GetFullPath((Join-Path $fullRoot (($rel -replace '/', '\') )))
  $prefix = $fullRoot
  if (-not $prefix.EndsWith('\')) { $prefix = $prefix + '\' }
  if (-not $candidate.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { return $null }
  if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { return $null }
  return [IO.File]::ReadAllBytes($candidate)
}

function Get-CatalogPdfNode {
  if (Get-Command Get-NodeExe -ErrorAction SilentlyContinue) { return (Get-NodeExe) }
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd -and $cmd.Source) { return $cmd.Source }
  $bundled = Join-Path $env:LOCALAPPDATA "Programs\cursor\resources\app\resources\helpers\node.exe"
  if (Test-Path -LiteralPath $bundled) { return $bundled }
  return "node"
}

function Invoke-CatalogPdf([string]$json) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = Get-CatalogPdfNode
  $outFile = Join-Path ([IO.Path]::GetTempPath()) ("tamsun-catalog-" + [guid]::NewGuid().ToString("n") + ".pdf")
  $psi.Arguments = 'pdf/catalog.mjs "' + $outFile + '"'
  $psi.WorkingDirectory = $root
  $psi.UseShellExecute = $false
  $psi.RedirectStandardInput = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.CreateNoWindow = $true
  $proc = New-Object System.Diagnostics.Process
  $proc.StartInfo = $psi
  [void]$proc.Start()
  $utf8 = New-Object System.Text.UTF8Encoding $false
  try {
    $payload = $utf8.GetBytes($json)
    $proc.StandardInput.BaseStream.Write($payload, 0, $payload.Length)
    $proc.StandardInput.Close()
    $outBuffer = New-Object System.IO.MemoryStream
    $errBuffer = New-Object System.IO.MemoryStream
    $outCopy = $proc.StandardOutput.BaseStream.CopyToAsync($outBuffer)
    $errCopy = $proc.StandardError.BaseStream.CopyToAsync($errBuffer)
    if (-not $proc.WaitForExit(60000)) {
      try { $proc.Kill() } catch {}
      return $null
    }
    try { [void]$outCopy.Wait(8000) } catch {}
    try { [void]$errCopy.Wait(2000) } catch {}
    $stderr = $utf8.GetString($errBuffer.ToArray())
    if ($stderr) { Write-Output $stderr }
    if ($proc.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $outFile)) { return $null }
    $bytes = [IO.File]::ReadAllBytes($outFile)
    if ($bytes.Length -lt 5) { return $null }
    if ($bytes[0] -ne 37 -or $bytes[1] -ne 80 -or $bytes[2] -ne 68 -or $bytes[3] -ne 70) { return $null }
    return ,$bytes
  } catch {
    try { if (-not $proc.HasExited) { $proc.Kill() } } catch {}
    return $null
  } finally {
    if ($outFile -and (Test-Path -LiteralPath $outFile)) {
      try { Remove-Item -LiteralPath $outFile -Force } catch {}
    }
  }
}

function Get-CatalogPdfPayload {
  # Услуги в файл не попадают: у них нет цены. Здесь только видимые товары.
  $rate = Get-TamsunUsdRate
  $list = New-Object System.Collections.Generic.List[object]
  $packed = Invoke-TamsunQuery "SELECT id, name, label, description, price_kzt, image, size, material, origin FROM products WHERE visible <> 0 ORDER BY rowid"
  foreach ($row in @($packed.Rows)) {
    if ($null -eq $row) { continue }
    $price = 0
    try { $price = [int]$row["price_kzt"] } catch { $price = 0 }
    if ($price -lt 0) { $price = 0 }
    $image = ""
    $bytes = Get-CatalogAssetBytes ([string]$row["image"])
    if ($bytes) { $image = [Convert]::ToBase64String($bytes) }
    [void]$list.Add(@{
      id = [string]$row["id"]
      name = [string]$row["name"]
      label = [string]$row["label"]
      description = [string]$row["description"]
      priceKzt = $price
      size = [string]$row["size"]
      material = [string]$row["material"]
      origin = [string]$row["origin"]
      image = $image
    })
  }
  return ConvertTo-TamsunJson @{ usdRate = $rate; products = $list }
}

function Write-CatalogPdf($ctx, [byte[]]$bytes) {
  Add-Cors $ctx
  $ctx.Response.StatusCode = 200
  $ctx.Response.ContentType = "application/pdf"
  $ctx.Response.Headers["Content-Disposition"] = "attachment; filename=tamsun-catalog.pdf"
  $ctx.Response.Headers["Cache-Control"] = "no-store"
  $ctx.Response.ContentLength64 = $bytes.Length
  $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
}

function Invoke-InvoicePdf([string]$json) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = Get-CatalogPdfNode
  $outFile = Join-Path ([IO.Path]::GetTempPath()) ("tamsun-invoice-" + [guid]::NewGuid().ToString("n") + ".pdf")
  $psi.Arguments = 'pdf/invoice.mjs "' + $outFile + '"'
  $psi.WorkingDirectory = $root
  $psi.UseShellExecute = $false
  $psi.RedirectStandardInput = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.CreateNoWindow = $true
  $proc = New-Object System.Diagnostics.Process
  $proc.StartInfo = $psi
  [void]$proc.Start()
  $utf8 = New-Object System.Text.UTF8Encoding $false
  try {
    $payload = $utf8.GetBytes($json)
    $proc.StandardInput.BaseStream.Write($payload, 0, $payload.Length)
    $proc.StandardInput.Close()
    $outBuffer = New-Object System.IO.MemoryStream
    $errBuffer = New-Object System.IO.MemoryStream
    $outCopy = $proc.StandardOutput.BaseStream.CopyToAsync($outBuffer)
    $errCopy = $proc.StandardError.BaseStream.CopyToAsync($errBuffer)
    if (-not $proc.WaitForExit(60000)) {
      try { $proc.Kill() } catch {}
      return $null
    }
    try { [void]$outCopy.Wait(8000) } catch {}
    try { [void]$errCopy.Wait(2000) } catch {}
    if ($proc.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $outFile)) { return $null }
    $bytes = [IO.File]::ReadAllBytes($outFile)
    if ($bytes.Length -lt 5) { return $null }
    if ($bytes[0] -ne 37 -or $bytes[1] -ne 80 -or $bytes[2] -ne 68 -or $bytes[3] -ne 70) { return $null }
    return ,$bytes
  } catch {
    try { if (-not $proc.HasExited) { $proc.Kill() } } catch {}
    return $null
  } finally {
    if ($outFile -and (Test-Path -LiteralPath $outFile)) {
      try { Remove-Item -LiteralPath $outFile -Force } catch {}
    }
  }
}

function Get-InvoicePdfPayload([string]$id) {
  if ($id -notmatch '^[a-f0-9]{12}$') { return $null }
  $row = Get-TamsunRow "SELECT * FROM orders WHERE id=@id" @{ "@id" = $id }
  if (-not $row) { return $null }
  $order = Convert-OrderRow $row
  $rate = 0
  try { $rate = [int]$order.usdRate } catch { $rate = 0 }
  if ($rate -lt 1) { $rate = Get-TamsunUsdRate }
  $logo = ""
  $logoBytes = Get-CatalogAssetBytes "tamsun-logo.png"
  if ($logoBytes) { $logo = [Convert]::ToBase64String($logoBytes) }
  $items = New-Object System.Collections.Generic.List[object]
  foreach ($item in $order.items) {
    if ($null -eq $item) { continue }
    $image = ""
    $productId = [string]$item.id
    if ($productId -match '^[A-Za-z0-9_-]+$') {
      $product = Get-TamsunRow "SELECT image FROM products WHERE id=@id" @{ "@id" = $productId }
      if ($product) {
        $bytes = Get-CatalogAssetBytes ([string]$product["image"])
        if ($bytes) { $image = [Convert]::ToBase64String($bytes) }
      }
    }
    [void]$items.Add(@{
      name = [string]$item.name
      label = [string]$item.label
      qty = [int]$item.qty
      priceKzt = [int]$item.priceKzt
      lineTotalKzt = [int]$item.lineTotalKzt
      image = $image
    })
  }
  $number = 0
  try { $number = [int]$order.number } catch { $number = 0 }
  $total = 0
  try { $total = [int]$order.totalKzt } catch { $total = 0 }
  return @{
    number = $number
    json = (ConvertTo-TamsunJson @{
      number = $number
      createdAt = [string]$order.createdAt
      customerName = [string]$order.customerName
      customerPhone = [string]$order.customerPhone
      totalKzt = $total
      usdRate = $rate
      logo = $logo
      items = $items
    })
  }
}

function Write-InvoicePdf($ctx, [byte[]]$bytes, [int]$number) {
  $filename = "tamsun-invoice.pdf"
  if ($number -gt 0) { $filename = "tamsun-invoice-" + $number + ".pdf" }
  Add-Cors $ctx
  $ctx.Response.StatusCode = 200
  $ctx.Response.ContentType = "application/pdf"
  $ctx.Response.Headers["Content-Disposition"] = 'attachment; filename="' + $filename + '"'
  $ctx.Response.Headers["Cache-Control"] = "no-store"
  $ctx.Response.ContentLength64 = $bytes.Length
  $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
}

function Write-RawJson($ctx, $status, $json) {
  $bytes = [Text.Encoding]::UTF8.GetBytes([string]$json)
  Add-Cors $ctx
  $ctx.Response.StatusCode = $status
  $ctx.Response.ContentType = "application/json; charset=utf-8"
  $ctx.Response.ContentLength64 = $bytes.Length
  $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
}

function Handle-TamsunOrderApi($ctx) {
  $path = [Uri]::UnescapeDataString($ctx.Request.Url.LocalPath)
  $method = [string]$ctx.Request.HttpMethod

  if ($method -eq "GET" -and $path -match '^/uploads/[A-Za-z0-9][A-Za-z0-9._-]{0,80}\.(jpg|jpeg|png|gif|webp)$') {
    $rel = $path.TrimStart("/")
    $row = Get-TamsunRow "SELECT mime, bytes FROM images WHERE path=@path" @{ "@path" = $rel }
    $bytes = $null
    if ($row) { $bytes = $row["bytes"] }
    if ($bytes -is [System.Array] -and -not ($bytes -is [byte[]])) { $bytes = [byte[]]$bytes }
    if ($bytes -is [byte[]] -and $bytes.Length -gt 0) {
      $mime = [string]$row["mime"]
      if ([string]::IsNullOrWhiteSpace($mime)) { $mime = "application/octet-stream" }
      Write-TamsunBytes $ctx $mime $bytes
      return $true
    }
    return $false
  }

  if ($path -eq "/api/login") {
    if ($method -ne "POST") {
      Write-Json $ctx 405 @{ error = "method" }
      return $true
    }
    $parsed = Read-JsonBody $ctx 4000
    if (Complete-TamsunBodyRead $ctx $parsed) { return $true }
    if ($parsed.error) {
      Write-Json $ctx 400 @{ error = "bad_json" }
      return $true
    }
    $token = New-TamsunAdminToken ([string]$parsed.data.password)
    if (-not $token) {
      Write-Json $ctx 401 @{ error = "unauthorized" }
      return $true
    }
    Write-Json $ctx 200 @{ token = $token }
    return $true
  }

  if ($path -eq "/api/catalog.pdf") {
    if ($method -ne "GET") {
      Write-Json $ctx 405 @{ error = "method" }
      return $true
    }
    if (-not (Test-TamsunAdmin $ctx)) {
      Write-Json $ctx 401 @{ error = "unauthorized" }
      return $true
    }
    $pdf = Invoke-CatalogPdf (Get-CatalogPdfPayload)
    if (-not $pdf) {
      Write-Json $ctx 500 @{ error = "unavailable" }
      return $true
    }
    Write-CatalogPdf $ctx $pdf
    return $true
  }

  if ($path -match '^/api/orders/([a-fA-F0-9]{12})/invoice\.pdf$') {
    if ($method -ne "GET") {
      Write-Json $ctx 405 @{ error = "method" }
      return $true
    }
    if (-not (Test-TamsunAdmin $ctx)) {
      Write-Json $ctx 401 @{ error = "unauthorized" }
      return $true
    }
    $orderId = $Matches[1].ToLower()
    $invoicePayload = Get-InvoicePdfPayload $orderId
    if (-not $invoicePayload) {
      Write-Json $ctx 404 @{ error = "not_found" }
      return $true
    }
    $invoicePdf = Invoke-InvoicePdf ([string]$invoicePayload.json)
    if (-not $invoicePdf) {
      Write-Json $ctx 500 @{ error = "unavailable" }
      return $true
    }
    Write-InvoicePdf $ctx $invoicePdf ([int]$invoicePayload.number)
    return $true
  }

  if ($path -eq "/api/catalog") {
    if ($method -ne "GET") {
      Write-Json $ctx 405 @{ error = "method" }
      return $true
    }
    $etag = '"' + (Get-CatalogRevision) + '"'
    $match = [string]$ctx.Request.Headers["If-None-Match"]
    if ($match -eq $etag) {
      Write-NotModified $ctx $etag
      return $true
    }
    $ctx.Response.Headers["ETag"] = $etag
    $ctx.Response.Headers["Cache-Control"] = "no-cache"
    Write-RawJson $ctx 200 (Get-TamsunCatalogJson)
    return $true
  }

  if ($path -eq "/api/products" -or $path -eq "/api/services" -or $path -eq "/api/settings" -or $path -eq "/api/upload") {
    if (-not (Test-TamsunAdmin $ctx)) {
      Write-Json $ctx 401 @{ error = "unauthorized" }
      return $true
    }
    if ($method -ne "PUT" -and $method -ne "POST") {
      Write-Json $ctx 405 @{ error = "method" }
      return $true
    }
    $limit = 4000000
    if ($path -eq "/api/upload") { $limit = 8000000 }
    $parsed = Read-JsonBody $ctx $limit
    if (Complete-TamsunBodyRead $ctx $parsed) { return $true }
    if ($parsed.error -eq "too_large") {
      Write-Json $ctx 413 @{ error = "too_large" }
      return $true
    }
    if ($parsed.error) {
      Write-Json $ctx 400 @{ error = "bad_json" }
      return $true
    }
    if ($path -eq "/api/upload") {
      $saved = Save-TamsunImage $parsed.data
      if ($saved.error) {
        $status = 400
        if ($saved.error -eq "too_large") { $status = 413 }
        Write-Json $ctx $status @{ error = $saved.error }
        return $true
      }
      Write-Json $ctx 201 @{ path = $saved.path }
      return $true
    }
    $err = $null
    if ($path -eq "/api/products") { $err = Set-TamsunProducts $parsed.data.products }
    elseif ($path -eq "/api/services") { $err = Set-TamsunServices $parsed.data.services }
    else { $err = Set-TamsunSettings $parsed.data }
    if ($err) {
      Write-Json $ctx 400 @{ error = [string]$err }
      return $true
    }
    Write-Json $ctx 200 @{ ok = $true }
    return $true
  }

  if ($path -eq "/api/clients") {
    if (-not (Test-TamsunAdmin $ctx)) {
      Write-Json $ctx 401 @{ error = "unauthorized" }
      return $true
    }
    if ($method -eq "GET") {
      $etag = '"' + (Get-ClientsStamp) + '"'
      $match = [string]$ctx.Request.Headers["If-None-Match"]
      if ($match -eq $etag) {
        Write-NotModified $ctx $etag
        return $true
      }
      $ctx.Response.Headers["ETag"] = $etag
      $ctx.Response.Headers["Cache-Control"] = "no-cache"
      Write-RawJson $ctx 200 (Get-TamsunClientsJson)
      return $true
    }
    if ($method -eq "PATCH") {
      $parsed = Read-JsonBody $ctx 8000
      if (Complete-TamsunBodyRead $ctx $parsed) { return $true }
      if ($parsed.error) {
        Write-Json $ctx 400 @{ error = $(if ($parsed.error -eq "too_large") { "too_large" } else { "bad_json" }) }
        return $true
      }
      if (-not (Update-TamsunClientNote $parsed.data)) {
        Write-Json $ctx 404 @{ error = "not_found" }
        return $true
      }
      Write-Json $ctx 200 @{ ok = $true }
      return $true
    }
    Write-Json $ctx 405 @{ error = "method" }
    return $true
  }
  if ($path -ne "/api/orders") { return $false }

  if ($method -eq "POST") {
    $parsed = Read-OrderBody $ctx
    if (Complete-TamsunBodyRead $ctx $parsed) { return $true }
    if ($parsed.error -eq "too_large") {
      Write-Json $ctx 413 @{ error = "too_large" }
      return $true
    }
    if ($parsed.error) {
      Write-Json $ctx 400 @{ error = $parsed.error }
      return $true
    }
    $known = $false
    try { $known = $null -ne (Find-OrderByRequestId ([string]$parsed.data.requestId)) } catch { $known = $false }
    if (-not $known -and -not (Test-TamsunOrderRate)) {
      Write-Json $ctx 429 @{ error = "rate" }
      return $true
    }
    $saved = Add-TamsunOrder $parsed.data
    if ($saved.error -eq "order_failed") {
      $text = [string]$saved.message
      if ([string]::IsNullOrWhiteSpace($text)) { $text = "Не удалось оформить заказ. Попробуйте ещё раз." }
      Write-Json $ctx 500 @{ error = "order_failed"; message = $text }
      return $true
    }
    if ($saved.error) {
      $status = 400
      if ($saved.error -eq "unavailable") { $status = 409 }
      Write-Json $ctx $status @{ error = $saved.error }
      return $true
    }
    Write-Json $ctx 201 $saved
    return $true
  }

  if ($method -eq "GET") {
    if (-not (Test-TamsunAdmin $ctx)) {
      Write-Json $ctx 401 @{ error = "unauthorized" }
      return $true
    }
    $since = ""
    try { $since = [string]$ctx.Request.QueryString["since"] } catch { $since = "" }
    Write-RawJson $ctx 200 (Get-TamsunOrdersJson $since)
    return $true
  }

  if ($method -eq "PATCH" -or $method -eq "DELETE") {
    if (-not (Test-TamsunAdmin $ctx)) {
      Write-Json $ctx 401 @{ error = "unauthorized" }
      return $true
    }
    $parsed = Read-OrderBody $ctx
    if (Complete-TamsunBodyRead $ctx $parsed) { return $true }
    if ($parsed.error) {
      Write-Json $ctx 400 @{ error = $(if ($parsed.error -eq "too_large") { "too_large" } else { "bad_json" }) }
      return $true
    }
    if ($method -eq "PATCH") {
      $ok = Update-TamsunOrder $parsed.data
    } else {
      $ok = Remove-TamsunOrder $parsed.data
    }
    if (-not $ok) {
      Write-Json $ctx 404 @{ error = "not_found" }
      return $true
    }
    Write-Json $ctx 200 @{ ok = $true }
    return $true
  }

  Write-Json $ctx 405 @{ error = "method" }
  return $true
}

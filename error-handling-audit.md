# Error-handling and fallback audit

- Project: Tamsun shop (React SPA + PowerShell HttpListener + SQLite + Node chat worker)
- Date: 2026-10-05
- Method: static review of first-party sources only. `node_modules/` and `dist/` excluded.
- Dynamic probes: `http://127.0.0.1:8765/api/catalog` was down (connection refused). No runtime traces.
- Architecture note: there are no separate microservices. External integration is OpenAI Chat Completions. WhatsApp is a client-side `wa.me` link, not a server API.

## Executive Summary

Weighted error-handling coverage: **51%** (37 / 72).

Formula, so a later pass can recompute it. 24 failure boundaries. Each scores 0 or 1 on three checks: contained (does not hang or blank the app), honest (user or caller sees the failure, or the work is durably retried; fake live data scores 0), logged (a log line names the failure). Max = 24 × 3 = 72.

| Check | Score | Share |
| --- | --- | --- |
| Contained | 22 / 24 | 92% |
| Honest outcome | 13 / 24 | 54% |
| Logged | 2 / 24 | 8% |
| All three (strict) | 2 / 24 | 8% |

Critical fallbacks and stubs: **5 High**.

Critical unhandled or blocking gaps: **3 High**.

There is no structured logger and no alerting sink (no Sentry, ELK, Datadog, or `logger.error`). HTTP 500 bodies do not include stack traces, passwords, or API keys. Upstream OpenAI error text is still written to the server console.

First-party `TODO` / `FIXME` / `HACK` / `mockResponse` / `dummyData`: **0**.

## Boundary scorecard

`C` contained, `H` honest, `L` logged. 1 = yes.

| # | Boundary | File | C | H | L |
| --- | --- | --- | --- | --- | --- |
| 1 | Catalog miss shows seed products | `src/lib/store.js:211` | 1 | 0 | 0 |
| 2 | Services miss shows seed services | `src/lib/store.js:414` | 1 | 0 | 0 |
| 3 | Missing USD rate becomes 500 | `src/lib/store.js:147` | 1 | 0 | 0 |
| 4 | Catalog poll swallows failure | `src/lib/store.js:485` | 1 | 0 | 0 |
| 5 | Catalog cache write fails closed in memory | `src/lib/store.js:129` | 1 | 1 | 0 |
| 6 | Order submit shows a message and queues | `src/components/RequestGate.jsx:301` | 1 | 1 | 0 |
| 7 | Message sync queues on failure | `src/lib/store.js:618` | 1 | 1 | 0 |
| 8 | Pending flush keeps the queue | `src/lib/store.js:658` | 1 | 1 | 0 |
| 9 | Catalog migration fails silently | `src/pages/AdminPage.jsx:269` | 1 | 0 | 0 |
| 10 | Admin order load shows an error | `src/pages/AdminPage.jsx:462` | 1 | 1 | 0 |
| 11 | Admin client load keeps stale data | `src/pages/AdminPage.jsx:482` | 1 | 0 | 0 |
| 12 | Chat tells the user it fell back to the catalog | `src/components/ChatWidget.jsx:218` | 1 | 1 | 0 |
| 13 | Cart-side chat consult is discarded | `src/components/ChatWidget.jsx:269` | 1 | 0 | 0 |
| 14 | Chat session trim fails with an empty catch | `src/lib/consult.js:40` | 1 | 0 | 0 |
| 15 | OpenAI call times out and is logged | `ai/openai.mjs:23`, `ai/server.mjs:161` | 1 | 1 | 1 |
| 16 | Bad model JSON becomes 502 with no log | `ai/server.mjs:175` | 1 | 1 | 0 |
| 17 | AI process timeout becomes 502 | `server.ps1:76` | 1 | 1 | 0 |
| 18 | Listener catch returns `server_error` | `server.ps1:421` | 1 | 1 | 0 |
| 19 | Order/admin body read has no timeout | `orders-db.ps1:289` | 0 | 0 | 0 |
| 20 | SQLite errors reach HTTP 500; busy wait is 5s | `orders-db.ps1:19` | 1 | 1 | 0 |
| 21 | PDF failure becomes HTTP 500; stderr is printed | `orders-db.ps1:1479` | 1 | 1 | 1 |
| 22 | Chat catalog merge failure becomes 502 | `server.ps1:250` | 1 | 1 | 0 |
| 23 | Client row save is swallowed after the order | `orders-db.ps1:817` | 1 | 0 | 0 |
| 24 | No React error boundary | `src/main.jsx:8` | 0 | 0 | 0 |

## Valid business fallbacks

These are intentional. They are not counted as hidden stubs. They still have no log line.

| File / line | Behavior | Why it is valid |
| --- | --- | --- |
| `src/components/ChatWidget.jsx:198` | On chat API failure, answers from the local catalog and says the link dropped | User is told. Not presented as the remote model. |
| `ai/skills/fallback.mjs:4` | Chat skill used when no other skill matches | Conversation default, not an outage mask. |
| `server.ps1:409` | Unknown extensionless paths serve `dist/index.html` | SPA route fallback. Real missing files still return 404. |
| `pdf/invoice.mjs:292` | Logo recolor failure omits the logo and still writes the PDF | Document stays usable. |
| `src/lib/chat-resize.js:31` | Bad or blocked `localStorage` keeps the default chat size | Preference only. |
| `src/lib/store.js:704` | Image resize failure uploads the original file | Upload still proceeds. |
| `src/lib/store.js:636` | Failed order POST stays in `tamsun_orders_pending` and retries | Durable retry. The empty catch at line 658 should still log. |

## Fallback and stubs registry

| File / line | Type | Problem | Severity | Fix |
| --- | --- | --- | --- | --- |
| `src/lib/store.js:211` | Hidden fallback | `loadProducts()` returns `DEFAULT_PRODUCTS` when memory and `localStorage` cache are empty. The shop renders those three panels as the live catalog. No log, no banner. A failed `/api/catalog` poll (`src/lib/store.js:485`) never replaces this. | High | If the catalog fetch has not succeeded, render an explicit unavailable state. Do not sell seed rows. |
| `src/lib/store.js:414` | Hidden fallback | `loadServices()` returns `DEFAULT_SERVICES` on the same miss. | High | Same gate as products. |
| `src/lib/store.js:83` | Static stub | Non-localhost pages call `http://127.0.0.1:8765`. Remote browsers hit themselves. Catalog then falls through to the seed. | High | Use same-origin relative URLs only. |
| `orders-db.ps1:216` | Static stub | If `ADMIN_PASSWORD` is absent, login uses a string literal in source. `.env` currently has no `ADMIN_PASSWORD`. | High | Refuse login when the env value is missing. Remove the literal. |
| `src/lib/store.js:485` | Hidden fallback | `refreshCatalog().catch(() => {})` every 20s. Stale or seed catalog stays on screen. | High | Surface a catalog-stale flag to the UI and log the error code. |
| `src/lib/store.js:147` | Hidden fallback | Missing or invalid `usdRate` becomes `500` in the client and again in `server.ps1:195`, `orders-db.ps1:468`, `orders-db.ps1:500`. Dollar prices look official. | Medium | Keep the last known rate. If none exists, hide dollar prices. |
| `src/pages/AdminPage.jsx:269` | Hidden fallback | `migrateLocalCatalog` empty catch. A failed upload or save looks like nothing happened, and the migration will retry next login with no operator signal. | Medium | Alert on failure and log `error.message`. |
| `src/pages/AdminPage.jsx:482` | Hidden fallback | Client fetch failure sets `nextClients = null` and leaves the previous list. No `ordersError` for this path. | Medium | Show a clients-load error. Do not keep an unlabeled stale list. |
| `src/components/ChatWidget.jsx:269` | Hidden fallback | `consult()` for a cart phrase is called and the error is discarded before the remote request. | Low | Use the same `localFallback` path as line 256. |
| `src/lib/consult.js:40` | Hidden fallback | Second `sessionStorage` write fails empty. The chat history for this tab is dropped. | Low | Keep the in-memory session and show a one-line warning. |
| `src/lib/store.js:129` | Hidden fallback | Catalog cache write fails empty. Acceptable only while memory still holds the server payload. | Low | Log quota failures once per session. |
| `src/lib/store.js:157` | Hidden fallback | Currency preference parse fails empty, then uses server currency. | Low | No user-facing change. Log once. |
| `orders-db.ps1:817` | Hidden fallback | `Save-TamsunClient` failure is discarded. The order exists; the client book does not. | High | Fail the request or write an error log and a visible admin warning. Do not `catch { }`. |
| `orders-db.ps1:390` | Hidden fallback | `Sync-TamsunClients` returns on query failure. Per-row save and delete at lines 400 and 407 are also empty catches. Startup and order delete can desync the client list. | High | Log and abort the sync. Do not delete clients after a partial failure. |
| `ai/server.mjs:198` | Hidden fallback | Empty model text with product ids becomes the fixed sentence `Вот что подходит из каталога.` HTTP 200. | Low | Treat empty text as 502, or mark the reply as a template. |
| `orders-db.ps1:279` | Parse default | Unparseable client price becomes 0 before the server replaces it with the database price. Not shown as the charged price. | Low | Ignore client money fields. Do not parse them. |

## Unhandled errors registry

| File / line | Place | Missing handling | Risk | Fix |
| --- | --- | --- | --- | --- |
| `orders-db.ps1:289` | API route `Read-JsonBody` | `StreamReader.ReadToEnd()` has no read timeout. Used by orders, login, catalog writes, upload. The listener loop in `server.ps1:172` handles one request at a time. Chat uses `Read-LimitedBody` with an 8s timeout (`server.ps1:104`); these routes do not. | Service hang. New orders wait forever behind one slow body. | Read with the same 8s cap and max-byte check as chat. Return 408. |
| `src/main.jsx:8` | UI root | No error boundary. No `window.onerror`. No `unhandledrejection` handler. | White screen on a render throw. | Add an error boundary around `App` with a reload state. Log the component stack. |
| `src/lib/store.js:460` | External HTTP | `refreshCatalog`, order POST, admin fetches, and upload have no `AbortSignal` timeout. Only chat sets 35s (`src/components/ChatWidget.jsx:275`) and OpenAI sets 20s (`ai/openai.mjs:23`). | Spinner until the browser gives up. Admin actions look frozen. | Pass a 15s `AbortSignal` on every `fetch`. |
| `server.ps1:421` | Global middleware | One listener `catch` returns `{ error: "server_error" }` and drops the exception. | Operator cannot see why a 500 happened. | Log exception type and route. Keep the public body as a code only. |
| `server.ps1:76` | External integration | AI process wait is 25s, then 502. The timeout branch does not log. Stderr from the child is printed raw (`server.ps1:84`). | Slow chats occupy the chat worker. Console may contain upstream text. | Log `ai_timeout` and `ai_exit_<code>`. Do not print raw stderr. |
| `ai/server.mjs:175` | External integration | Invalid model JSON returns 502 with an empty catch. | Silent model-contract break. | `console.error("openai_bad_json")` without the body. |
| `src/lib/store.js:649` | API route client | `flushPendingOrders` uses `continue` on non-OK and an empty `catch` at line 658. 429 and 500 stay queued, which is good, but nothing records the status. | Orders look saved on screen and are still pending. | Log status and leave the queue. |
| `src/components/RequestGate.jsx:242` | UI component | `refreshCatalog()` failure is ignored, then the order continues. | Order can be priced from seed data in the WhatsApp draft until the server reprices. | Block submit when the catalog has never loaded from the server. |
| `orders-db.ps1:19` | DB query | Connection string sets `Busy Timeout=5000`. There is no per-statement timeout beyond that. A locked file stalls the single listener. | Orders pause up to 5s, then 500. | Log `sqlite_busy`. Keep the 5s cap. |
| `src/pages/AdminPage.jsx:746` | API route client | `saveOrder` / `deleteOrder` handle 401 and `!ok`. They do not time out. | Admin status click hangs. | Same 15s abort as other fetches. |

## Logging and alerting

No alerting integration exists.

Places that catch a failure and do not log it:

| File / line | What is dropped |
| --- | --- |
| `src/lib/store.js:129` | `localStorage` quota on catalog cache |
| `src/lib/store.js:157` | Currency preference parse |
| `src/lib/store.js:485` | Catalog poll |
| `src/lib/store.js:618` | Order message sync |
| `src/lib/store.js:658` | Pending-order flush |
| `src/components/RequestGate.jsx:191` | Name/phone read |
| `src/components/RequestGate.jsx:242` | Catalog refresh before submit |
| `src/components/RequestGate.jsx:261` | Name/phone write |
| `src/components/RequestGate.jsx:272` | Order response JSON |
| `src/components/RequestGate.jsx:292` | WhatsApp popup navigation |
| `src/components/RequestGate.jsx:301` | Order network failure (user sees text; log does not) |
| `src/components/ChatWidget.jsx:202` | Local consult failure |
| `src/components/ChatWidget.jsx:269` | Cart consult failure |
| `src/lib/consult.js:40` | Chat session write |
| `src/lib/chat-resize.js:31` | Chat size read |
| `src/lib/chat-resize.js:40` | Pointer capture |
| `src/lib/chat-resize.js:64` | Width save |
| `src/lib/chat-resize.js:74` | Height save |
| `src/pages/AdminPage.jsx:269` | Catalog migration |
| `src/pages/AdminPage.jsx:482` | Clients fetch |
| `server.ps1:16` | CORS header write |
| `server.ps1:250` | Chat catalog merge exception object |
| `server.ps1:421` | Any listener exception |
| `orders-db.ps1:29` | WAL checkpoint |
| `orders-db.ps1:390` | Client sync query |
| `orders-db.ps1:400` | Per-order client save |
| `orders-db.ps1:407` | Client delete |
| `orders-db.ps1:730` | Client update on duplicate order |
| `orders-db.ps1:817` | Client insert after new order |
| `orders-db.ps1:907` | Client resync after delete |
| `ai/server.mjs:175` | Model JSON parse |
| `pdf/invoice.mjs:292` | Logo recolor |

Places that log, and the gap:

| File / line | What is written | Gap |
| --- | --- | --- |
| `ai/server.mjs:163` | `console.error("openai_error " + detail)` | `detail` is up to 300 chars of the upstream body (`ai/openai.mjs:35`). Not sent to the browser. Can land in the server console. |
| `ai/cli.mjs:20` | Same prefix on the CLI catch | Same upstream text risk. |
| `server.ps1:84` | Raw child stderr via `Write-Output` | Unfiltered. |
| `server.ps1:229` | `chat_worker_load ` plus exception message | Console only. The HTTP client still gets `unavailable`. |
| `orders-db.ps1:1486` | PDF stderr | Console only. |

## Error response contract

There is no single schema. Success and error shapes differ.

Observed error body: `{ "error": "<code>" }`.

Codes in use: `method`, `bad_json`, `empty`, `too_large`, `unauthorized`, `rate`, `unknown_product`, `unavailable`, `empty_cart`, `not_found`, `server_error`, plus product validation codes `bad_id`, `name`, `image`, `too_many`.

Status mapping is inconsistent for the same word `unavailable`:

| Status | Where |
| --- | --- |
| 409 | Hidden product on `POST /api/orders` (`orders-db.ps1:1848`) |
| 500 | PDF or generic failure |
| 502 | OpenAI, chat worker, AI process |
| 503 | Chat worker not ready (`server.ps1:276`) |

Not leaked on HTTP 500: stack traces, SQL text, `.env` values, filesystem paths. `server.ps1:425` returns only `server_error`.

Not a unified problem document (no `type`, `title`, `status`, `detail`). Clients special-case a few codes in `src/components/RequestGate.jsx:114`.

## Code snippets for High findings

### 1. Seed catalog shown as live

Current (`src/lib/store.js:211`):

```javascript
export function loadProducts() {
  if (Array.isArray(catalogState.products)) return catalogState.products.map(normalizeProduct);
  const cache = readCatalogCache();
  if (cache) return cache.products.map(normalizeProduct);
  return DEFAULT_PRODUCTS.map(normalizeProduct);
}
```

Current poll (`src/lib/store.js:482`):

```javascript
export function startCatalogSync() {
  if (syncTimer) return () => {};
  const tick = () => {
    refreshCatalog().catch(() => {});
  };
```

Proposed:

```javascript
let catalogLoaded = false;
let catalogError = "";

export function getCatalogStatus() {
  return { loaded: catalogLoaded, error: catalogError };
}

export function loadProducts() {
  if (!catalogLoaded) return [];
  return catalogState.products.map(normalizeProduct);
}

const tick = () => {
  refreshCatalog()
    .then(() => {
      catalogLoaded = true;
      catalogError = "";
    })
    .catch((error) => {
      catalogError = error && error.message ? error.message : "catalog";
      console.error("catalog_sync_failed", catalogError);
    });
};
```

Shop grid should render “каталог недоступен” when `loaded` is false. Apply the same gate in `loadServices()`.

### 2. API host stub

Current (`src/lib/store.js:83`):

```javascript
export function apiUrl(path) {
  if (location.hostname === "127.0.0.1" || location.hostname === "localhost") return path;
  return "http://127.0.0.1:8765" + path;
}
```

Proposed:

```javascript
export function apiUrl(path) {
  return path;
}
```

Serve the API on the same origin as the site.

### 3. Admin password literal

Current (`orders-db.ps1:206`):

```powershell
function Get-TamsunAdminKey {
  $path = Join-Path $root ".env"
  if (Test-Path $path) {
    foreach ($line in @(Get-Content -Path $path)) {
      $line = [string]$line
      if ($line -match '^ADMIN_PASSWORD\s*=\s*(.+)$') {
        return $Matches[1].Trim().Trim('"').Trim("'")
      }
    }
  }
  return "hardcoded-fallback"
}
```

Proposed:

```powershell
function Get-TamsunAdminKey {
  # read ADMIN_PASSWORD from .env as today
  if ($found.Length -lt 12) { return $null }
  return $found
}

function New-TamsunAdminToken([string]$password) {
  $expected = [string](Get-TamsunAdminKey)
  if ($expected.Length -eq 0) { return $null }
  # existing constant-time compare and token issue
}
```

### 4. Order body read can stall the process

Current (`orders-db.ps1:289`):

```powershell
function Read-JsonBody($ctx, $maxBytes) {
  $reader = New-Object System.IO.StreamReader($ctx.Request.InputStream, [Text.Encoding]::UTF8)
  $raw = $reader.ReadToEnd()
  $reader.Close()
```

Proposed: route order, login, catalog, and upload bodies through `Read-LimitedBody` (`server.ps1:100`), which already sets an 8s read timeout and stops at `maxBytes`. Map `unavailable` to HTTP 408 and `too_large` to HTTP 413.

### 5. No UI error boundary

Current (`src/main.jsx:8`):

```javascript
createRoot(document.getElementById("root")).render(
  <StoreProvider>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StoreProvider>
);
```

Proposed:

```javascript
class RootError extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error) {
    console.error("ui_render_failed", error && error.name);
  }
  render() {
    if (this.state.failed) return <p>Страница не открылась. Обновите её.</p>;
    return this.props.children;
  }
}
```

Wrap `App` in `RootError`. Add `window.addEventListener("unhandledrejection", ...)`.

### 6. Client book updates swallowed

Current (`orders-db.ps1:817`):

```powershell
try { Save-TamsunClient $customerName $customerPhone | Out-Null } catch { }
```

Same pattern at `orders-db.ps1:400`, `orders-db.ps1:407`, `orders-db.ps1:730`, `orders-db.ps1:907`.

Proposed:

```powershell
try {
  Save-TamsunClient $customerName $customerPhone | Out-Null
} catch {
  Write-Output ("client_save_failed " + $_.Exception.GetType().Name)
}
```

Do not continue `Sync-TamsunClients` into deletes if the order query threw (`orders-db.ps1:390`). Return after a log line.

## Suggested fix order for the architect

1. `apiUrl` same-origin, and stop rendering `DEFAULT_PRODUCTS` / `DEFAULT_SERVICES` before a successful catalog response.
2. Remove the admin password literal. Require `ADMIN_PASSWORD` in `.env`.
3. Put every request body on the 8s limited reader.
4. Add the root error boundary.
5. Log client-sync failures and stop silent deletes.
6. Add one `console.error(code)` (or PowerShell `Write-Output`) on the empty catches listed above. Do not log upstream response bodies.

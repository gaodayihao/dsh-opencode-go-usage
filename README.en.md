# dsh-opencode-go-usage

English | [中文](README.md)

[![npm](https://img.shields.io/npm/v/dsh-ocgo-usage)](https://www.npmjs.com/package/dsh-ocgo-usage)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![awesome · DSH plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)

![Footer demo](assets/custom-footer.png)

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh) **bundle** that shows [OpenCode Go](https://opencode.ai/docs/go/) subscription usage in the Web GUI's composer dock — the same seat as the built-in conversation stats line.

The Web counterpart of the [pi-ocgo-usage](https://github.com/v587d/pi-ocgo-usage) Pi extension: three usage windows (rolling 5h, weekly, monthly) with percentages and reset countdowns, color-coded so you see a window approaching exhaustion before you hit the rate limit mid-work.

```
OpenCode Go: 5h 0% · wk 0% · mo 95%
```

Expanding the panel also shows each window's absolute spend — Go's windows are **money** allowances ($12 / $30 / $60):

```
5h Rolling   0.0%   $0.00 / $12.00 · resets in 0s
Weekly       0.0%   $0.00 / $30.00 · resets in 5d 21h
Monthly     94.7%   $56.84 / $60.00 · resets in 7d 0h
```

## Features

- **Three windows** — rolling (5h) / weekly / monthly percent + reset countdown
- **Dollar allowances** — Go's windows are money caps ($12 / $30 / $60); the detail panel shows `$used / $limit`, which explains the percentage
- **Color thresholds** — muted → warning (≥80%) → error (≥90% or rate-limited)
- **Data freshness** — `upd HH:MM` shows the last successful fetch time; the countdown is re-derived from the absolute reset time, so the host cache cannot freeze it
- **Lightweight polling** — every 10 s (and on tab refocus); the host caches for 300 s (TTL configurable) with a 60 s failure cooldown, so opencode.ai is never hammered
- **Provider-aware** — the chip shows only while the session's selected model routes through the `opencode-go` provider. Visibility reads the session's `modelSelection` projection through the framework standard seat `useProjection`, so switching to e.g. DeepSeek official via the composer or `/model` hides it on the same render and switching back re-shows it (mirrors pi-ocgo-usage)
- **Click to expand** — detail panel with per-window spend and reset countdowns, a `Set` credential editor, and `refresh upd HH:MM`
- **Built-in credential editor** — no terminal needed: the `Set` panel edits workspace id and cookie in place (fields show `••••` + last 4 chars; click outside / Esc / Save confirms the write)
- **Graceful degradation** — missing config shows `<err:noconfig>`, an expired session `<err:unauthorized>`, other HTTP failures `<err:httpXXX>`; on error, clicking the chip opens the Set editor directly
- **Cookie stays on the host** — the browser only ever talks to the same-origin `/api/ocgo-usage` JSON endpoint; the cookie never reaches the page

> **⚠️ Requires an OpenCode Go console session cookie.** The cookie is a full user session (not an API key) and grants access to your entire OpenCode account. Treat it like a password — see [Configuration](#configuration).

## Requirements

- DeepSeek Harness `0.1.5-rc.1` or newer (web profile). The `0.1.0-rc.6`-era `session.models` Remote this plugin used to read was removed in a later release; provider detection now rides the session projection (see [How it works](#how-it-works))
- pnpm on `PATH` (for `dsh plugin`)

## Installation

This package is a standard dsh **bundle**: it declares `dsh.bundle` in its manifest and installs through `dsh plugin --profile web add <spec>` (a pnpm forwarder), which links the package and appends it to the profile's `dsh.profile.bundles`. The repo ships pre-built `lib/` artifacts, so **no build step or install-time build permission is needed** — this follows the official [publish guide](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md).

### From GitHub (recommended for users)

```sh
dsh plugin --profile web add github:gaodayihao/dsh-opencode-go-usage
```

Because `lib/` is committed, pnpm installs the built package directly and never asks for a build-script allowance.

### From a tarball

```sh
pnpm pack            # in this repo → dsh-ocgo-usage-0.1.0.tgz
dsh plugin --profile web add ./dsh-ocgo-usage-0.1.0.tgz
```

### From a local checkout (development)

```sh
git clone https://github.com/gaodayihao/dsh-opencode-go-usage.git
cd dsh-opencode-go-usage
pnpm install
pnpm run build
dsh plugin --profile web add link:$(pwd)
```

**Restart `dsh web`, then refresh the page.** The usage chip appears in the composer dock next to the conversation stats line. Verify the plugin layer is composed without booting:

```sh
dsh --profile web --dump-config   # shows a "# == dsh-ocgo-usage" layer
```

## Configuration

### Option 1: the in-UI Set panel (easiest)

Click the chip to expand → `Set` (bottom-left) → type the workspace id and cookie (existing values show as `••••` + last 4 chars; focus a field to type a replacement) → click outside / press Esc / hit Save — it takes effect immediately.

![Set editor](assets/set-cookie-wid.png)

### Option 2: environment variables (same names as pi-ocgo-usage)

```sh
export OPENCODE_GO_COOKIE="__Host-console_session=st_...; auth=Fe26.2*...; oc_locale=en"
export OPENCODE_GO_WORKSPACE_ID="wrk_01XXXXXXXXXXXXXXXXXXXXXXXX"
```

> **`__Host-console_session` is required.** The console API authenticates only on that session cookie; `auth=` alone answers `401`. The easiest route is to **paste the whole** opencode.ai cookie from your browser — unrelated entries (`oc_locale`, `__stripe_*`, …) are dropped automatically. A bare `st_...` handle works too (the prefix is added for you).

### Option 3: config file

Write `$DSH_HOME/ocgo-usage.json` (default `~/.dsh/ocgo-usage.json`):

```jsonc
{
  "cookie": "__Host-console_session=st_...; auth=Fe26.2*...",
  "workspaceID": "wrk_01XXXXXXXXXXXXXXXXXXXXXXXX"
}
```

```sh
chmod 600 ~/.dsh/ocgo-usage.json
```

Priority: env vars > config file > built-in defaults.

### Optional overrides

| Env var | Default | Description |
|---|---|---|
| `OPENCODE_GO_BASE_URL` | `https://opencode.ai` | Console origin (the plugin appends the `/console/api/go/status` path) |
| `OPENCODE_GO_CACHE_TTL` | `300` | Host cache TTL in seconds, clamped to 60–3600 |
| `OPENCODE_GO_TIMEOUT_MS` | `10000` | HTTP timeout |

Composition-level config (via `~/.dsh/profiles/web/cordis.patch.yml`):

```yaml
- id: ocgo-usage
  config:
    enabled: false    # master switch, default true
```

> **Cookie expiration:** when the console session cookie expires (or you sign out) the API answers `401` and the chip shows `<err:unauthorized>` instead of stale numbers. Re-login to opencode.ai and paste the fresh whole cookie via the Set panel.

## Usage

Click the chip to expand the detail panel: each window shows its full name, percent, `$used / $limit`, and reset countdown; `refresh upd HH:MM` (bottom-right) refreshes manually and shows the data time.

![Usage detail](assets/usage-detail.png)

## How it works

- **Host half** (`src/index.ts`, `src/service.ts`, `src/api.ts`, `src/routes.ts`) — sends the cookie plus an `x-org-id: <wrk_…>` header to the console's `GET /console/api/go/status` and maps the three money meters it returns (`fiveHour` / `week` / `month`, in microcents — 1e-8 USD) onto the rolling / weekly / monthly windows: percent = `used / limit`, countdown from `resetsAt` (the monthly meter borrows the subscription period's `access.endsAt`, exactly as the official console page does). The result is cached and served as same-origin JSON at `/api/ocgo-usage` (+ `/api/ocgo-usage/refresh`, `/api/ocgo-usage/config`).
- **Browser half** (`src/client/`) — registers a chip into the composer tool row via `ctx.slots.inject('conversation.input.right', …)` (declaration-deferred: the composer bar owns the slot, so the plugin needs no load-order dependency), polls the host endpoints every 10 s while — and only while — the session selects `opencode-go`, and renders the three windows with severity colors; visibility comes from the framework standard seat `useProjection('modelSelection')`.

The browser never sees the cookie; all fetching and parsing happen on the host.

> The console's `GET /console/api/usage/*` endpoints (token detail) carry **no** Go subscription usage — the plan's allowance only shows up in the `go/status` money meters, which is why this plugin reports dollars and percentages rather than token counts.

## Security

- The console session cookie is a **full OpenCode user session** (`__Host-console_session` + `auth`). Anyone with it can access every workspace, subscription, and billing detail in your account.
- The plugin **never** logs the cookie, includes it in error messages, or sends it to the browser; it also does not forward a paste verbatim — only the three known names (`__Host-console_session`, `console_session`, `auth`) are kept and everything else (`__stripe_*`, UI preferences, …) is dropped.
- The config editor only writes new values to `$DSH_HOME/ocgo-usage.json` (chmod 600); the browser only ever sees the `••••` + last-4 masked view.

## Development

```sh
pnpm install
pnpm run build     # tsc -b && tsdown → lib/
pnpm run typecheck # tsc -b + tsconfig.vitest.json (sources + tests)
pnpm test          # vitest run (API adapter / config / service / provider / chip render)
```

`pnpm test` loads the **built** `lib/client.js` (`src/client/registration.test.ts`) to check the browser half's registration contract, so run `pnpm run build` before `pnpm test` after a source change; `src/client/chip.test.tsx` renders the component source directly and covers the provider gate.

The build config (`shared/tsdown.client.ts`) is adapted from [dsh-balance-meter](https://github.com/Ghost011118/dsh-balance-meter) (BSD-3-Clause), itself a copy of the official DSH `packages/client/tsdown.client.ts` — it emits the `window.__ModuleLoader__.load({id, factory})` closure-factory artifact the web shell's module table consumes. `shared/web-platform.ts` must stay in sync with the installed DSH's `packages/client/web/src/platform.ts`.

## Changelog

### v0.2.1 — Detail panel no longer wraps

- **The panel sizes to its content**: it was pinned at `min-width: 220px`, too narrow for one window row (`5h Rolling · 2.1% · $0.25 / $12.00 · resets in 4h 30m`), so both the label and the countdown broke onto a second line. It is now `width: max-content` (floor 240px, cap `min(92vw, 420px)`) and each row is `white-space: nowrap`, so the label, percent and spend/countdown stay on one line.
- **The panel is right-aligned and grows leftward**: the chip sits at the right end of the composer row, so a centred popup wide enough for a full row ran off the right edge of the window. The panel's right edge now tracks the chip. The credential editor takes a definite `width: 300px` so its long hint text keeps wrapping instead of stretching the max-content box.
- **Footer buttons keep their label**: `Set` / `Refresh` / `Save` are `flex: none; white-space: nowrap` and the long hint is `flex: 1 1 auto; min-width: 0`. `Save` used to be squeezed by the hint into a stacked "保 / 存".

### v0.2.0 — Console rebuild: switch to the Go subscription API

**🔴 Urgent fix**: opencode.ai rebuilt its console as a **client-side SPA** around 2026-09. `GET /console/wrk_.../go` no longer server-renders any numbers (it is now a 1.4 KB `<div id="app">` shell), so the old page-scraping release could not read usage at all — the chip only ever showed an error. The plugin now calls the JSON API the console itself uses:

```
GET https://opencode.ai/console/api/go/status
Cookie: __Host-console_session=st_...; auth=Fe26.2*...
x-org-id: wrk_01XXXXXXXXXXXXXXXXXXXXXXXX
```

- **Authentication changed**: the API only accepts `__Host-console_session` (the `st_...` session handle); the older `auth=Fe26.2*...` cookie alone now answers **401**. `normalizeCookie` was rewritten accordingly: it recognizes `__Host-console_session` / `console_session` / `auth`, emits them in a stable order, prefixes a bare `st_...`, drops `oc_locale` (only ever needed to steer the server-rendered page) and never forwards unrelated cookies. **An old `auth=...; oc_locale=...` config must be re-pasted as the whole cookie.**
- **The unit changed**: Go's windows are now **money** caps (measured at $12 / 5h, $30 / week, $60 / month), carried as BigInt decimal strings in microcents (1e-8 USD). The adapter maps `fiveHour` / `week` / `month` onto rolling / weekly / monthly, percent = `used / limit` (one decimal), rate-limited at `≥100%`; the monthly reset comes from the subscription period's `access.endsAt` (its meter has no `resetsAt` of its own), matching the official console page.
- **Absolute spend added**: `UsageWindow.usage` / `limit` now carry microcents, and the detail panel shows `$used / $limit`.
- **The countdown is no longer frozen by the cache**: `UsageWindow` gained an absolute `resetsAt`, so the browser re-derives the remaining time instead of replaying the stale seconds baked into a 300 s-old cached snapshot.
- **Clearer errors**: `401` → `<err:unauthorized>` (re-login and paste a fresh cookie), `400` → `<err:badworkspace>` (wrong workspace id), `404` → `<err:notfound>` (unknown workspace or no Go subscription), non-JSON body → `<err:parse>`.
- **Dead code removed**: the SSR page parser (`fromSSRHTML`, `parseDurationToSec`, and both the embedded-payload and rendered-markup paths) is gone — the page it parsed no longer exists. Exports are now `fromStatusJSON`, `GO_STATUS_PATH`, `WORKSPACE_HEADER`.
- **Also**: `tsconfig` no longer emits `*.test.tsx` artifacts into `lib/types/`, and stale build chunks were cleaned out of `lib/`. `pnpm test` covers 80 tests.

### v0.1.2 — Correct usage values + DSH 0.1.5 compatibility

**Usage readout fixed**: the old parser scraped the rendered HTML, where the numbers are wrapped in Solid comment markers and rendered as integers — so the readings were wrong (rolling/weekly failed to parse and monthly came out as a bogus 100% rate-limited). The host now reads the page's **embedded server payload** (`rollingUsage` / `weeklyUsage` / `monthlyUsage`):

- real fractional percents (`11.4%`, `65.9%`, `42%`) instead of rounded integers;
- `resetInSec` taken straight from the server instead of parsed from copy like "23 天 1 小时" (that phrase parsing also mis-computed zh durations);
- the absolute `usage` / `limit` values are now carried through the JSON endpoint;
- UI-language independent (no reliance on "滚动用量" / "5 小时用量" labels);
- the rendered-markup path stays as a fallback, with its regexes fixed (decimals + the zh `重置于` phrasing).

**DSH 0.1.5 compatibility**: after DSH moved from `0.1.0-rc.6` to `0.1.5-rc.1` the chip vanished entirely.

- **Provider gate moved to the session projection**: the old code read the `session.models` Remote for the current provider. That Remote no longer exists on `dsh-api-session-controller` (it is now `selectModel` / `modelCatalog`), so the read threw, the `catch` swallowed it, the provider stayed `undefined`, and the chip never rendered. The chip now reads the framework standard seat `useProjection('modelSelection')` (the durable model-selection projection the host pushes), so a provider switch takes effect on the same render instead of the next poll.
- **Slot registration is declaration-deferred**: `ctx.slots.inject('conversation.input.right', …)` replaces `ctx.inject(['slots','conversation','connection'], …)` — no assumption that the slot already exists, and no dependency on the `connection` service shape.
- **Build aligned**: `shared/web-platform.ts` synced to 0.1.5 (`dsh-client-store`, `dsh-client-ui-dockkit` in; the removed `dsh-client-web-react` / `dsh-client-schema-form` out); compile-time SDK deps pinned to `0.1.5-rc.2`.
- **Regression tests**: chip render tests (provider gate, error state, expand) plus a built-artifact registration test — 72 tests total.

## License

MIT — see [LICENSE](./LICENSE).

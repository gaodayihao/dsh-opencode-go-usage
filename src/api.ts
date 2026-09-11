/**
 * HTTP fetch + response adapters for dsh-ocgo-usage
 *
 * Cookie path (current): GET /workspace/<wrk>/go and read the usage numbers out
 * of the served page. The page both renders the numbers (SolidStart
 * `data-slot="usage-*"` markup) and embeds the raw server-function payload that
 * produced them (`rollingUsage / weeklyUsage / monthlyUsage` object literals).
 * The embedded payload is the authoritative source: it carries fractional
 * percents, exact `resetInSec`, the absolute usage/limit, and is independent of
 * the UI locale and of the rendered markup's comment wrapping. The rendered
 * markup is kept as a fallback for a page that stops embedding the payload.
 * (The proposed official API from anomalyco/opencode#16513 is not merged yet;
 * when it ships, an apikey path can be added behind the same `NormalizedUsage`
 * shape.)
 *
 * Adapted from pi-ocgo-usage/src/api.ts.
 * @module dsh-ocgo-usage/api
 */

import type { NormalizedUsage, OcgoConfig, UsageWindow, UsageWindowKind } from './types.ts'

// ============================================================================
// Errors
// ============================================================================

/** Error thrown by the HTTP / parsing layer; carries a short code for the UI. */
export class UsageError extends Error {
  override readonly name = 'UsageError'
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message)
  }
}

// ============================================================================
// HTTP wrapper
// ============================================================================

/** Text fetch with structured errors (cookie SSR path). */
async function safeFetchText(url: string, headers: Record<string, string>, timeoutMs: number): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers,
      signal: controller.signal,
    })
    if (!res.ok) {
      throw new UsageError(`HTTP ${res.status} for ${sanitizeUrl(url)}`, `http${res.status}`)
    }
    return await res.text()
  } catch (e) {
    if (e instanceof UsageError) throw e
    if (e instanceof Error && e.name === 'AbortError') {
      throw new UsageError(`Request timed out after ${timeoutMs}ms`, 'timeout')
    }
    throw new UsageError(String(e instanceof Error ? e.message : e), 'fetch')
  } finally {
    clearTimeout(timer)
  }
}

/** Strip query params from a URL for safe error messages. */
function sanitizeUrl(url: string): string {
  try {
    const u = new URL(url)
    return `${u.protocol}//${u.host}${u.pathname}`
  } catch {
    return url
  }
}

// ============================================================================
// Cookie path: GET /workspace/<wrk>/go (uses page payload, then rendered markup)
// ============================================================================

/** Fetch usage through the cookie path. Throws UsageError on any failure. */
export async function fetchViaCookie(cfg: OcgoConfig): Promise<Omit<NormalizedUsage, 'updatedAt'>> {
  if (!cfg.cookie || !cfg.workspaceID) {
    throw new UsageError('Missing cookie or workspaceID for cookie path', 'noconfig')
  }
  const url = `${cfg.baseUrl}/workspace/${encodeURIComponent(cfg.workspaceID)}/go`
  const html = await safeFetchText(
    url,
    { Cookie: cfg.cookie, Accept: 'text/html' },
    cfg.timeoutMs,
  )
  const parsed = fromSSRHTML(html)
  // The page 302-redirects to the login page when the cookie is invalid;
  // that page parses as empty, which is indistinguishable from "no windows".
  // Only report success when at least one window was found.
  if (parsed.rolling === undefined && parsed.weekly === undefined && parsed.monthly === undefined) {
    throw new UsageError('Usage page parsed empty (cookie expired or invalid?)', 'http302')
  }
  return parsed
}

/** Map each usage window to the key its object carries in the page payload. */
const EMBEDDED_KEYS: Record<UsageWindowKind, string> = {
  rolling: 'rollingUsage',
  weekly: 'weeklyUsage',
  monthly: 'monthlyUsage',
}

/**
 * Read the balanced `{...}` object literal that follows `key:` starting at
 * `from`. Honors double-quoted string literals (and their escapes) so a brace
 * inside a string cannot unbalance the scan.
 * @param html - the page body.
 * @param from - index of the `{` to start at.
 * @returns the literal text including both braces, or undefined when unbalanced.
 */
function readObjectLiteral(html: string, from: number): string | undefined {
  if (html[from] !== '{') return undefined
  let depth = 0
  let quote = false
  let escaped = false
  for (let i = from; i < html.length; i++) {
    const char = html[i]!
    if (quote) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') quote = false
      continue
    }
    if (char === '"') quote = true
    else if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return html.slice(from, i + 1)
    }
  }
  return undefined
}

/** Parse one finite number from an unknown payload member. */
function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/**
 * Read one member out of a captured object literal.
 *
 * The console emits these literals as minified JavaScript object literals with
 * UNQUOTED keys (`{status:"ok",resetInSec:13664,usagePercent:11.4}`), so this
 * deliberately does not `eval` them: it matches the member and reads a number
 * or a quoted string. That keeps a page-authored string from ever reaching the
 * host as code.
 * @param literal - the captured `{...}` text.
 * @param key - member name.
 * @returns the raw member text, or undefined when absent.
 */
function memberOf(literal: string, key: string): string | undefined {
  const pattern = new RegExp(
    `["']?\\b${key}\\b["']?\\s*:\\s*("(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*'|!?[A-Za-z_$][\\w$]*|-?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)`,
  )
  return pattern.exec(literal)?.[1]
}

/** Read a numeric member (unquoted numeric literal) from the captured object. */
function numericMember(literal: string, key: string): number | undefined {
  const raw = memberOf(literal, key)
  if (raw === undefined) return undefined
  const value = Number(raw)
  return Number.isFinite(value) ? value : undefined
}

/** Read a string member (quoted literal) from the captured object. */
function stringMember(literal: string, key: string): string | undefined {
  const raw = memberOf(literal, key)
  if (raw === undefined) return undefined
  if (raw.startsWith('"')) {
    try {
      return JSON.parse(raw) as string
    } catch {
      return raw.slice(1, -1)
    }
  }
  if (raw.startsWith('\'')) return raw.slice(1, -1)
  return /^[A-Za-z_$][\w$]*$/.test(raw) ? raw : undefined
}

/**
 * Extract one window from the embedded payload. The page carries several
 * occurrences of each key (a null/shorthand declaration plus the populated
 * object), so every occurrence is scanned and the last one carrying a numeric
 * `usagePercent` wins.
 * @param html - the page body.
 * @param kind - which window to read.
 * @returns the window, or undefined when the payload carries no value for it.
 */
function embeddedWindow(html: string, kind: UsageWindowKind): UsageWindow | undefined {
  const key = EMBEDDED_KEYS[kind]
  let found: UsageWindow | undefined
  let at = html.indexOf(`${key}:`)
  while (at >= 0) {
    const brace = html.indexOf('{', at + key.length + 1)
    if (brace >= 0) {
      const literal = readObjectLiteral(html, brace)
      if (literal !== undefined) {
        const percent = numericMember(literal, 'usagePercent')
        if (percent !== undefined) {
          const usage = numericMember(literal, 'usage')
          const limit = numericMember(literal, 'limit')
          const resetInSec = numericMember(literal, 'resetInSec')
          const status = stringMember(literal, 'status')
          found = {
            kind,
            percent: clampPercent(percent),
            resetInSec: Math.max(0, Math.floor(resetInSec ?? 0)),
            status: status === 'rate-limited' || (status === undefined && percent >= 100)
              ? 'rate-limited'
              : 'ok',
            ...(usage === undefined ? {} : { usage }),
            ...(limit === undefined ? {} : { limit }),
          }
        }
      }
    }
    at = html.indexOf(`${key}:`, at + key.length + 1)
  }
  return found
}

/**
 * Parse the embedded server payload for all three windows.
 * @param html - the page body.
 * @returns the windows the payload carried.
 */
function fromEmbeddedData(html: string): Omit<NormalizedUsage, 'updatedAt'> {
  const result: {
    rolling?: UsageWindow
    weekly?: UsageWindow
    monthly?: UsageWindow
  } = {}
  for (const kind of ['rolling', 'weekly', 'monthly'] as const) {
    const window = embeddedWindow(html, kind)
    if (window !== undefined) result[kind] = window
  }
  return result
}

/**
 * Parse the rendered `data-slot="usage-item"` markup. Kept as the fallback
 * path: the numbers here are the same values, but rendered (comment-wrapped,
 * UI-language labels) rather than raw. Percent is matched as a decimal and the
 * reset phrase as the text after the phrase marker, so both the `<--$-->11.4
 * <!--/-->%` and the `Resets in<!--/--> 3 hours` shapes parse.
 * @param html - the page body.
 * @returns the windows the markup rendered.
 */
function fromUsageItems(html: string): Omit<NormalizedUsage, 'updatedAt'> {
  // Each usage-item is a `<div data-slot="usage-item">...</div>` block, but
  // the markup inside may itself contain nested divs (usage-header,
  // progress bar, ...). Instead of trying to find the block's closing tag
  // with a regex, we slice between consecutive item start tags — that keeps
  // the whole block (including any nested divs) in one piece.
  const itemStartRe = /<div[^>]*data-slot="usage-item"/g
  const starts: number[] = []
  let startMatch = itemStartRe.exec(html)
  while (startMatch !== null) {
    starts.push(startMatch.index)
    startMatch = itemStartRe.exec(html)
  }

  const result: {
    rolling?: UsageWindow
    weekly?: UsageWindow
    monthly?: UsageWindow
  } = {}
  for (let i = 0; i < starts.length; i++) {
    const block = html.slice(starts[i], starts[i + 1] ?? html.length)
    const labelMatch = block.match(/data-slot="usage-label"[^>]*>([^<]+)</)
    const valueMatch = block.match(/data-slot="usage-value"[\s\S]*?(\d+(?:\.\d+)?)\s*(?:<!--[^>]*-->\s*)?%/)
    if (!labelMatch || !valueMatch) continue
    const kind = labelToKind(labelMatch[1]?.trim() ?? '')
    if (kind === undefined) continue
    // The page renders the reset phrase in the UI locale — "Resets in"
    // (en) or "重置于" (zh) — so accept both, taking the text that follows the
    // phrase (the phrase itself is often wrapped in a comment marker).
    const resetMatch = block.match(/(?:Resets in|重置于)([\s\S]*?)(?:<\/span>|<\/div>|$)/)
    const percent = Number.parseFloat(valueMatch[1] ?? '0')
    const resetsIn = resetMatch ? stripHtmlComments(resetMatch[1] ?? '') : ''
    result[kind] = {
      kind,
      percent: clampPercent(percent),
      resetInSec: parseDurationToSec(resetsIn),
      status: percent >= 100 ? 'rate-limited' : 'ok',
    }
  }
  return result
}

/**
 * Parse the opencode console usage page and extract the three usage windows.
 *
 * Order of preference:
 *  1. the embedded server payload (`rollingUsage` / `weeklyUsage` /
 *     `monthlyUsage`) — authoritative values, exact reset seconds, absolute
 *     usage/limit, independent of the UI locale;
 *  2. the rendered `data-slot="usage-item"` markup, with reset phrases parsed
 *     into a coarse `resetInSec` estimate.
 * @param html - the served page body.
 * @returns the windows found on the page.
 */
export function fromSSRHTML(html: string): Omit<NormalizedUsage, 'updatedAt'> {
  const embedded = fromEmbeddedData(html)
  const rendered = fromUsageItems(html)
  return { ...rendered, ...embedded }
}

function labelToKind(label: string): UsageWindowKind | undefined {
  const lower = label.toLowerCase()
  // English labels ("Rolling Usage", "Weekly Usage", "Monthly Usage").
  if (lower.startsWith('rolling')) return 'rolling'
  if (lower.startsWith('weekly')) return 'weekly'
  if (lower.startsWith('monthly')) return 'monthly'
  // zh labels: the current console renders "5 小时用量" / "每周用量" /
  // "每月用量"; older/other renderings used "滚动用量".
  if (lower.startsWith('滚动') || lower.includes('小时')) return 'rolling'
  if (lower.startsWith('每周') || lower.includes('周')) return 'weekly'
  if (lower.startsWith('每月') || lower.includes('月')) return 'monthly'
  return undefined
}

/** Strip SolidStart HTML comments `<!-- ... -->` from a string. */
function stripHtmlComments(s: string): string {
  return s.replace(/<!--[\s\S]*?-->/g, '').trim()
}

/**
 * Parse a human duration phrase into seconds. Examples (English plus the
 * Chinese renderings used by the zh locale):
 *   "2 hours 29 minutes" → 8940      "2 小时 29 分钟" → 8940
 *   "45 minutes"          → 2700     "45 分钟"         → 2700
 *   "5 days"              → 432000   "5 天"            → 432000
 *   "30 seconds"          → 30       "30 秒"           → 30
 *   "1 week"              → 604800   "1 周"            → 604800
 *   "1 month"             → 2592000  "1 个月"          → 2592000
 *   "1 year"              → 31536000 "1 年"            → 31536000
 *
 * Returns 0 on unrecognized input.
 */
export function parseDurationToSec(phrase: string): number {
  if (!phrase) return 0
  // Defensive: SolidStart may leave `<!--/-->` markers inside the captured
  // reset phrase; strip them before matching (see stripHtmlComments).
  const cleaned = phrase.replace(/<!--[\s\S]*?-->/g, ' ')
  const p = cleaned.trim().replace(/\s+/g, ' ').toLowerCase()
  if (!p) return 0

  // The numeric unit can be separated from its unit word by a space on the zh
  // page ("3 小时 47 分钟"), so the space is optional; the plural `s` stays
  // outside the captured unit so the switch below sees the singular form.
  const re = /(\d+)\s*(?:个\s*)?(second|minute|hour|day|week|month|year|秒|分钟|小时|天|周|月|年)s?/g
  let total = 0
  let matched = false
  let m = re.exec(p)
  while (m !== null) {
    const n = Number.parseInt(m[1] ?? '0', 10)
    const unit = m[2] ?? ''
    matched = true
    switch (unit) {
      case 'second':
      case '秒':
        total += n
        break
      case 'minute':
      case '分钟':
        total += n * 60
        break
      case 'hour':
      case '小时':
        total += n * 3600
        break
      case 'day':
      case '天':
        total += n * 86400
        break
      case 'week':
      case '周':
        total += n * 604800
        break
      case 'month':
      case '月':
        total += n * 2592000 // 30 days; coarse but adequate for display
        break
      case 'year':
      case '年':
        total += n * 31536000
        break
    }
    m = re.exec(p)
  }
  return matched ? total : 0
}

// ============================================================================
// Orchestrator
// ============================================================================

/**
 * Fetch usage with the current config (cookie path only today) and stamp
 * the fetch timestamp so the UI can show data freshness.
 */
export async function fetchUsage(cfg: OcgoConfig): Promise<NormalizedUsage> {
  const data = await fetchViaCookie(cfg)
  return { ...data, updatedAt: Date.now() }
}

// ============================================================================
// Internal helpers
// ============================================================================

/**
 * Clamp a percent into [0, 100] keeping at most one decimal (the console
 * reports fractional usage, e.g. 11.4).
 * @param n - raw percent from the page.
 * @returns the clamped percent.
 */
function clampPercent(n: number | undefined): number {
  if (n === undefined || !Number.isFinite(n)) return 0
  const bounded = Math.max(0, Math.min(100, n))
  return Math.round(bounded * 10) / 10
}

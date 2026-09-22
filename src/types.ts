/**
 * Shared types for dsh-ocgo-usage.
 * @module dsh-ocgo-usage/types
 */

/** One of the three OpenCode Go usage windows. */
export type UsageWindowKind = 'rolling' | 'weekly' | 'monthly'

/**
 * Microcents per US dollar — the unit the console API reports its Go
 * subscription meters in (100,000,000 microcents = $1).
 */
export const MICROCENTS_PER_USD = 100_000_000

/** Whether the window is still usable or the account is rate-limited. */
export type UsageStatus = 'ok' | 'rate-limited'

/**
 * One usage window: percent used + seconds until reset.
 *
 * Since the console moved to the Go subscription API the windows are
 * **money-denominated meters**: each one caps a spend amount rather than a
 * token count. {@link usage} / {@link limit} therefore carry microcents
 * (1e-8 USD, the unit the console API reports), and {@link percent} is the
 * `usage / limit` ratio the console itself renders.
 */
export interface UsageWindow {
  /** Window identity. */
  readonly kind: UsageWindowKind
  /**
   * 0–100 percent used, one decimal at most (the meters carry fractional
   * percentages, e.g. 11.4). This is the raw `usage / limit` ratio, not a
   * rounded percent.
   */
  readonly percent: number
  /** Seconds until the window resets; 0 when the window has no reset time yet. */
  readonly resetInSec: number
  /** `rate-limited` when the window is exhausted. */
  readonly status: UsageStatus
  /** Amount consumed in the window, in microcents (1e-8 USD), when reported. */
  readonly usage?: number
  /** Window limit in the same unit as {@link usage}, when reported. */
  readonly limit?: number
  /**
   * ISO-8601 timestamp the window resets at, when the API reported one. Kept
   * alongside {@link resetInSec} so a consumer (or the chip) can re-derive the
   * countdown from a cached snapshot instead of trusting a stale second count.
   */
  readonly resetsAt?: string
}

/** Normalized usage shape shared by every fetch path. */
export interface NormalizedUsage {
  /** Epoch ms of the last successful fetch (data freshness). */
  readonly updatedAt: number
  /** Any window may be missing (new account, no Go subscription). */
  readonly rolling?: UsageWindow
  readonly weekly?: UsageWindow
  readonly monthly?: UsageWindow
}

/** Fully resolved plugin configuration (env + config file + defaults). */
export interface OcgoConfig {
  /**
   * Full `Cookie:` header value for the opencode console, e.g.
   * `__Host-console_session=st_…; auth=Fe26.2*…`.
   */
  readonly cookie?: string
  /** OpenCode workspace id (e.g. `wrk_01...`), sent as the `x-org-id` header. */
  readonly workspaceID?: string
  /** Origin of the opencode console (the API path is appended). */
  readonly baseUrl: string
  /** Cache TTL in seconds, clamped to [60, 3600]. */
  readonly cacheTTL: number
  /** HTTP timeout in milliseconds. */
  readonly timeoutMs: number
}

/** One window serialized for the browser (no session identity). */
export type UsageWindowView = UsageWindow

/** The browser-facing snapshot served by the host JSON endpoint. */
export interface OcgoUsageView {
  /** Epoch ms of the last successful fetch (absent before any success). */
  readonly updatedAt?: number
  readonly rolling?: UsageWindowView
  readonly weekly?: UsageWindowView
  readonly monthly?: UsageWindowView
  /** Machine-readable error code, present only on failure. */
  readonly error?: string
  /** Human-readable failure detail (never contains the cookie). */
  readonly message?: string
}

/** One masked secret field for the browser config editor (never the full value). */
export interface MaskedSecret {
  /** Whether a value is currently set (env or config file). */
  readonly set: boolean
  /** The last 4 characters of the value (full value when ≤ 4 chars). */
  readonly tail: string
}

/** The browser-facing config view: which fields are set, masked. */
export interface MaskedConfigView {
  readonly workspaceID: MaskedSecret
  readonly cookie: MaskedSecret
}

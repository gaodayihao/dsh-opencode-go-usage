/**
 * HTTP fetch + response adapters for dsh-ocgo-usage
 *
 * Data path (current): `GET <baseUrl>/console/api/go/status` with the console
 * session cookie and the `x-org-id: <wrk_…>` workspace header. The console was
 * rebuilt as a client-side SPA in the 2026-09 console release: the old
 * `GET /workspace/<wrk>/go` page no longer server-renders the numbers (it is a
 * bare `<div id="app">` shell that hydrates from this JSON API), so scraping
 * the page returns nothing at all.
 *
 * The status payload carries three money-denominated meters:
 *
 * ```jsonc
 * {
 *   "access": {
 *     "endsAt": "2026-09-29T02:24:46.000Z",          // the monthly meter's reset
 *     "meters": {
 *       "fiveHour": { "startsAt": null, "resetsAt": null,
 *                     "limitMicroCents": "1200000000", "usedMicroCents": "0" },
 *       "week":     { "startsAt": "…", "resetsAt": "…",
 *                     "limitMicroCents": "3000000000", "usedMicroCents": "0" },
 *       "month":    { "limitMicroCents": "6000000000",
 *                     "usedMicroCents": "5683871800" }
 *     }
 *   }
 * }
 * ```
 *
 * Values are BigInt decimal strings in microcents (100,000,000 per US dollar);
 * `fiveHour.resetsAt` is null until the rolling window opens, and the monthly
 * meter has no `resetsAt` of its own because the console resets it when the
 * paid period ends (`access.endsAt`) — the console's own Go page renders
 * exactly this mapping. `access` is null for a workspace without a Go
 * subscription, which is a valid "no windows" answer rather than an error.
 *
 * Adapted from pi-ocgo-usage/src/api.ts.
 * @module dsh-ocgo-usage/api
 */
// ============================================================================
// Constants
// ============================================================================
/** Console JSON endpoint carrying the Go subscription meters. */
export const GO_STATUS_PATH = '/console/api/go/status';
/** Header the console uses to select the workspace for an API call. */
export const WORKSPACE_HEADER = 'x-org-id';
/** Console meter name behind each plugin window. */
const METER_KEYS = {
    rolling: 'fiveHour',
    weekly: 'week',
    monthly: 'month',
};
/** Every window the plugin knows about, in display order. */
const KINDS = ['rolling', 'weekly', 'monthly'];
// ============================================================================
// Errors
// ============================================================================
/** Error thrown by the HTTP / parsing layer; carries a short code for the UI. */
export class UsageError extends Error {
    code;
    name = 'UsageError';
    constructor(message, code) {
        super(message);
        this.code = code;
    }
}
// ============================================================================
// HTTP
// ============================================================================
/** Fetch usage through the cookie path. Throws UsageError on any failure. */
export async function fetchViaCookie(cfg) {
    if (!cfg.cookie || !cfg.workspaceID) {
        throw new UsageError('Missing cookie or workspaceID for cookie path', 'noconfig');
    }
    const payload = await fetchGoStatus(cfg);
    return fromStatusJSON(payload, Date.now());
}
/**
 * GET the Go status endpoint and return the decoded JSON.
 *
 * The console answers a machine-readable `{"_tag":"…"}` body for the failures
 * worth naming, so those become dedicated error codes instead of a generic
 * `http4xx`: a rejected session cookie is by far the most common one (it is
 * what a stale paste produces) and deserves a message that says what to do.
 * @param cfg - resolved config (cookie, workspace, origin, timeout).
 * @returns the decoded JSON payload (shape unvalidated; the parser tolerates it).
 */
async function fetchGoStatus(cfg) {
    const url = `${cfg.baseUrl}${GO_STATUS_PATH}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
    // The abort signal stays armed through the body read, so the timeout covers
    // the whole exchange rather than just the response headers.
    try {
        let res;
        try {
            res = await fetch(url, {
                method: 'GET',
                headers: {
                    Cookie: cfg.cookie ?? '',
                    Accept: 'application/json',
                    [WORKSPACE_HEADER]: cfg.workspaceID ?? '',
                },
                signal: controller.signal,
            });
        }
        catch (e) {
            throw transportError(e, cfg.timeoutMs);
        }
        if (!res.ok)
            throw statusError(res.status);
        try {
            return (await res.json());
        }
        catch (e) {
            if (isAbort(e))
                throw transportError(e, cfg.timeoutMs);
            throw new UsageError(`Usage API returned a non-JSON body (HTTP ${res.status})`, 'parse');
        }
    }
    finally {
        clearTimeout(timer);
    }
}
/** True for the error `AbortController.abort()` surfaces. */
function isAbort(error) {
    return error instanceof Error && error.name === 'AbortError';
}
/** Map a transport-level throw (abort or socket failure) onto a named error. */
function transportError(error, timeoutMs) {
    if (isAbort(error))
        return new UsageError(`Request timed out after ${timeoutMs}ms`, 'timeout');
    return new UsageError(String(error instanceof Error ? error.message : error), 'fetch');
}
/** Map an unsuccessful HTTP status onto a named error. */
function statusError(status) {
    if (status === 400) {
        return new UsageError('The console rejected the workspace id (x-org-id); it must be a wrk_… id you are a member of.', 'badworkspace');
    }
    if (status === 401) {
        return new UsageError('The console session cookie was rejected; sign in to opencode.ai again and paste the fresh cookie.', 'unauthorized');
    }
    if (status === 404) {
        return new UsageError('No Go subscription found for this workspace (unknown workspace id, or the plan is not on this account).', 'notfound');
    }
    return new UsageError(`HTTP ${status} for ${GO_STATUS_PATH}`, `http${status}`);
}
// ============================================================================
// Response parsing
// ============================================================================
/**
 * Parse the Go status payload into the three usage windows.
 *
 * Tolerant by design: this reads a third-party API that has already changed
 * shape once, so every field is probed rather than assumed — a missing meter,
 * a null `access`, a numeric instead of string limit, or a bad timestamp all
 * degrade to "that window is absent" instead of throwing.
 * @param payload - the decoded JSON body.
 * @param now - epoch ms used to turn `resetsAt` into `resetInSec`.
 * @returns the windows the payload carried (empty when there is no subscription).
 */
export function fromStatusJSON(payload, now = Date.now()) {
    const access = member(payload, 'access');
    if (!isRecord(access))
        return {};
    const meters = member(access, 'meters');
    if (!isRecord(meters))
        return {};
    // The monthly meter has no resetsAt: the console resets it when the paid
    // period ends, which the payload exposes as access.endsAt.
    const periodEnd = isoString(member(access, 'endsAt'));
    const result = {};
    for (const kind of KINDS) {
        const meter = member(meters, METER_KEYS[kind]);
        if (!isRecord(meter))
            continue;
        const resetsAt = kind === 'monthly' ? periodEnd : isoString(member(meter, 'resetsAt'));
        const window = toWindow(kind, meter, resetsAt, now);
        if (window !== undefined)
            result[kind] = window;
    }
    return result;
}
/**
 * Convert one meter object into a {@link UsageWindow}.
 * @param kind - which window this meter feeds.
 * @param meter - the raw meter record.
 * @param resetsAt - the window's reset instant, when known.
 * @param now - epoch ms for the countdown.
 * @returns the window, or undefined when the meter carries no usable number.
 */
function toWindow(kind, meter, resetsAt, now) {
    const usage = decimal(member(meter, 'usedMicroCents'));
    const limit = decimal(member(meter, 'limitMicroCents'));
    if (usage === undefined && limit === undefined)
        return undefined;
    // The console treats a zero (or absent) limit as 0% rather than dividing by
    // zero; mirror that so an unlimited/legacy meter renders as an empty bar.
    const percent = limit !== undefined && limit > 0
        ? clampPercent(((usage ?? 0) / limit) * 100)
        : 0;
    return {
        kind,
        percent,
        resetInSec: secondsUntil(resetsAt, now),
        status: percent >= 100 ? 'rate-limited' : 'ok',
        ...(usage === undefined ? {} : { usage }),
        ...(limit === undefined ? {} : { limit }),
        ...(resetsAt === undefined ? {} : { resetsAt }),
    };
}
// ============================================================================
// Internal helpers
// ============================================================================
/** True for a non-null, non-array object. */
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/** Read one member off an unknown value, or undefined when it is not a record. */
function member(value, key) {
    return isRecord(value) ? value[key] : undefined;
}
/**
 * Read a non-negative finite number from a payload member.
 *
 * The console serializes its BigInt money fields as decimal strings
 * (`"5683871800"`); plain numbers are accepted too so a future encoder change
 * does not silently zero the readout.
 * @param value - the raw member.
 * @returns the number, or undefined when absent/unparseable/negative.
 */
function decimal(value) {
    if (typeof value === 'number')
        return Number.isFinite(value) && value >= 0 ? value : undefined;
    if (typeof value !== 'string' || value.length === 0)
        return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}
/** Accept a member only when it is a parseable ISO-8601 timestamp string. */
function isoString(value) {
    if (typeof value !== 'string' || value.length === 0)
        return undefined;
    return Number.isFinite(Date.parse(value)) ? value : undefined;
}
/**
 * Seconds from `now` until an ISO timestamp, clamped at 0. A window that has
 * not opened yet (a null `resetsAt`) reports 0, matching the console.
 * @param at - the ISO reset instant, when known.
 * @param now - epoch ms.
 * @returns whole seconds remaining (rounded up, like the console's own countdown).
 */
function secondsUntil(at, now) {
    if (at === undefined)
        return 0;
    const target = Date.parse(at);
    if (!Number.isFinite(target))
        return 0;
    return Math.max(0, Math.ceil((target - now) / 1000));
}
/**
 * Clamp a percent into [0, 100] keeping at most one decimal (the meters report
 * fractional usage, e.g. 11.4).
 * @param n - raw percent.
 * @returns the clamped percent.
 */
function clampPercent(n) {
    if (!Number.isFinite(n))
        return 0;
    const bounded = Math.max(0, Math.min(100, n));
    return Math.round(bounded * 10) / 10;
}
// ============================================================================
// Orchestrator
// ============================================================================
/**
 * Fetch usage with the current config (cookie path only today) and stamp the
 * fetch timestamp so the UI can show data freshness.
 * @param cfg - resolved config.
 * @returns the three windows plus the fetch time.
 */
export async function fetchUsage(cfg) {
    const data = await fetchViaCookie(cfg);
    return { ...data, updatedAt: Date.now() };
}

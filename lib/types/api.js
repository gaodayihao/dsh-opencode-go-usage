// ============================================================================
// Constants
// ============================================================================
/** Console JSON endpoint carrying the Go subscription meters. */
export const GO_STATUS_PATH = '/console/api/go/status';
/**
 * Console JSON endpoint carrying the account's credit balance.
 *
 * This is the request behind the console Billing page's "Available credits"
 * card. It is a *separate* resource from the Go meters — `go/status` never
 * reports the pay-as-you-go balance — and it is secondary to this plugin's
 * read, so a failure here drops the credit row instead of failing the chip.
 */
export const BILLING_STATUS_PATH = '/console/api/billing/status';
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
    // One deadline covers the whole read. The two requests go out together so the
    // credit balance costs no extra round-trip of latency; the billing probe is
    // secondary, so its failures (and its stragglers) never fail the read.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
    try {
        const [status, billing] = await Promise.all([
            getJSON(cfg, GO_STATUS_PATH, controller.signal),
            getJSON(cfg, BILLING_STATUS_PATH, controller.signal).catch(() => undefined),
        ]);
        const credit = fromBillingJSON(billing);
        return {
            ...fromStatusJSON(status, Date.now()),
            ...(credit === undefined ? {} : { credit }),
        };
    }
    finally {
        clearTimeout(timer);
        // On the success path both requests have already settled, so this is a
        // no-op; on the failure path it cancels the request still in flight rather
        // than leaving it to run out its own timeout unobserved.
        controller.abort();
    }
}
/**
 * GET one console JSON endpoint and return the decoded body.
 *
 * The console answers a machine-readable `{"_tag":"…"}` body for the failures
 * worth naming, so those become dedicated error codes instead of a generic
 * `http4xx`: a rejected session cookie is by far the most common one (it is
 * what a stale paste produces) and deserves a message that says what to do.
 * @param cfg - resolved config (cookie, workspace, origin).
 * @param path - console API path to request (origin-relative).
 * @param signal - the read-wide abort signal (the deadline timer arms it).
 * @returns the decoded JSON payload (shape unvalidated; the parser tolerates it).
 */
async function getJSON(cfg, path, signal) {
    const url = `${cfg.baseUrl}${path}`;
    // The abort signal stays armed through the body read, so the timeout covers
    // the whole exchange rather than just the response headers.
    let res;
    try {
        res = await fetch(url, {
            method: 'GET',
            headers: {
                Cookie: cfg.cookie ?? '',
                Accept: 'application/json',
                [WORKSPACE_HEADER]: cfg.workspaceID ?? '',
            },
            signal,
        });
    }
    catch (e) {
        throw transportError(e, cfg.timeoutMs);
    }
    if (!res.ok)
        throw statusError(res.status, path);
    try {
        return (await res.json());
    }
    catch (e) {
        if (isAbort(e))
            throw transportError(e, cfg.timeoutMs);
        throw new UsageError(`Usage API returned a non-JSON body (HTTP ${res.status})`, 'parse');
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
function statusError(status, path) {
    if (status === 400) {
        return new UsageError('The console rejected the workspace id (x-org-id); it must be a wrk_… id you are a member of.', 'badworkspace');
    }
    if (status === 401) {
        return new UsageError('The console session cookie was rejected; sign in to opencode.ai again and paste the fresh cookie.', 'unauthorized');
    }
    if (status === 404) {
        return new UsageError('No Go subscription found for this workspace (unknown workspace id, or the plan is not on this account).', 'notfound');
    }
    return new UsageError(`HTTP ${status} for ${path}`, `http${status}`);
}
// ============================================================================
// Response parsing
// ============================================================================
/**
 * Parse the console billing payload into the available-credit summary.
 *
 * Reads `availableMicroCents` — the very field the console's Billing page
 * renders in its "Available credits" card — and nothing else. The sibling
 * `balanceMicroCents` is deliberately NOT used as a fallback: for an account
 * with a credit line the two differ (available = balance + limit), so silently
 * substituting one for the other would report a number the console never
 * shows. A payload without the field yields undefined, which the UI renders as
 * "no credit row" rather than as $0.00.
 * @param payload - the decoded JSON body.
 * @returns the credit summary, or undefined when the payload carried no balance.
 */
export function fromBillingJSON(payload) {
    if (!isRecord(payload))
        return undefined;
    const available = decimal(member(payload, 'availableMicroCents'));
    if (available === undefined)
        return undefined;
    return { available };
}
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

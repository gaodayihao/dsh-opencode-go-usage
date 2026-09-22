/**
 * Configuration loader for dsh-ocgo-usage
 *
 * Priority: env vars > config file ($DSH_HOME/ocgo-usage.json) > built-in defaults
 *
 * The cookie is NEVER logged. If the config file is missing or unparseable,
 * we silently fall back to env vars + defaults — the browser readout shows a
 * clean `noconfig` error if neither source provides a usable value.
 *
 * Env var names match the pi-ocgo-usage extension so one shell profile works
 * for both agents.
 *
 * The browser config editor (`/api/ocgo-usage/config`) reads a MASKED view
 * (never the full cookie) and writes back through {@link writeConfigFile}.
 * @module dsh-ocgo-usage/config
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
export const ENV_COOKIE = 'OPENCODE_GO_COOKIE';
export const ENV_WORKSPACE_ID = 'OPENCODE_GO_WORKSPACE_ID';
export const ENV_BASE_URL = 'OPENCODE_GO_BASE_URL';
export const ENV_CACHE_TTL = 'OPENCODE_GO_CACHE_TTL';
export const ENV_TIMEOUT_MS = 'OPENCODE_GO_TIMEOUT_MS';
export const DEFAULT_BASE_URL = 'https://opencode.ai';
export const DEFAULT_CACHE_TTL = 300;
export const DEFAULT_TIMEOUT_MS = 10_000;
export const MIN_CACHE_TTL = 60;
export const MAX_CACHE_TTL = 3600;
/** Resolve the DSH home directory ($DSH_HOME or ~/.dsh). */
export function dshHome() {
    const explicit = process.env.DSH_HOME;
    if (typeof explicit === 'string' && explicit.length > 0)
        return explicit;
    return join(homedir(), '.dsh');
}
/** Resolved location of the plugin config file. */
export function configFilePath() {
    return join(dshHome(), 'ocgo-usage.json');
}
/**
 * Load and merge config from file + env vars.
 * Returns a fully resolved OcgoConfig; never throws.
 */
export function loadConfig() {
    const fileConfig = readFileConfig();
    // Cookie: prefer env, fall back to file; normalize so users can paste
    // either the full header or just the auth value.
    const cookie = normalizeCookie(pickString(process.env[ENV_COOKIE], asString(fileConfig?.cookie)));
    // Workspace ID: prefer env, fall back to file.
    const workspaceID = pickString(process.env[ENV_WORKSPACE_ID], asString(fileConfig?.workspaceID));
    // baseUrl: prefer env, fall back to file, fall back to default.
    const baseUrl = pickString(process.env[ENV_BASE_URL], asString(fileConfig?.baseUrl)) || DEFAULT_BASE_URL;
    // cacheTTL: clamp into [60, 3600].
    const rawTTL = pickNumber(process.env[ENV_CACHE_TTL], asNumber(fileConfig?.cacheTTL), DEFAULT_CACHE_TTL);
    const cacheTTL = clamp(rawTTL, MIN_CACHE_TTL, MAX_CACHE_TTL);
    // timeoutMs: > 0.
    const timeoutMs = Math.max(0, pickNumber(process.env[ENV_TIMEOUT_MS], asNumber(fileConfig?.timeoutMs), DEFAULT_TIMEOUT_MS));
    return { cookie, workspaceID, baseUrl, cacheTTL, timeoutMs };
}
/** Mask the last 4 characters of a secret for the browser (full value when ≤ 4 chars). */
export function maskSecret(value) {
    if (value === undefined || value.length === 0)
        return { set: false, tail: '' };
    return { set: true, tail: value.length <= 4 ? value : value.slice(-4) };
}
/** The browser-facing masked config view (never reveals the full cookie). */
export function maskedConfigView() {
    const cfg = loadConfig();
    return {
        workspaceID: maskSecret(cfg.workspaceID),
        cookie: maskSecret(cfg.cookie),
    };
}
/**
 * Write cookie / workspaceID into the config file (preserving any other
 * fields), chmod 600, and return the updated masked view. Values are
 * normalized like env input (cookie gets `auth=` prefixed when pasted bare).
 * Empty/absent fields are left untouched; pass `null` to clear a field.
 */
export function writeConfigFile(partial) {
    const file = readFileConfig() ?? {};
    const next = { ...file };
    if (partial.workspaceID !== undefined) {
        const v = typeof partial.workspaceID === 'string' ? partial.workspaceID.trim() : '';
        if (v.length > 0)
            next.workspaceID = v;
        else
            delete next.workspaceID;
    }
    if (partial.cookie !== undefined) {
        const v = typeof partial.cookie === 'string' ? normalizeCookie(partial.cookie) : undefined;
        if (v !== undefined && v.length > 0)
            next.cookie = v;
        else
            delete next.cookie;
    }
    const path = configFilePath();
    try {
        writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    }
    catch {
        // Fall back to the env/current effective values rather than throwing to
        // the browser with a partial write.
        return maskedConfigView();
    }
    return {
        workspaceID: maskSecret(typeof next.workspaceID === 'string' ? next.workspaceID : undefined),
        cookie: maskSecret(typeof next.cookie === 'string' ? next.cookie : undefined),
    };
}
function readFileConfig() {
    const path = configFilePath();
    if (!existsSync(path))
        return null;
    try {
        const raw = readFileSync(path, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
            return parsed;
        }
        return null;
    }
    catch {
        return null;
    }
}
// --- helpers ---
function pickString(envVal, fileVal) {
    if (envVal && envVal.length > 0)
        return envVal;
    if (fileVal && fileVal.length > 0)
        return fileVal;
    return undefined;
}
/**
 * Cookie names the console API understands, in the order we emit them.
 * `__Host-console_session` is the live session; `console_session` is the
 * non-Host variant the console also reads; `auth` is the legacy iron-session
 * cookie, kept because the user may paste it alongside the session handle.
 */
export const CONSOLE_COOKIE_NAMES = ['__Host-console_session', 'console_session', 'auth'];
/**
 * Normalize a user-provided cookie string into a valid `Cookie:` header value
 * for the opencode console HTTP request.
 *
 * The console API authenticates on its session cookie. Since the 2026-09
 * console rebuild the session lives in `__Host-console_session` (a short
 * `st_…` handle); the older `auth=Fe26.2*…` iron-session cookie alone is
 * **rejected with HTTP 401** by the API, so a cookie file that kept only
 * `auth=` (what this function used to produce) now fails outright.
 *
 * Accepts, order-independently:
 *  1. The browser's full cookie header, e.g.
 *     `__Host-console_session=st_…; auth=Fe26.2*…; __stripe_mid=…` (passthrough
 *     of the recognized names, everything else dropped).
 *  2. Just the session handle: `st_…` → `__Host-console_session=st_…`.
 *  3. Just the legacy auth value: `Fe26.2*…` → `auth=Fe26.2*…` (kept so an
 *     older paste still produces a clear HTTP 401 rather than `noconfig`, and
 *     so the two cookies can be pasted separately).
 *  4. Comma-separated `Set-Cookie`-style input.
 *
 * Historical fix still honored: the `auth=` segment is located anywhere in the
 * string rather than assumed to be first. The old code turned
 * `oc_locale=zh; …; auth=Fe26.2*…` into `auth=oc_locale=zh; …` — a fabricated
 * cookie the site rejects. Nothing is ever fabricated here: when no recognized
 * cookie name (and no bare opaque token) is present, `undefined` is returned so
 * the caller REFUSES to persist a broken cookie.
 *
 * Dropped on purpose: `oc_locale` (the API is locale-independent JSON now, and
 * the locale was only ever needed to steer the server-rendered page) and every
 * unrelated cookie (`__stripe_*`, promo dismissals, …).
 */
export function normalizeCookie(input) {
    if (!input)
        return undefined;
    const trimmed = input.trim();
    if (!trimmed)
        return undefined;
    const segments = trimmed.split(/[;,]/).map((s) => s.trim()).filter(Boolean);
    // Collect the recognized cookies by their canonical (case-sensitive) name.
    const found = new Map();
    for (const segment of segments) {
        const eq = segment.indexOf('=');
        if (eq < 0)
            continue;
        const name = segment.slice(0, eq).trim().toLowerCase();
        const known = CONSOLE_COOKIE_NAMES.find((candidate) => candidate.toLowerCase() === name);
        if (known === undefined)
            continue;
        const value = segment.slice(eq + 1).trim().replace(/^"|"$/g, '');
        if (value.length > 0 && !found.has(known))
            found.set(known, value);
    }
    // A bare opaque token (no `=`): route it by shape. The console session handle
    // is `st_…`; anything else that looks like an iron-session value is `auth`.
    if (found.size === 0) {
        const bare = segments.find((s) => !s.includes('=') && s.length >= 8)?.replace(/^"|"$/g, '');
        if (bare !== undefined && bare.length > 0) {
            found.set(bare.startsWith('st_') ? '__Host-console_session' : 'auth', bare);
        }
    }
    if (found.size === 0)
        return undefined;
    // Emit in a stable order so the masked tail (and the tests) are predictable.
    return CONSOLE_COOKIE_NAMES
        .flatMap((name) => {
        const value = found.get(name);
        return value === undefined ? [] : [`${name}=${value}`];
    })
        .join('; ');
}
function pickNumber(envVal, fileVal, fallback) {
    const fromEnv = envVal ? Number.parseInt(envVal, 10) : NaN;
    if (Number.isFinite(fromEnv))
        return fromEnv;
    if (fileVal !== undefined && Number.isFinite(fileVal))
        return fileVal;
    return fallback;
}
function asString(v) {
    return typeof v === 'string' && v.length > 0 ? v : undefined;
}
function asNumber(v) {
    if (typeof v === 'number' && Number.isFinite(v))
        return v;
    if (typeof v === 'string') {
        const n = Number.parseInt(v, 10);
        if (Number.isFinite(n))
            return n;
    }
    return undefined;
}
function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
}

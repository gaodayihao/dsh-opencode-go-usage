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
import type { MaskedConfigView, MaskedSecret, OcgoConfig } from './types.ts';
export declare const ENV_COOKIE = "OPENCODE_GO_COOKIE";
export declare const ENV_WORKSPACE_ID = "OPENCODE_GO_WORKSPACE_ID";
export declare const ENV_BASE_URL = "OPENCODE_GO_BASE_URL";
export declare const ENV_CACHE_TTL = "OPENCODE_GO_CACHE_TTL";
export declare const ENV_TIMEOUT_MS = "OPENCODE_GO_TIMEOUT_MS";
export declare const DEFAULT_BASE_URL = "https://opencode.ai";
export declare const DEFAULT_CACHE_TTL = 300;
export declare const DEFAULT_TIMEOUT_MS = 10000;
export declare const MIN_CACHE_TTL = 60;
export declare const MAX_CACHE_TTL = 3600;
/** Resolve the DSH home directory ($DSH_HOME or ~/.dsh). */
export declare function dshHome(): string;
/** Resolved location of the plugin config file. */
export declare function configFilePath(): string;
/**
 * Load and merge config from file + env vars.
 * Returns a fully resolved OcgoConfig; never throws.
 */
export declare function loadConfig(): OcgoConfig;
/** Mask the last 4 characters of a secret for the browser (full value when ≤ 4 chars). */
export declare function maskSecret(value: string | undefined): MaskedSecret;
/** The browser-facing masked config view (never reveals the full cookie). */
export declare function maskedConfigView(): MaskedConfigView;
/**
 * Write cookie / workspaceID into the config file (preserving any other
 * fields), chmod 600, and return the updated masked view. Values are
 * normalized like env input (cookie gets `auth=` prefixed when pasted bare).
 * Empty/absent fields are left untouched; pass `null` to clear a field.
 */
export declare function writeConfigFile(partial: {
    cookie?: string | null;
    workspaceID?: string | null;
}): MaskedConfigView;
/**
 * Cookie names the console API understands, in the order we emit them.
 * `__Host-console_session` is the live session; `console_session` is the
 * non-Host variant the console also reads; `auth` is the legacy iron-session
 * cookie, kept because the user may paste it alongside the session handle.
 */
export declare const CONSOLE_COOKIE_NAMES: readonly ["__Host-console_session", "console_session", "auth"];
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
export declare function normalizeCookie(input: string | undefined): string | undefined;
//# sourceMappingURL=config.d.ts.map
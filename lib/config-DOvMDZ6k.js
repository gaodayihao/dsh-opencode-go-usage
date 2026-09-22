import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
//#region src/config.ts
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
const ENV_COOKIE = "OPENCODE_GO_COOKIE";
const ENV_WORKSPACE_ID = "OPENCODE_GO_WORKSPACE_ID";
const ENV_CACHE_TTL = "OPENCODE_GO_CACHE_TTL";
const ENV_TIMEOUT_MS = "OPENCODE_GO_TIMEOUT_MS";
const DEFAULT_BASE_URL = "https://opencode.ai";
const DEFAULT_TIMEOUT_MS = 1e4;
const MAX_CACHE_TTL = 3600;
/** Resolve the DSH home directory ($DSH_HOME or ~/.dsh). */
function dshHome() {
	const explicit = process.env.DSH_HOME;
	if (typeof explicit === "string" && explicit.length > 0) return explicit;
	return join(homedir(), ".dsh");
}
/** Resolved location of the plugin config file. */
function configFilePath() {
	return join(dshHome(), "ocgo-usage.json");
}
/**
* Load and merge config from file + env vars.
* Returns a fully resolved OcgoConfig; never throws.
*/
function loadConfig() {
	const fileConfig = readFileConfig();
	return {
		cookie: normalizeCookie(pickString(process.env[ENV_COOKIE], asString(fileConfig?.cookie))),
		workspaceID: pickString(process.env[ENV_WORKSPACE_ID], asString(fileConfig?.workspaceID)),
		baseUrl: pickString(process.env["OPENCODE_GO_BASE_URL"], asString(fileConfig?.baseUrl)) || "https://opencode.ai",
		cacheTTL: clamp(pickNumber(process.env[ENV_CACHE_TTL], asNumber(fileConfig?.cacheTTL), 300), 60, MAX_CACHE_TTL),
		timeoutMs: Math.max(0, pickNumber(process.env[ENV_TIMEOUT_MS], asNumber(fileConfig?.timeoutMs), DEFAULT_TIMEOUT_MS))
	};
}
/** Mask the last 4 characters of a secret for the browser (full value when ≤ 4 chars). */
function maskSecret(value) {
	if (value === void 0 || value.length === 0) return {
		set: false,
		tail: ""
	};
	return {
		set: true,
		tail: value.length <= 4 ? value : value.slice(-4)
	};
}
/** The browser-facing masked config view (never reveals the full cookie). */
function maskedConfigView() {
	const cfg = loadConfig();
	return {
		workspaceID: maskSecret(cfg.workspaceID),
		cookie: maskSecret(cfg.cookie)
	};
}
/**
* Write cookie / workspaceID into the config file (preserving any other
* fields), chmod 600, and return the updated masked view. Values are
* normalized like env input (cookie gets `auth=` prefixed when pasted bare).
* Empty/absent fields are left untouched; pass `null` to clear a field.
*/
function writeConfigFile(partial) {
	const next = { ...readFileConfig() ?? {} };
	if (partial.workspaceID !== void 0) {
		const v = typeof partial.workspaceID === "string" ? partial.workspaceID.trim() : "";
		if (v.length > 0) next.workspaceID = v;
		else delete next.workspaceID;
	}
	if (partial.cookie !== void 0) {
		const v = typeof partial.cookie === "string" ? normalizeCookie(partial.cookie) : void 0;
		if (v !== void 0 && v.length > 0) next.cookie = v;
		else delete next.cookie;
	}
	const path = configFilePath();
	try {
		writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, { mode: 384 });
	} catch {
		return maskedConfigView();
	}
	return {
		workspaceID: maskSecret(typeof next.workspaceID === "string" ? next.workspaceID : void 0),
		cookie: maskSecret(typeof next.cookie === "string" ? next.cookie : void 0)
	};
}
function readFileConfig() {
	const path = configFilePath();
	if (!existsSync(path)) return null;
	try {
		const raw = readFileSync(path, "utf8");
		const parsed = JSON.parse(raw);
		if (parsed && typeof parsed === "object") return parsed;
		return null;
	} catch {
		return null;
	}
}
function pickString(envVal, fileVal) {
	if (envVal && envVal.length > 0) return envVal;
	if (fileVal && fileVal.length > 0) return fileVal;
}
/**
* Cookie names the console API understands, in the order we emit them.
* `__Host-console_session` is the live session; `console_session` is the
* non-Host variant the console also reads; `auth` is the legacy iron-session
* cookie, kept because the user may paste it alongside the session handle.
*/
const CONSOLE_COOKIE_NAMES = [
	"__Host-console_session",
	"console_session",
	"auth"
];
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
function normalizeCookie(input) {
	if (!input) return void 0;
	const trimmed = input.trim();
	if (!trimmed) return void 0;
	const segments = trimmed.split(/[;,]/).map((s) => s.trim()).filter(Boolean);
	const found = /* @__PURE__ */ new Map();
	for (const segment of segments) {
		const eq = segment.indexOf("=");
		if (eq < 0) continue;
		const name = segment.slice(0, eq).trim().toLowerCase();
		const known = CONSOLE_COOKIE_NAMES.find((candidate) => candidate.toLowerCase() === name);
		if (known === void 0) continue;
		const value = segment.slice(eq + 1).trim().replace(/^"|"$/g, "");
		if (value.length > 0 && !found.has(known)) found.set(known, value);
	}
	if (found.size === 0) {
		const bare = segments.find((s) => !s.includes("=") && s.length >= 8)?.replace(/^"|"$/g, "");
		if (bare !== void 0 && bare.length > 0) found.set(bare.startsWith("st_") ? "__Host-console_session" : "auth", bare);
	}
	if (found.size === 0) return void 0;
	return CONSOLE_COOKIE_NAMES.flatMap((name) => {
		const value = found.get(name);
		return value === void 0 ? [] : [`${name}=${value}`];
	}).join("; ");
}
function pickNumber(envVal, fileVal, fallback) {
	const fromEnv = envVal ? Number.parseInt(envVal, 10) : NaN;
	if (Number.isFinite(fromEnv)) return fromEnv;
	if (fileVal !== void 0 && Number.isFinite(fileVal)) return fileVal;
	return fallback;
}
function asString(v) {
	return typeof v === "string" && v.length > 0 ? v : void 0;
}
function asNumber(v) {
	if (typeof v === "number" && Number.isFinite(v)) return v;
	if (typeof v === "string") {
		const n = Number.parseInt(v, 10);
		if (Number.isFinite(n)) return n;
	}
}
function clamp(n, min, max) {
	return Math.max(min, Math.min(max, n));
}
//#endregion
export { loadConfig as a, writeConfigFile as c, configFilePath as i, DEFAULT_BASE_URL as n, maskedConfigView as o, DEFAULT_TIMEOUT_MS as r, normalizeCookie as s, CONSOLE_COOKIE_NAMES as t };

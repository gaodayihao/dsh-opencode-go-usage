import { a as maskedConfigView, i as loadConfig, o as normalizeCookie, r as configFilePath, s as writeConfigFile } from "./config-B4sfdLCs.js";
import { Service } from "@deepseek-ai/cordis";
//#region src/routes.ts
/** Browser-facing base path of the usage API. */
const OCGO_API_PREFIX = "/api/ocgo-usage";
/** Write one JSON response. */
function json(res, status, body) {
	res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
	res.end(JSON.stringify(body));
}
/** Require the method or answer 405. */
function requireMethod(req, res, method) {
	if (req.method === method) return true;
	json(res, 405, {
		ok: false,
		error: "method-not-allowed"
	});
	return false;
}
/** Read a bounded JSON request body. */
function readJsonBody(req) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		let size = 0;
		req.on("data", (chunk) => {
			size += chunk.length;
			if (size > 65536) {
				reject(/* @__PURE__ */ new Error("body-too-large"));
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => {
			const raw = Buffer.concat(chunks).toString("utf8");
			if (raw.length === 0) {
				resolve({});
				return;
			}
			try {
				resolve(JSON.parse(raw));
			} catch {
				reject(/* @__PURE__ */ new Error("bad-json"));
			}
		});
		req.on("error", reject);
	});
}
/** Wrap one async usage read as a GET JSON route. */
function getRoute(path, run) {
	return {
		kind: "exact",
		path,
		handler: (req, res) => {
			if (!requireMethod(req, res, "GET")) return;
			Promise.resolve(run()).then((value) => json(res, 200, value), (error) => {
				json(res, 500, {
					ok: false,
					error: error instanceof Error ? error.message : String(error)
				});
			});
		}
	};
}
/**
* The config editor routes: GET the masked view, POST new values to write.
* A successful write invalidates the usage cache so the next poll re-queries
* with the fresh cookie/workspace immediately (bypassing any cooldown).
*/
function makeConfigRoutes(service) {
	const read = () => maskedConfigView();
	const write = async (req) => {
		const body = await readJsonBody(req);
		const partial = {};
		if ("cookie" in body) partial.cookie = typeof body.cookie === "string" ? body.cookie : null;
		if ("workspaceID" in body) partial.workspaceID = typeof body.workspaceID === "string" ? body.workspaceID : null;
		const view = writeConfigFile(partial);
		service.invalidateCache();
		return view;
	};
	return [{
		kind: "exact",
		path: `${OCGO_API_PREFIX}/config`,
		handler: (req, res) => {
			if (req.method === "GET") {
				Promise.resolve(read()).then((value) => json(res, 200, value), (error) => {
					json(res, 500, {
						ok: false,
						error: error instanceof Error ? error.message : String(error)
					});
				});
				return;
			}
			if (req.method === "POST") {
				Promise.resolve(write(req)).then((value) => json(res, 200, value), (error) => {
					json(res, 400, {
						ok: false,
						error: error instanceof Error ? error.message : String(error)
					});
				});
				return;
			}
			json(res, 405, {
				ok: false,
				error: "method-not-allowed"
			});
		}
	}];
}
/** Build the full usage API route family for one service. */
function makeOcgoRoutes(service) {
	return [
		getRoute(OCGO_API_PREFIX, () => service.view()),
		getRoute(`${OCGO_API_PREFIX}/refresh`, () => service.refresh()),
		...makeConfigRoutes(service)
	];
}
//#endregion
//#region src/api.ts
/** Error thrown by the HTTP / parsing layer; carries a short code for the UI. */
var UsageError = class extends Error {
	code;
	name = "UsageError";
	constructor(message, code) {
		super(message);
		this.code = code;
	}
};
/** Text fetch with structured errors (cookie SSR path). */
async function safeFetchText(url, headers, timeoutMs) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const res = await fetch(url, {
			method: "GET",
			headers,
			signal: controller.signal
		});
		if (!res.ok) throw new UsageError(`HTTP ${res.status} for ${sanitizeUrl(url)}`, `http${res.status}`);
		return await res.text();
	} catch (e) {
		if (e instanceof UsageError) throw e;
		if (e instanceof Error && e.name === "AbortError") throw new UsageError(`Request timed out after ${timeoutMs}ms`, "timeout");
		throw new UsageError(String(e instanceof Error ? e.message : e), "fetch");
	} finally {
		clearTimeout(timer);
	}
}
/** Strip query params from a URL for safe error messages. */
function sanitizeUrl(url) {
	try {
		const u = new URL(url);
		return `${u.protocol}//${u.host}${u.pathname}`;
	} catch {
		return url;
	}
}
/** Fetch usage through the cookie path. Throws UsageError on any failure. */
async function fetchViaCookie(cfg) {
	if (!cfg.cookie || !cfg.workspaceID) throw new UsageError("Missing cookie or workspaceID for cookie path", "noconfig");
	const parsed = fromSSRHTML(await safeFetchText(`${cfg.baseUrl}/workspace/${encodeURIComponent(cfg.workspaceID)}/go`, {
		Cookie: cfg.cookie,
		Accept: "text/html"
	}, cfg.timeoutMs));
	if (parsed.rolling === void 0 && parsed.weekly === void 0 && parsed.monthly === void 0) throw new UsageError("Usage page parsed empty (cookie expired or invalid?)", "http302");
	return parsed;
}
/** Map each usage window to the key its object carries in the page payload. */
const EMBEDDED_KEYS = {
	rolling: "rollingUsage",
	weekly: "weeklyUsage",
	monthly: "monthlyUsage"
};
/**
* Read the balanced `{...}` object literal that follows `key:` starting at
* `from`. Honors double-quoted string literals (and their escapes) so a brace
* inside a string cannot unbalance the scan.
* @param html - the page body.
* @param from - index of the `{` to start at.
* @returns the literal text including both braces, or undefined when unbalanced.
*/
function readObjectLiteral(html, from) {
	if (html[from] !== "{") return void 0;
	let depth = 0;
	let quote = false;
	let escaped = false;
	for (let i = from; i < html.length; i++) {
		const char = html[i];
		if (quote) {
			if (escaped) escaped = false;
			else if (char === "\\") escaped = true;
			else if (char === "\"") quote = false;
			continue;
		}
		if (char === "\"") quote = true;
		else if (char === "{") depth += 1;
		else if (char === "}") {
			depth -= 1;
			if (depth === 0) return html.slice(from, i + 1);
		}
	}
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
function memberOf(literal, key) {
	return new RegExp(`["']?\\b${key}\\b["']?\\s*:\\s*("(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*'|!?[A-Za-z_$][\\w$]*|-?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)`).exec(literal)?.[1];
}
/** Read a numeric member (unquoted numeric literal) from the captured object. */
function numericMember(literal, key) {
	const raw = memberOf(literal, key);
	if (raw === void 0) return void 0;
	const value = Number(raw);
	return Number.isFinite(value) ? value : void 0;
}
/** Read a string member (quoted literal) from the captured object. */
function stringMember(literal, key) {
	const raw = memberOf(literal, key);
	if (raw === void 0) return void 0;
	if (raw.startsWith("\"")) try {
		return JSON.parse(raw);
	} catch {
		return raw.slice(1, -1);
	}
	if (raw.startsWith("'")) return raw.slice(1, -1);
	return /^[A-Za-z_$][\w$]*$/.test(raw) ? raw : void 0;
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
function embeddedWindow(html, kind) {
	const key = EMBEDDED_KEYS[kind];
	let found;
	let at = html.indexOf(`${key}:`);
	while (at >= 0) {
		const brace = html.indexOf("{", at + key.length + 1);
		if (brace >= 0) {
			const literal = readObjectLiteral(html, brace);
			if (literal !== void 0) {
				const percent = numericMember(literal, "usagePercent");
				if (percent !== void 0) {
					const usage = numericMember(literal, "usage");
					const limit = numericMember(literal, "limit");
					const resetInSec = numericMember(literal, "resetInSec");
					const status = stringMember(literal, "status");
					found = {
						kind,
						percent: clampPercent(percent),
						resetInSec: Math.max(0, Math.floor(resetInSec ?? 0)),
						status: status === "rate-limited" || status === void 0 && percent >= 100 ? "rate-limited" : "ok",
						...usage === void 0 ? {} : { usage },
						...limit === void 0 ? {} : { limit }
					};
				}
			}
		}
		at = html.indexOf(`${key}:`, at + key.length + 1);
	}
	return found;
}
/**
* Parse the embedded server payload for all three windows.
* @param html - the page body.
* @returns the windows the payload carried.
*/
function fromEmbeddedData(html) {
	const result = {};
	for (const kind of [
		"rolling",
		"weekly",
		"monthly"
	]) {
		const window = embeddedWindow(html, kind);
		if (window !== void 0) result[kind] = window;
	}
	return result;
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
function fromUsageItems(html) {
	const itemStartRe = /<div[^>]*data-slot="usage-item"/g;
	const starts = [];
	let startMatch = itemStartRe.exec(html);
	while (startMatch !== null) {
		starts.push(startMatch.index);
		startMatch = itemStartRe.exec(html);
	}
	const result = {};
	for (let i = 0; i < starts.length; i++) {
		const block = html.slice(starts[i], starts[i + 1] ?? html.length);
		const labelMatch = block.match(/data-slot="usage-label"[^>]*>([^<]+)</);
		const valueMatch = block.match(/data-slot="usage-value"[\s\S]*?(\d+(?:\.\d+)?)\s*(?:<!--[^>]*-->\s*)?%/);
		if (!labelMatch || !valueMatch) continue;
		const kind = labelToKind(labelMatch[1]?.trim() ?? "");
		if (kind === void 0) continue;
		const resetMatch = block.match(/(?:Resets in|重置于)([\s\S]*?)(?:<\/span>|<\/div>|$)/);
		const percent = Number.parseFloat(valueMatch[1] ?? "0");
		const resetsIn = resetMatch ? stripHtmlComments(resetMatch[1] ?? "") : "";
		result[kind] = {
			kind,
			percent: clampPercent(percent),
			resetInSec: parseDurationToSec(resetsIn),
			status: percent >= 100 ? "rate-limited" : "ok"
		};
	}
	return result;
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
function fromSSRHTML(html) {
	const embedded = fromEmbeddedData(html);
	return {
		...fromUsageItems(html),
		...embedded
	};
}
function labelToKind(label) {
	const lower = label.toLowerCase();
	if (lower.startsWith("rolling")) return "rolling";
	if (lower.startsWith("weekly")) return "weekly";
	if (lower.startsWith("monthly")) return "monthly";
	if (lower.startsWith("滚动") || lower.includes("小时")) return "rolling";
	if (lower.startsWith("每周") || lower.includes("周")) return "weekly";
	if (lower.startsWith("每月") || lower.includes("月")) return "monthly";
}
/** Strip SolidStart HTML comments `<!-- ... -->` from a string. */
function stripHtmlComments(s) {
	return s.replace(/<!--[\s\S]*?-->/g, "").trim();
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
function parseDurationToSec(phrase) {
	if (!phrase) return 0;
	const p = phrase.replace(/<!--[\s\S]*?-->/g, " ").trim().replace(/\s+/g, " ").toLowerCase();
	if (!p) return 0;
	const re = /(\d+)\s*(?:个\s*)?(second|minute|hour|day|week|month|year|秒|分钟|小时|天|周|月|年)s?/g;
	let total = 0;
	let matched = false;
	let m = re.exec(p);
	while (m !== null) {
		const n = Number.parseInt(m[1] ?? "0", 10);
		const unit = m[2] ?? "";
		matched = true;
		switch (unit) {
			case "second":
			case "秒":
				total += n;
				break;
			case "minute":
			case "分钟":
				total += n * 60;
				break;
			case "hour":
			case "小时":
				total += n * 3600;
				break;
			case "day":
			case "天":
				total += n * 86400;
				break;
			case "week":
			case "周":
				total += n * 604800;
				break;
			case "month":
			case "月":
				total += n * 2592e3;
				break;
			case "year":
			case "年": total += n * 31536e3;
		}
		m = re.exec(p);
	}
	return matched ? total : 0;
}
/**
* Fetch usage with the current config (cookie path only today) and stamp
* the fetch timestamp so the UI can show data freshness.
*/
async function fetchUsage(cfg) {
	return {
		...await fetchViaCookie(cfg),
		updatedAt: Date.now()
	};
}
/**
* Clamp a percent into [0, 100] keeping at most one decimal (the console
* reports fractional usage, e.g. 11.4).
* @param n - raw percent from the page.
* @returns the clamped percent.
*/
function clampPercent(n) {
	if (n === void 0 || !Number.isFinite(n)) return 0;
	return Math.round(Math.max(0, Math.min(100, n)) * 10) / 10;
}
//#endregion
//#region src/service.ts
/**
* dsh-ocgo-usage host service — the cached OpenCode Go usage read.
* Resolves the config (env + $DSH_HOME/ocgo-usage.json) on every refresh so
* a changed cookie reaches the next query without a plugin restart, fetches
* the SSR usage page, and caches the result so the browser readout can poll
* without spamming opencode.ai.
* @module dsh-ocgo-usage/service
*/
/** After a failed fetch, skip further provider queries for this long. */
const FAILURE_COOLDOWN_MS = 6e4;
/** Map a UsageError (or any error) to a browser-safe view. */
function errorView(error) {
	if (error instanceof UsageError) return {
		error: error.code,
		message: error.message
	};
	return {
		error: "fetch",
		message: error instanceof Error ? error.message : String(error)
	};
}
/**
* Cached OpenCode Go usage read. `view()` answers from a fresh cache,
* otherwise queries the provider (deduped when concurrent). A failed query
* enters a short cooldown so a broken config is not hammered by the poller.
*/
var OcgoUsageService = class extends Service {
	enabled;
	cached;
	cachedAt = 0;
	failureUntilMs = 0;
	lastError;
	inflight;
	constructor(ctx, config = {}) {
		super(ctx, "ocgoUsage");
		this.enabled = config.enabled ?? true;
	}
	/** Whether the service answers queries while enabled. */
	isEnabled() {
		return this.enabled;
	}
	/** Cache TTL from the live config (seconds → ms). */
	ttlMs() {
		return loadConfig().cacheTTL * 1e3;
	}
	/** RPC: most recent usage view. Returns the cached view when it is still
	* fresh, otherwise re-queries the provider (deduped when concurrent). */
	async view() {
		if (!this.enabled) return {
			error: "disabled",
			message: "The ocgo-usage plugin is disabled."
		};
		const now = Date.now();
		if (this.cached !== void 0 && now - this.cachedAt < this.ttlMs()) return toView(this.cached);
		if (now < this.failureUntilMs) return this.lastError ?? {
			error: "fetch",
			message: "Unknown failure"
		};
		if (this.inflight !== void 0) return this.inflight;
		this.inflight = this.query().then((view) => {
			if (view.error === void 0) this.lastError = void 0;
			else {
				this.lastError = view;
				this.failureUntilMs = Date.now() + FAILURE_COOLDOWN_MS;
			}
			return view;
		}).finally(() => {
			this.inflight = void 0;
		});
		return this.inflight;
	}
	/** RPC: force a fresh provider query (bypasses the cache window). */
	async refresh() {
		if (!this.enabled) return {
			error: "disabled",
			message: "The ocgo-usage plugin is disabled."
		};
		const view = await this.query();
		if (view.error === void 0) {
			this.lastError = void 0;
			this.failureUntilMs = 0;
		} else {
			this.lastError = view;
			this.failureUntilMs = Date.now() + FAILURE_COOLDOWN_MS;
		}
		return view;
	}
	/**
	* Drop the cached usage, the failure cooldown, and the last error so the
	* next read re-queries with the freshly written config. Called after a
	* config edit.
	*/
	invalidateCache() {
		this.cached = void 0;
		this.cachedAt = 0;
		this.failureUntilMs = 0;
		this.lastError = void 0;
	}
	async query() {
		try {
			const data = await fetchUsage(loadConfig());
			this.cached = data;
			this.cachedAt = Date.now();
			return toView(data);
		} catch (error) {
			return errorView(error);
		}
	}
};
/** Convert the internal normalized shape into the browser view. */
function toView(data) {
	return {
		updatedAt: data.updatedAt,
		...data.rolling === void 0 ? {} : { rolling: data.rolling },
		...data.weekly === void 0 ? {} : { weekly: data.weekly },
		...data.monthly === void 0 ? {} : { monthly: data.monthly }
	};
}
//#endregion
//#region src/index.ts
/** Stable cordis plugin name (matches cordis.patch.yml insert id). */
const name = "ocgo-usage";
/** Services required before the usage service can answer. */
const inject = ["webServer"];
/** Register the usage service and its API routes on the context. */
function apply(ctx, config = {}) {
	const routes = makeOcgoRoutes(new OcgoUsageService(ctx, config));
	ctx.effect(() => {
		const disposers = routes.map((route) => ctx.webServer.register(route));
		return () => {
			for (const dispose of disposers) dispose();
		};
	}, "ocgo-usage: routes");
}
//#endregion
export { OCGO_API_PREFIX, OcgoUsageService, UsageError, apply, configFilePath, fetchUsage, fromSSRHTML, inject, loadConfig, makeOcgoRoutes, name, normalizeCookie, parseDurationToSec };

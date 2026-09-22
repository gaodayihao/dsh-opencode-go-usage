import { a as loadConfig, c as writeConfigFile, i as configFilePath, o as maskedConfigView, s as normalizeCookie, t as CONSOLE_COOKIE_NAMES } from "./config-DOvMDZ6k.js";
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
/** Console JSON endpoint carrying the Go subscription meters. */
const GO_STATUS_PATH = "/console/api/go/status";
/** Header the console uses to select the workspace for an API call. */
const WORKSPACE_HEADER = "x-org-id";
/** Console meter name behind each plugin window. */
const METER_KEYS = {
	rolling: "fiveHour",
	weekly: "week",
	monthly: "month"
};
/** Every window the plugin knows about, in display order. */
const KINDS = [
	"rolling",
	"weekly",
	"monthly"
];
/** Error thrown by the HTTP / parsing layer; carries a short code for the UI. */
var UsageError = class extends Error {
	code;
	name = "UsageError";
	constructor(message, code) {
		super(message);
		this.code = code;
	}
};
/** Fetch usage through the cookie path. Throws UsageError on any failure. */
async function fetchViaCookie(cfg) {
	if (!cfg.cookie || !cfg.workspaceID) throw new UsageError("Missing cookie or workspaceID for cookie path", "noconfig");
	return fromStatusJSON(await fetchGoStatus(cfg), Date.now());
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
	try {
		let res;
		try {
			res = await fetch(url, {
				method: "GET",
				headers: {
					Cookie: cfg.cookie ?? "",
					Accept: "application/json",
					[WORKSPACE_HEADER]: cfg.workspaceID ?? ""
				},
				signal: controller.signal
			});
		} catch (e) {
			throw transportError(e, cfg.timeoutMs);
		}
		if (!res.ok) throw statusError(res.status);
		try {
			return await res.json();
		} catch (e) {
			if (isAbort(e)) throw transportError(e, cfg.timeoutMs);
			throw new UsageError(`Usage API returned a non-JSON body (HTTP ${res.status})`, "parse");
		}
	} finally {
		clearTimeout(timer);
	}
}
/** True for the error `AbortController.abort()` surfaces. */
function isAbort(error) {
	return error instanceof Error && error.name === "AbortError";
}
/** Map a transport-level throw (abort or socket failure) onto a named error. */
function transportError(error, timeoutMs) {
	if (isAbort(error)) return new UsageError(`Request timed out after ${timeoutMs}ms`, "timeout");
	return new UsageError(String(error instanceof Error ? error.message : error), "fetch");
}
/** Map an unsuccessful HTTP status onto a named error. */
function statusError(status) {
	if (status === 400) return new UsageError("The console rejected the workspace id (x-org-id); it must be a wrk_… id you are a member of.", "badworkspace");
	if (status === 401) return new UsageError("The console session cookie was rejected; sign in to opencode.ai again and paste the fresh cookie.", "unauthorized");
	if (status === 404) return new UsageError("No Go subscription found for this workspace (unknown workspace id, or the plan is not on this account).", "notfound");
	return new UsageError(`HTTP ${status} for ${GO_STATUS_PATH}`, `http${status}`);
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
function fromStatusJSON(payload, now = Date.now()) {
	const access = member(payload, "access");
	if (!isRecord(access)) return {};
	const meters = member(access, "meters");
	if (!isRecord(meters)) return {};
	const periodEnd = isoString(member(access, "endsAt"));
	const result = {};
	for (const kind of KINDS) {
		const meter = member(meters, METER_KEYS[kind]);
		if (!isRecord(meter)) continue;
		const window = toWindow(kind, meter, kind === "monthly" ? periodEnd : isoString(member(meter, "resetsAt")), now);
		if (window !== void 0) result[kind] = window;
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
	const usage = decimal(member(meter, "usedMicroCents"));
	const limit = decimal(member(meter, "limitMicroCents"));
	if (usage === void 0 && limit === void 0) return void 0;
	const percent = limit !== void 0 && limit > 0 ? clampPercent((usage ?? 0) / limit * 100) : 0;
	return {
		kind,
		percent,
		resetInSec: secondsUntil(resetsAt, now),
		status: percent >= 100 ? "rate-limited" : "ok",
		...usage === void 0 ? {} : { usage },
		...limit === void 0 ? {} : { limit },
		...resetsAt === void 0 ? {} : { resetsAt }
	};
}
/** True for a non-null, non-array object. */
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** Read one member off an unknown value, or undefined when it is not a record. */
function member(value, key) {
	return isRecord(value) ? value[key] : void 0;
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
	if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : void 0;
	if (typeof value !== "string" || value.length === 0) return void 0;
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : void 0;
}
/** Accept a member only when it is a parseable ISO-8601 timestamp string. */
function isoString(value) {
	if (typeof value !== "string" || value.length === 0) return void 0;
	return Number.isFinite(Date.parse(value)) ? value : void 0;
}
/**
* Seconds from `now` until an ISO timestamp, clamped at 0. A window that has
* not opened yet (a null `resetsAt`) reports 0, matching the console.
* @param at - the ISO reset instant, when known.
* @param now - epoch ms.
* @returns whole seconds remaining (rounded up, like the console's own countdown).
*/
function secondsUntil(at, now) {
	if (at === void 0) return 0;
	const target = Date.parse(at);
	if (!Number.isFinite(target)) return 0;
	return Math.max(0, Math.ceil((target - now) / 1e3));
}
/**
* Clamp a percent into [0, 100] keeping at most one decimal (the meters report
* fractional usage, e.g. 11.4).
* @param n - raw percent.
* @returns the clamped percent.
*/
function clampPercent(n) {
	if (!Number.isFinite(n)) return 0;
	return Math.round(Math.max(0, Math.min(100, n)) * 10) / 10;
}
/**
* Fetch usage with the current config (cookie path only today) and stamp the
* fetch timestamp so the UI can show data freshness.
* @param cfg - resolved config.
* @returns the three windows plus the fetch time.
*/
async function fetchUsage(cfg) {
	return {
		...await fetchViaCookie(cfg),
		updatedAt: Date.now()
	};
}
//#endregion
//#region src/service.ts
/**
* dsh-ocgo-usage host service — the cached OpenCode Go usage read.
* Resolves the config (env + $DSH_HOME/ocgo-usage.json) on every refresh so
* a changed cookie reaches the next query without a plugin restart, fetches
* the console's Go status API, and caches the result so the browser readout can
* poll without spamming opencode.ai.
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
//#region src/types.ts
/**
* Microcents per US dollar — the unit the console API reports its Go
* subscription meters in (100,000,000 microcents = $1).
*/
const MICROCENTS_PER_USD = 1e8;
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
export { CONSOLE_COOKIE_NAMES, GO_STATUS_PATH, MICROCENTS_PER_USD, OCGO_API_PREFIX, OcgoUsageService, UsageError, WORKSPACE_HEADER, apply, configFilePath, fetchUsage, fromStatusJSON, inject, loadConfig, makeOcgoRoutes, name, normalizeCookie };

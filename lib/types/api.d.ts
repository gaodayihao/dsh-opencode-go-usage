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
import type { NormalizedUsage, OcgoConfig } from './types.ts';
/** Console JSON endpoint carrying the Go subscription meters. */
export declare const GO_STATUS_PATH = "/console/api/go/status";
/** Header the console uses to select the workspace for an API call. */
export declare const WORKSPACE_HEADER = "x-org-id";
/** Error thrown by the HTTP / parsing layer; carries a short code for the UI. */
export declare class UsageError extends Error {
    readonly code: string;
    readonly name = "UsageError";
    constructor(message: string, code: string);
}
/** Fetch usage through the cookie path. Throws UsageError on any failure. */
export declare function fetchViaCookie(cfg: OcgoConfig): Promise<Omit<NormalizedUsage, 'updatedAt'>>;
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
export declare function fromStatusJSON(payload: unknown, now?: number): Omit<NormalizedUsage, 'updatedAt'>;
/**
 * Fetch usage with the current config (cookie path only today) and stamp the
 * fetch timestamp so the UI can show data freshness.
 * @param cfg - resolved config.
 * @returns the three windows plus the fetch time.
 */
export declare function fetchUsage(cfg: OcgoConfig): Promise<NormalizedUsage>;
//# sourceMappingURL=api.d.ts.map
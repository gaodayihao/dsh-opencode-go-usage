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
 * The available-credit balance does not live in that payload at all: the read
 * issues a second, independent request,
 *
 * ```jsonc
 * // GET <baseUrl>/console/api/billing/status
 * {
 *   "billingMode": "prepaid",
 *   "mode": "pay-as-you-go",
 *   "balanceMicroCents": "1000000000",
 *   "creditLimitMicroCents": null,
 *   "availableMicroCents": "1000000000",   // the "Available credits" card
 *   "canPurchaseCredits": true
 * }
 * ```
 *
 * and turns `availableMicroCents` into {@link CreditSummary}. The two requests
 * share one deadline and are issued together; the credit read is secondary, so
 * a failing billing endpoint (404 on an account with no billing profile, 403
 * for a non-owner) only drops the credit row.
 *
 * Adapted from pi-ocgo-usage/src/api.ts.
 * @module dsh-ocgo-usage/api
 */
import type { CreditSummary, NormalizedUsage, OcgoConfig } from './types.ts';
/** Console JSON endpoint carrying the Go subscription meters. */
export declare const GO_STATUS_PATH = "/console/api/go/status";
/**
 * Console JSON endpoint carrying the account's credit balance.
 *
 * This is the request behind the console Billing page's "Available credits"
 * card. It is a *separate* resource from the Go meters — `go/status` never
 * reports the pay-as-you-go balance — and it is secondary to this plugin's
 * read, so a failure here drops the credit row instead of failing the chip.
 */
export declare const BILLING_STATUS_PATH = "/console/api/billing/status";
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
export declare function fromBillingJSON(payload: unknown): CreditSummary | undefined;
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
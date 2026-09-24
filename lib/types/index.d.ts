/**
 * dsh-ocgo-usage host half — mounts the usage service and its HTTP routes.
 * The browser half (the `./client` entry) reads the three OpenCode Go usage
 * windows (rolling 5h / weekly / monthly) plus the account's available credit
 * through the same-origin `/api/ocgo-usage` JSON endpoints. The windows come
 * from the console's Go subscription API (`/console/api/go/status`) and the
 * balance from its billing API (`/console/api/billing/status`), which is what
 * the console SPA itself renders. Install via
 * `dsh plugin --profile web add <path-or-git-url>`; the cordis.patch.yml
 * inserts this plugin row.
 * @module dsh-ocgo-usage
 */
import { Context } from '@deepseek-ai/cordis';
import { type OcgoUsageConfig } from './service.ts';
export { OcgoUsageService } from './service.ts';
export type { OcgoUsageConfig, OcgoUsageView } from './service.ts';
export { OCGO_API_PREFIX, makeOcgoRoutes } from './routes.ts';
export { loadConfig, normalizeCookie, configFilePath, CONSOLE_COOKIE_NAMES } from './config.ts';
export { MICROCENTS_PER_USD, type CreditSummary, type NormalizedUsage, type OcgoConfig, type UsageWindow, type UsageWindowKind, type UsageStatus, } from './types.ts';
export { BILLING_STATUS_PATH, fetchUsage, fromBillingJSON, fromStatusJSON, GO_STATUS_PATH, WORKSPACE_HEADER, UsageError, } from './api.ts';
/** Stable cordis plugin name (matches cordis.patch.yml insert id). */
export declare const name = "ocgo-usage";
/** Services required before the usage service can answer. */
export declare const inject: string[];
/** Register the usage service and its API routes on the context. */
export declare function apply(ctx: Context, config?: OcgoUsageConfig): void;
//# sourceMappingURL=index.d.ts.map
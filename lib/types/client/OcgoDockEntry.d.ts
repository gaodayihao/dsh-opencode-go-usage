/**
 * The composer tool-row entry: the OpenCode Go usage readout, mounted in the
 * composer toolbar (`conversation.input.right`) next to the model selector.
 * While the session's selected model provider is `opencode-go` the chip polls
 * the host `/api/ocgo-usage` endpoint for the three usage windows
 * (rolling 5h / weekly / monthly);
 * clicking reveals per-window spend + reset countdowns, a Set editor (masked
 * workspace/cookie) and a manual refresh. In the error state, clicking the
 * chip opens the Set editor directly so a stale credential can be replaced in
 * place. The chip renders nothing for every other provider.
 * @module dsh-ocgo-usage/client/OcgoDockEntry
 */
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import { type UsageWindow } from '../types.ts';
import { NS } from './locales.ts';
/** Composed props of the dock entry (runtime + locale; the session standard kit,
 * including the `useProjection` selector, rides `PropsRuntime`). */
export type OcgoDockEntryProps = PropsRuntime<'conversation.input.right'> & PropsLocale<typeof NS>;
/**
 * Format a duration (seconds) compactly: 45s / 23m / 5h 23m / 4d 6h.
 */
export declare function formatDuration(totalSec: number): string;
/**
 * Remaining seconds for one window, preferring the absolute `resetsAt` over the
 * `resetInSec` the host baked into the snapshot.
 *
 * The host caches its read for `cacheTTL` seconds (300 by default), so a
 * snapshot's `resetInSec` is already stale by the time the panel opens.
 * `resetsAt` is absolute, so re-deriving the countdown from it keeps the
 * display honest for the whole cache window.
 * @param window - the window to measure.
 * @returns whole seconds until the reset (0 when elapsed or unknown).
 */
export declare function remainingSec(window: UsageWindow): number;
/**
 * Whether a window has a reset to count down to at all.
 *
 * A rolling window that has not opened yet reports `resetsAt: null` and 0
 * seconds, and "resets in 0s" would be misleading noise — the official console
 * omits the phrase in exactly this case.
 * @param window - the window to check.
 * @returns true when a countdown is meaningful.
 */
export declare function hasReset(window: UsageWindow): boolean;
/**
 * Format a window's absolute spend as `$used / $limit`, or undefined when the
 * API did not report both sides.
 *
 * The Go meters are money-denominated since the subscription API landed, so
 * this is the number that actually explains the percentage ("94.7%" is only
 * meaningful next to "$56.84 / $60.00").
 * @param window - the window to format.
 * @returns the formatted pair, or undefined.
 */
export declare function formatSpend(window: UsageWindow): string | undefined;
/** Format a window percent for display (keeps one decimal, drops a trailing `.0`). */
export declare function formatPercent(percent: number): string;
/**
 * The OpenCode Go usage chip: rendered only while the session's selected model
 * provider is `opencode-go`, polls the host snapshot while shown, renders the
 * three windows inline, and expands into a detail panel on click.
 * @param props - the composed dock entry props (including the session kit's `useProjection`).
 */
export declare function OcgoDockEntry(props: OcgoDockEntryProps): React.ReactElement | null;
//# sourceMappingURL=OcgoDockEntry.d.ts.map
/**
 * dsh-ocgo-usage browser half — registers the OpenCode Go usage chip into
 * the composer tool row (`conversation.input.right`, next to the model
 * selector) and reads the host's same-origin `/api/ocgo-usage` JSON endpoints:
 * poll the host snapshot (every 10 s), refresh on demand. The chip shows the
 * three usage windows (rolling 5h / weekly / monthly) in a compact form; while
 * the host reports no usable data (missing config, cookie error, or provider
 * failure) it renders a compact `<err:code>` state with a manual refresh
 * action.
 *
 * Provider visibility is decided CLIENT-side from the session's live model
 * selection, read through the framework standard kit `useProjection`
 * ('modelSelection'): the durable seat updates the moment a selection is made
 * or consumed by a request, so switching models via the composer seat or
 * `/model` hides/shows the chip on the very next render. The chip renders
 * nothing while the current provider is not `opencode-go`, mirroring
 * pi-ocgo-usage.
 * @module dsh-ocgo-usage/client
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
import { type OcgoKey } from './locales.ts';
export { providerOfModelSelection, OCGO_PROVIDER } from '../provider.ts';
export { OcgoDockEntry, formatCredit, formatDuration, formatPercent, formatSpend, hasReset, remainingSec } from './OcgoDockEntry.tsx';
export type { OcgoDockEntryProps } from './OcgoDockEntry.tsx';
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        /** dsh-ocgo-usage chip copy. */
        ocgo: OcgoKey;
    }
}
/** Required services: the slot registry (the chip's seat) and locale (copy). */
export declare const inject: string[];
/**
 * Register the usage chip into the composer tool row next to the model selector.
 *
 * `ctx.slots.inject` defers the registration to every declaration lifetime of
 * `conversation.input.right` (the composer bar declares that slot when it
 * mounts), so this plugin needs no load-order dependency on the conversation
 * package. The business face is empty: the chip reads its session's model
 * selection through the framework-delivered `useProjection` standard seat.
 * @param ctx - client root context.
 */
export declare function apply(ctx: ClientContext): void;
//# sourceMappingURL=index.d.ts.map
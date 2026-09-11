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

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only (erased; never reaches the bundle): each empty import pulls a
// package's AMBIENT declarations into the program without a runtime import —
// the locale plugin's Context merge (ctx.locale), the Session standard kit
// merge (`useProjection`), the ui-conversation SlotMap merge (the composer tool
// row entry), and the slot registry's SlotMap/LocaleNamespaceMap merge points.
// The registration target itself must stay a type-only reference: these
// packages are not module-table entries, so a value import would emit a
// `require` the browser loader cannot answer.
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { OCGO_PROVIDER } from '../provider.ts'
import { OcgoDockEntry, type OcgoDockEntryProps } from './OcgoDockEntry.tsx'
import { en, zh, type OcgoKey } from './locales.ts'

export { providerOfModelSelection, OCGO_PROVIDER } from '../provider.ts'

export { OcgoDockEntry, formatDuration } from './OcgoDockEntry.tsx'
export type { OcgoDockEntryProps } from './OcgoDockEntry.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** dsh-ocgo-usage chip copy. */
    ocgo: OcgoKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'ocgo'

/** Required services: the slot registry (the chip's seat) and locale (copy). */
export const inject = ['slots', 'locale']

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
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-ocgo-usage: dictionaries')

  ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
    name: 'conversation.input.right',
    id: 'ocgo-usage',
    order: 110,
    locale: NS,
  }, OcgoDockEntry as (props: OcgoDockEntryProps) => ReturnType<typeof OcgoDockEntry>))
}

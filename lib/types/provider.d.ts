/**
 * Provider matching for dsh-ocgo-usage: decide when the chip should show.
 * Pure and shared so the client logic is unit-testable without a browser.
 * @module dsh-ocgo-usage/provider
 */
import type { SessionProjectionMap } from '@deepseek-ai/dsh-api-session-controller/client';
/** The provider whose model selection shows the chip. */
export declare const OCGO_PROVIDER = "opencode-go";
/** True when a provider/model means "show OpenCode Go usage". */
export declare function isOpenCodeGo(provider: string | undefined): boolean;
/**
 * Resolve the provider of a session's effective model selection from the
 * `modelSelection` session projection value (`next` is the selection the next
 * request uses; the host already folds it back to the last used one).
 *
 * This is the DSH 0.1.5 replacement for the rc.6 `session.models` Remote: the
 * durable projection is pushed to the client, so the chip's visibility follows
 * a model/provider switch without a round trip.
 * @param value - the `useProjection('modelSelection')` value.
 * @returns the provider id, or undefined when the capability or selection is absent.
 */
export declare function providerOfModelSelection(value: SessionProjectionMap['modelSelection'] | undefined): string | undefined;
//# sourceMappingURL=provider.d.ts.map
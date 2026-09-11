/**
 * Shared browser platform modules. Seeding, bundling externals, and Vite
 * aliases consume this list so their module identities cannot drift.
 * Synced from the DSH checkout's `packages/client/web/src/platform.ts`
 * (0.1.5-rc.1) — the frozen module table the web shell shares with plugin
 * bundles. A specifier that left this list must not be imported as a value by
 * the client half, or the injected `require` cannot answer it at boot; the
 * DSH build's purity gate catches the same mistake in-box.
 * @module dsh-ocgo-usage/web-platform
 */

/** The module specifiers the shell shares into the frozen module table. */
export const PLATFORM_MODULES = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
] as const

/** One platform module specifier (a seed-table key). */
export type PlatformModule = (typeof PLATFORM_MODULES)[number]

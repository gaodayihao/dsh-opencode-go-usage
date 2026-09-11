/**
 * Client registration test: loads the BUILT browser bundle
 * (`lib/client.js`) the same way the DSH module table does — through
 * `window.__ModuleLoader__.load({ id, factory })` — and drives `apply` against a
 * fake slot registry.
 *
 * This is the regression cover for the 0.1.5 breakage: the browser half must
 * register into `conversation.input.right` through `ctx.slots.inject` (the
 * declaration-deferred seat) rather than assuming the slot already exists, and
 * it must not reach for a model-selection RPC that no longer exists.
 *
 * Requires `pnpm run build` first — a stale `lib/` fails this suite.
 * @module dsh-ocgo-usage/client/registration.test
 */

import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

interface LoaderHandoff {
  id: string
  factory: (require: (specifier: string) => unknown) => unknown
}

/** Minimal structural view of the client half's public shape. */
interface ClientPlugin {
  name?: string
  inject?: readonly string[]
  apply(ctx: unknown): void
}

const BUNDLE = resolve(process.cwd(), 'lib/client.js')
const nodeRequire = createRequire(import.meta.url)

/** Evaluate the built bundle and return its factory handoff. */
function loadBundle(): LoaderHandoff {
  if (!existsSync(BUNDLE)) {
    throw new Error(`lib/client.js is missing — run \`pnpm run build\` before \`pnpm test\` (${BUNDLE})`)
  }
  const source = readFileSync(BUNDLE, 'utf8')
  let handoff: LoaderHandoff | undefined
  const target = globalThis as unknown as { window?: Record<string, unknown> }
  target.window = target.window ?? {}
  ;(target.window as Record<string, unknown>).__ModuleLoader__ = {
    load: (value: LoaderHandoff) => { handoff = value },
  }
  // The bundle is a closure-factory artifact; evaluating it only registers the
  // factory, so a plain indirect eval matches the browser's classic-script load.
  const evaluate = new Function(source) as () => void
  evaluate()
  if (handoff === undefined) throw new Error('lib/client.js did not call window.__ModuleLoader__.load')
  return handoff
}

/** Resolve the bundle's externals from the real install (react, react/jsx-runtime). */
function bundleRequire(specifier: string): unknown {
  return nodeRequire(specifier)
}

/** A fake slot registry recording the calls the plugin makes. */
function fakeSlots() {
  const injections: string[] = []
  const registrations: { options: Record<string, unknown>; component: unknown }[] = []
  const core = {
    inject(key: string, callback: () => () => void) {
      injections.push(key)
      callback()
      return () => {}
    },
    register(options: Record<string, unknown>, component: unknown) {
      registrations.push({ options, component })
      return () => {}
    },
  }
  return { core, injections, registrations }
}

function fakeClientContext(slots: ReturnType<typeof fakeSlots>['core']) {
  const effects: string[] = []
  return {
    ctx: {
      slots,
      locale: { register: (ns: string) => { effects.push(`locale:${ns}`); return () => {} } },
      effect: (factory: () => unknown, label?: string) => {
        effects.push(label ?? 'effect')
        const dispose = factory()
        return typeof dispose === 'function' ? dispose : () => {}
      },
    },
    effects,
  }
}

describe('client bundle registration', () => {
  it('registers the chip into conversation.input.right through slots.inject', () => {
    const handoff = loadBundle()
    expect(handoff.id).toBe('dsh-ocgo-usage')

    const plugin = handoff.factory(bundleRequire) as ClientPlugin
    expect(plugin.inject).toEqual(['slots', 'locale'])

    const { core, injections, registrations } = fakeSlots()
    const { ctx, effects } = fakeClientContext(core)
    plugin.apply(ctx)

    // The declaration-deferred seat: the composer bar owns the slot's lifetime,
    // so the plugin waits for its declaration instead of injecting the whole
    // conversation package.
    expect(injections).toEqual(['conversation.input.right'])
    expect(effects).toContain('locale:ocgo')
    expect(registrations).toHaveLength(1)

    const { options, component } = registrations[0]!
    expect(options.name).toBe('conversation.input.right')
    expect(options.id).toBe('ocgo-usage')
    expect(options.locale).toBe('ocgo')
    expect(typeof options.order).toBe('number')
    expect(typeof component).toBe('function')
    // No inject face: provider visibility rides the standard `useProjection`
    // seat, not a per-entry business object.
    expect(options.inject).toBeUndefined()
  })
})

// Keep `vi` referenced for the shared test helper import shape.
void vi

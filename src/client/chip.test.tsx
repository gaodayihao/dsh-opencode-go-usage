/**
 * Chip render tests over the browser component SOURCE: prove the provider gate
 * that broke under DSH 0.1.5 — the chip renders while the session's
 * `modelSelection` projection selects `opencode-go`, and renders nothing when
 * it selects another provider (the removed `session.models` read used to make
 * this an unconditional "not opencode-go").
 *
 * The component is imported from source rather than from `lib/client.js`
 * because the built artifact resolves React through the injected
 * `__ModuleLoader__` require, while this test host provides the ESM React —
 * two instances cannot share the hook dispatcher. `lib/client.js`'s bundling
 * and registration contract are covered by `registration.test.ts`.
 * @module dsh-ocgo-usage/client/chip.test
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OcgoDockEntry, type OcgoDockEntryProps } from './OcgoDockEntry.tsx'
import type { OcgoUsageView } from '../types.ts'

// Vite would need a CSS pipeline for the real stylesheet; the tests only need
// the class-name contract to resolve.
vi.mock('./ocgo.module.css', () => ({
  default: new Proxy({}, { get: (_target, key: string) => `css-${key}` }),
}))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** Snapshot the host endpoint answers with while the chip is shown. */
function usageView(): OcgoUsageView {
  return {
    updatedAt: Date.UTC(2026, 8, 11, 12, 30),
    rolling: { kind: 'rolling', percent: 12, resetInSec: 4980, status: 'ok' },
    weekly: { kind: 'weekly', percent: 65, resetInSec: 234000, status: 'ok' },
    monthly: { kind: 'monthly', percent: 100, resetInSec: 1537200, status: 'rate-limited' },
  }
}

/** Install a fetch stub for the same-origin usage API. */
function stubFetch(view: OcgoUsageView = usageView()): void {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.startsWith('/api/ocgo-usage')) {
      return new Response(JSON.stringify(view), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    return new Response('not found', { status: 404 })
  }))
}

/** Minimal translate stub: `{name}` interpolation only, keys echoed back. */
function translate(key: string, params?: Record<string, unknown>): string {
  if (params === undefined) return key
  return Object.entries(params).reduce((text, [name, value]) => text.replace(`{${name}}`, String(value)), key)
}

/** Props the dock entry reads; the session kit's other seats are inert stubs
 * (this component only consumes `useProjection` and `t`). */
function props(projection: unknown): OcgoDockEntryProps {
  return {
    useProjection: ((key: string) => (key === 'modelSelection' ? projection : undefined)) as never,
    t: translate as never,
  } as unknown as OcgoDockEntryProps
}

const opencodeGo = { lastUsed: null, next: { provider: 'opencode-go', model: 'deepseek-flash' } }
const deepseek = { lastUsed: null, next: { provider: 'deepseek', model: 'deepseek-v4-pro' } }

describe('usage chip provider gate', () => {
  it('renders the three windows while the selection is opencode-go', async () => {
    stubFetch()
    render(<OcgoDockEntry {...props(opencodeGo)} />)

    await waitFor(() => {
      expect(screen.getByTestId('ocgo-chip')).toBeDefined()
    })
    const chip = screen.getByTestId('ocgo-chip')
    expect(chip.textContent).toContain('5h 12%')
    expect(chip.textContent).toContain('wk 65%')
    expect(chip.textContent).toContain('mo 100%')
  })

  it('renders nothing for another provider', () => {
    stubFetch()
    const view = render(<OcgoDockEntry {...props(deepseek)} />)
    expect(view.container.innerHTML).toBe('')
    expect(screen.queryByTestId('ocgo-chip')).toBeNull()
  })

  it('renders nothing while the projection capability is absent', () => {
    stubFetch()
    const view = render(<OcgoDockEntry {...props(undefined)} />)
    expect(view.container.innerHTML).toBe('')
  })

  it('renders nothing while no model has been selected yet', () => {
    stubFetch()
    const view = render(<OcgoDockEntry {...props({ lastUsed: null, next: null })} />)
    expect(view.container.innerHTML).toBe('')
  })

  it('expands the detail panel on click', async () => {
    stubFetch()
    render(<OcgoDockEntry {...props(opencodeGo)} />)

    await waitFor(() => {
      expect(screen.getByTestId('ocgo-chip')).toBeDefined()
    })
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('ocgo.rolling')).toBeDefined()
    expect(screen.getByText('ocgo.set')).toBeDefined()
    expect(screen.getByText('ocgo.refresh')).toBeDefined()
  })

  it('shows the error chip when the host endpoint fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })))
    render(<OcgoDockEntry {...props(opencodeGo)} />)

    await waitFor(() => {
      expect(screen.getByTestId('ocgo-chip-error')).toBeDefined()
    })
    expect(screen.getByTestId('ocgo-chip-error').textContent).toContain('err:fetch')
  })
})

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
import {
  formatSpend,
  hasReset,
  OcgoDockEntry,
  remainingSec,
  type OcgoDockEntryProps,
} from './OcgoDockEntry.tsx'
import type { OcgoUsageView, UsageWindow } from '../types.ts'
import { en } from './locales.ts'

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
    rolling: {
      kind: 'rolling',
      percent: 12,
      resetInSec: 4980,
      status: 'ok',
      usage: 144_000_000,
      limit: 1_200_000_000,
    },
    weekly: {
      kind: 'weekly',
      percent: 65,
      resetInSec: 234000,
      status: 'ok',
      usage: 1_950_000_000,
      limit: 3_000_000_000,
    },
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

/** Translate stub: resolves the English dictionary and interpolates `{name}`. */
function translate(key: string, params?: Record<string, unknown>): string {
  const template = (en as Record<string, string>)[key] ?? key
  if (params === undefined) return template
  return Object.entries(params).reduce(
    (text, [name, value]) => text.replace(`{${name}}`, String(value)),
    template,
  )
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
    expect(screen.getByText('5h Rolling')).toBeDefined()
    expect(screen.getByText('Set')).toBeDefined()
    expect(screen.getByText('Refresh')).toBeDefined()
  })

  it('shows the absolute spend per window in the detail panel', async () => {
    stubFetch()
    render(<OcgoDockEntry {...props(opencodeGo)} />)

    await waitFor(() => {
      expect(screen.getByTestId('ocgo-chip')).toBeDefined()
    })
    fireEvent.click(screen.getByRole('button'))
    // The Go meters are money caps; the panel spells them out in dollars.
    expect(screen.getByText(/\$1\.44 \/ \$12\.00/)).toBeDefined()
    expect(screen.getByText(/\$19\.50 \/ \$30\.00/)).toBeDefined()
  })

  it('derives the countdown from resetsAt, not the cached resetInSec', async () => {
    const view = usageView()
    // A deliberately stale second count against an absolute reset 2 hours out.
    view.rolling = {
      ...view.rolling!,
      resetInSec: 999_999,
      resetsAt: new Date(Date.now() + 2 * 3600 * 1000 + 30_000).toISOString(),
    }
    stubFetch(view)
    render(<OcgoDockEntry {...props(opencodeGo)} />)

    await waitFor(() => {
      expect(screen.getByTestId('ocgo-chip')).toBeDefined()
    })
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText(/resets in 2h/)).toBeDefined()
    expect(screen.queryByText(/resets in 11d/)).toBeNull()
  })

  it('omits the countdown for a window with no reset time (unopened 5h window)', async () => {
    const view = usageView()
    // Exactly the live shape: the rolling meter resets nothing until it opens.
    view.rolling = { kind: 'rolling', percent: 0, resetInSec: 0, status: 'ok' }
    stubFetch(view)
    render(<OcgoDockEntry {...props(opencodeGo)} />)

    await waitFor(() => {
      expect(screen.getByTestId('ocgo-chip')).toBeDefined()
    })
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('5h Rolling')).toBeDefined()
    expect(screen.queryByText(/resets in 0s/)).toBeNull()
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

describe('remainingSec', () => {
  /** A window with only the fields the countdown reads. */
  function window(resetInSec: number, resetsAt?: string): UsageWindow {
    return { kind: 'rolling', percent: 0, resetInSec, status: 'ok', ...(resetsAt === undefined ? {} : { resetsAt }) }
  }

  it('prefers the absolute resetsAt over the snapshot seconds', () => {
    // ISO-8601 drops milliseconds, so derive the expectation the same way.
    const at = new Date(Date.now() + 3600 * 1000 + 30_000).toISOString()
    const expected = Math.ceil((Date.parse(at) - Date.now()) / 1000)
    expect(remainingSec(window(999_999, at))).toBe(expected)
    expect(expected).toBeGreaterThanOrEqual(3600)
    expect(expected).toBeLessThanOrEqual(3630)
  })

  it('falls back to resetInSec when the snapshot carries no resetsAt', () => {
    expect(remainingSec(window(4980))).toBe(4980)
  })

  it('falls back to resetInSec for an unparseable resetsAt', () => {
    expect(remainingSec(window(4980, 'whenever'))).toBe(4980)
  })

  it('clamps an elapsed resetsAt to zero', () => {
    expect(remainingSec(window(0, new Date(Date.now() - 60_000).toISOString()))).toBe(0)
  })
})

describe('hasReset', () => {
  const base = { kind: 'rolling' as const, percent: 0, status: 'ok' as const }

  it('is true whenever the snapshot carries a reset time', () => {
    expect(hasReset({ ...base, resetInSec: 1 })).toBe(true)
    expect(hasReset({ ...base, resetInSec: 0, resetsAt: '2026-09-22T00:00:00.000Z' })).toBe(true)
  })

  it('is false for a window that has not opened yet (no reset at all)', () => {
    expect(hasReset({ ...base, resetInSec: 0 })).toBe(false)
  })
})

describe('formatSpend', () => {
  it('renders microcents as dollars for both sides of the meter', () => {
    expect(formatSpend({
      kind: 'monthly',
      percent: 94.7,
      resetInSec: 0,
      status: 'ok',
      usage: 5_683_871_800,
      limit: 6_000_000_000,
    })).toBe('$56.84 / $60.00')
  })

  it('returns undefined when the snapshot omits either side', () => {
    const base = { kind: 'weekly' as const, percent: 50, resetInSec: 0, status: 'ok' as const }
    expect(formatSpend(base)).toBeUndefined()
    expect(formatSpend({ ...base, usage: 1 })).toBeUndefined()
    expect(formatSpend({ ...base, limit: 1 })).toBeUndefined()
  })
})

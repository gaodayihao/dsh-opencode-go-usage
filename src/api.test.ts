/**
 * Unit tests for the Go status API adapter.
 *
 * The console used to server-render the numbers into `GET /workspace/<wrk>/go`;
 * it now ships a client-side SPA that hydrates from
 * `GET /console/api/go/status`, so these tests pin the JSON contract (meters,
 * microcents, `x-org-id`, error mapping) rather than any page markup.
 * @module dsh-ocgo-usage/api.test
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BILLING_STATUS_PATH,
  fetchViaCookie,
  fromBillingJSON,
  fromStatusJSON,
  GO_STATUS_PATH,
  UsageError,
  WORKSPACE_HEADER,
} from './api.ts'
import type { OcgoConfig } from './types.ts'

/** The real payload shape, trimmed to the fields the adapter reads. */
const STATUS = {
  subscriberUserId: 'acc_01M13HM528DZ14NP0MQ9VQXHPW',
  useBalance: true,
  cancelAtPeriodEnd: false,
  renewalPending: false,
  access: {
    startsAt: '2026-08-29T02:24:46.000Z',
    endsAt: '2026-09-29T02:24:46.000Z',
    cancelAtPeriodEnd: false,
    meters: {
      fiveHour: {
        startsAt: null,
        resetsAt: null,
        limitMicroCents: '1200000000',
        usedMicroCents: '0',
      },
      week: {
        startsAt: '2026-09-21T00:00:00.000Z',
        resetsAt: '2026-09-28T00:00:00.000Z',
        limitMicroCents: '3000000000',
        usedMicroCents: '1500000000',
      },
      month: {
        limitMicroCents: '6000000000',
        usedMicroCents: '5683871800',
      },
    },
  },
}

/** A fixed clock so `resetInSec` is deterministic. */
const NOW = Date.parse('2026-09-22T00:00:00.000Z')

/** The real billing payload shape, trimmed to the field the adapter reads. */
const BILLING = {
  billingMode: 'prepaid',
  mode: 'pay-as-you-go',
  balanceMicroCents: '1000000000',
  creditLimitMicroCents: null,
  availableMicroCents: '1000000000',
  canPurchaseCredits: true,
  canEnableAutoRecharge: true,
  canEnrollInPrepaid: false,
}

function config(overrides: Partial<OcgoConfig> = {}): OcgoConfig {
  return {
    cookie: '__Host-console_session=st_test',
    workspaceID: 'wrk_01M13HM69T4HK5M026TQEZ33KN',
    baseUrl: 'https://opencode.ai',
    cacheTTL: 300,
    timeoutMs: 10_000,
    ...overrides,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('fromStatusJSON', () => {
  it('maps the three meters onto rolling / weekly / monthly', () => {
    const parsed = fromStatusJSON(STATUS, NOW)
    expect(parsed.rolling).toEqual({
      kind: 'rolling',
      percent: 0,
      resetInSec: 0,
      status: 'ok',
      usage: 0,
      limit: 1_200_000_000,
    })
    expect(parsed.weekly).toEqual({
      kind: 'weekly',
      percent: 50,
      resetInSec: 6 * 86400,
      status: 'ok',
      usage: 1_500_000_000,
      limit: 3_000_000_000,
      resetsAt: '2026-09-28T00:00:00.000Z',
    })
    // The monthly meter has no resetsAt of its own: the console resets it when
    // the paid period ends, so it borrows access.endsAt.
    expect(parsed.monthly).toEqual({
      kind: 'monthly',
      percent: 94.7,
      resetInSec: 7 * 86400 + 2 * 3600 + 24 * 60 + 46,
      status: 'ok',
      usage: 5_683_871_800,
      limit: 6_000_000_000,
      resetsAt: '2026-09-29T02:24:46.000Z',
    })
  })

  it('keeps one decimal on a fractional percentage', () => {
    // 137231893 / 1200000000 = 11.436% → 11.4, matching the console's own read.
    const parsed = fromStatusJSON({
      access: {
        endsAt: '2026-10-01T00:00:00.000Z',
        meters: {
          fiveHour: { limitMicroCents: '1200000000', usedMicroCents: '137231893' },
        },
      },
    }, NOW)
    expect(parsed.rolling?.percent).toBe(11.4)
  })

  it('marks an exhausted meter rate-limited without exceeding 100%', () => {
    const parsed = fromStatusJSON({
      access: {
        meters: { week: { limitMicroCents: '3000000000', usedMicroCents: '3100000000' } },
      },
    }, NOW)
    expect(parsed.weekly?.status).toBe('rate-limited')
    expect(parsed.weekly?.percent).toBe(100)
  })

  it('treats a spent meter that is exactly at its limit as rate-limited', () => {
    const parsed = fromStatusJSON({
      access: { meters: { month: { limitMicroCents: '6000000000', usedMicroCents: '6000000000' } } },
    }, NOW)
    expect(parsed.monthly?.percent).toBe(100)
    expect(parsed.monthly?.status).toBe('rate-limited')
  })

  it('returns no windows when the workspace has no Go subscription', () => {
    expect(fromStatusJSON({ access: null }, NOW)).toEqual({})
    expect(fromStatusJSON({}, NOW)).toEqual({})
    expect(fromStatusJSON(null, NOW)).toEqual({})
    expect(fromStatusJSON('nope', NOW)).toEqual({})
  })

  it('skips a meter the payload did not carry', () => {
    const parsed = fromStatusJSON({
      access: { meters: { week: { limitMicroCents: '100', usedMicroCents: '50' } } },
    }, NOW)
    expect(parsed.rolling).toBeUndefined()
    expect(parsed.weekly?.percent).toBe(50)
    expect(parsed.monthly).toBeUndefined()
  })

  it('does not divide by a zero or absent limit', () => {
    const parsed = fromStatusJSON({
      access: { meters: { week: { limitMicroCents: '0', usedMicroCents: '500' } } },
    }, NOW)
    expect(parsed.weekly).toEqual({
      kind: 'weekly',
      percent: 0,
      resetInSec: 0,
      status: 'ok',
      usage: 500,
      limit: 0,
    })
  })

  it('accepts numeric members as well as the BigInt decimal strings', () => {
    const parsed = fromStatusJSON({
      access: { meters: { week: { limitMicroCents: 1000, usedMicroCents: 250 } } },
    }, NOW)
    expect(parsed.weekly?.percent).toBe(25)
  })

  it('ignores an unparseable or negative amount instead of reporting NaN', () => {
    const parsed = fromStatusJSON({
      access: {
        meters: {
          week: { limitMicroCents: 'not-a-number', usedMicroCents: '-5' },
          month: { limitMicroCents: '100', usedMicroCents: '50' },
        },
      },
    }, NOW)
    expect(parsed.weekly).toBeUndefined()
    expect(parsed.monthly?.percent).toBe(50)
  })

  it('clamps an elapsed reset time to zero seconds', () => {
    const parsed = fromStatusJSON({
      access: {
        meters: {
          week: {
            resetsAt: '2026-09-01T00:00:00.000Z',
            limitMicroCents: '100',
            usedMicroCents: '1',
          },
        },
      },
    }, NOW)
    expect(parsed.weekly?.resetInSec).toBe(0)
    expect(parsed.weekly?.resetsAt).toBe('2026-09-01T00:00:00.000Z')
  })

  it('drops a malformed resetsAt rather than producing NaN seconds', () => {
    const parsed = fromStatusJSON({
      access: {
        meters: {
          week: { resetsAt: 'soon', limitMicroCents: '100', usedMicroCents: '1' },
        },
      },
    }, NOW)
    expect(parsed.weekly?.resetInSec).toBe(0)
    expect(parsed.weekly?.resetsAt).toBeUndefined()
  })

  it('rounds the countdown up, like the console does', () => {
    const parsed = fromStatusJSON({
      access: {
        meters: {
          week: {
            resetsAt: new Date(NOW + 1500).toISOString(),
            limitMicroCents: '100',
            usedMicroCents: '1',
          },
        },
      },
    }, NOW)
    expect(parsed.weekly?.resetInSec).toBe(2)
  })
})

describe('fromBillingJSON', () => {
  it('reads availableMicroCents as the available credit', () => {
    expect(fromBillingJSON(BILLING)).toEqual({ available: 1_000_000_000 })
  })

  it('accepts a numeric member as well as the BigInt decimal string', () => {
    expect(fromBillingJSON({ availableMicroCents: 250 })).toEqual({ available: 250 })
  })

  it('reports a zero balance rather than treating it as absent', () => {
    // $0.00 is a real answer (credit spent) and must still render a row.
    expect(fromBillingJSON({ availableMicroCents: '0' })).toEqual({ available: 0 })
  })

  it('ignores balanceMicroCents when availableMicroCents is absent', () => {
    // For an account with a credit line the two differ, so substituting one for
    // the other would report a number the console never shows.
    expect(fromBillingJSON({ balanceMicroCents: '1000000000' })).toBeUndefined()
  })

  it('returns undefined for a missing, malformed or negative balance', () => {
    expect(fromBillingJSON({})).toBeUndefined()
    expect(fromBillingJSON({ availableMicroCents: null })).toBeUndefined()
    expect(fromBillingJSON({ availableMicroCents: 'not-a-number' })).toBeUndefined()
    expect(fromBillingJSON({ availableMicroCents: '-5' })).toBeUndefined()
    expect(fromBillingJSON(null)).toBeUndefined()
    expect(fromBillingJSON('nope')).toBeUndefined()
    expect(fromBillingJSON([{ availableMicroCents: '1' }])).toBeUndefined()
  })
})

describe('fetchViaCookie', () => {
  /**
   * Spy fetch and answer each console endpoint from its own payload.
   *
   * The read issues two requests (Go meters + billing balance), so a stub
   * keyed on nothing would hand the Go parser a billing body. `billing: null`
   * instead answers that endpoint with a 404 — the shape an account with no
   * billing profile gets.
   * @param status - body (or raw string) for `go/status`.
   * @param init - response init applied to both endpoints.
   * @param billing - body for `billing/status`; `null` → HTTP 404.
   */
  function stubFetch(
    status: unknown,
    init: ResponseInit = {},
    billing: unknown = BILLING,
  ): ReturnType<typeof vi.spyOn> {
    return vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const isBilling = String(input).endsWith(BILLING_STATUS_PATH)
      const body = isBilling ? billing : status
      if (isBilling && body === null) {
        return Promise.resolve(new Response('', { status: 404 }))
      }
      return Promise.resolve(new Response(typeof body === 'string' ? body : JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
        ...init,
      }))
    })
  }

  it('calls both console endpoints with the cookie and the x-org-id header', async () => {
    const spy = stubFetch(STATUS)
    await fetchViaCookie(config())
    expect(spy).toHaveBeenCalledTimes(2)

    const [url, request] = spy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`https://opencode.ai${GO_STATUS_PATH}`)
    const headers = request.headers as Record<string, string>
    expect(headers.Cookie).toBe('__Host-console_session=st_test')
    expect(headers[WORKSPACE_HEADER]).toBe('wrk_01M13HM69T4HK5M026TQEZ33KN')
    expect(request.method).toBe('GET')

    // The balance is a separate resource; it rides the same credentials.
    const [billingUrl, billingRequest] = spy.mock.calls[1] as [string, RequestInit]
    expect(billingUrl).toBe(`https://opencode.ai${BILLING_STATUS_PATH}`)
    expect((billingRequest.headers as Record<string, string>).Cookie).toBe('__Host-console_session=st_test')
  })

  it('carries the available credit alongside the windows', async () => {
    stubFetch(STATUS)
    const data = await fetchViaCookie(config())
    expect(data.credit).toEqual({ available: 1_000_000_000 })
    expect(data.weekly?.percent).toBe(50)
  })

  it('drops the credit row when the billing endpoint fails, keeping the windows', async () => {
    // The billing read is secondary: a 403 (non-owner) or 404 (no billing
    // profile) must not blank the chip that the Go meters can still fill.
    stubFetch(STATUS, {}, null)
    const data = await fetchViaCookie(config())
    expect(data.credit).toBeUndefined()
    expect(data.weekly?.percent).toBe(50)
    expect(data.monthly?.percent).toBe(94.7)
  })

  it('honors a custom base URL (trailing origin only)', async () => {
    const spy = stubFetch(STATUS)
    await fetchViaCookie(config({ baseUrl: 'https://console.example.test' }))
    expect((spy.mock.calls[0] as [string])[0]).toBe(`https://console.example.test${GO_STATUS_PATH}`)
    expect((spy.mock.calls[1] as [string])[0]).toBe(`https://console.example.test${BILLING_STATUS_PATH}`)
  })

  it('refuses to fetch without a cookie or workspace', async () => {
    const spy = stubFetch(STATUS)
    await expect(fetchViaCookie(config({ cookie: undefined }))).rejects.toMatchObject({ code: 'noconfig' })
    await expect(fetchViaCookie(config({ workspaceID: '' }))).rejects.toMatchObject({ code: 'noconfig' })
    expect(spy).not.toHaveBeenCalled()
  })

  it('maps a rejected session cookie (401) to a named error', async () => {
    stubFetch({ _tag: 'Unauthorized' }, { status: 401 })
    const error = await fetchViaCookie(config()).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(UsageError)
    expect((error as UsageError).code).toBe('unauthorized')
    expect((error as UsageError).message).toContain('cookie')
  })

  it('maps a bad workspace id (400) to a named error', async () => {
    stubFetch({ _tag: 'BadRequest' }, { status: 400 })
    await expect(fetchViaCookie(config())).rejects.toMatchObject({ code: 'badworkspace' })
  })

  it('maps an unknown workspace / missing subscription (404) to a named error', async () => {
    stubFetch({ _tag: 'NotFound' }, { status: 404 })
    await expect(fetchViaCookie(config())).rejects.toMatchObject({ code: 'notfound' })
  })

  it('falls back to http<status> for an unnamed failure', async () => {
    stubFetch('boom', { status: 503 })
    await expect(fetchViaCookie(config())).rejects.toMatchObject({ code: 'http503' })
  })

  it('reports a non-JSON body as a parse error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<html>not json</html>', { status: 200, headers: { 'content-type': 'text/html' } }),
    )
    await expect(fetchViaCookie(config())).rejects.toMatchObject({ code: 'parse' })
  })

  it('reports a transport failure as a fetch error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('socket hang up'))
    await expect(fetchViaCookie(config())).rejects.toMatchObject({ code: 'fetch' })
  })

  it('reports a timeout as a timeout error', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
        })
      })
    })
    await expect(fetchViaCookie(config({ timeoutMs: 5 }))).rejects.toMatchObject({ code: 'timeout' })
  })

  it('reports a body read that outlives the timeout as a timeout error', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
      // Headers arrive immediately; the body never settles until the abort.
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
          })
        }),
      } as unknown as Response)
    })
    await expect(fetchViaCookie(config({ timeoutMs: 5 }))).rejects.toMatchObject({ code: 'timeout' })
  })

  it('answers an empty read (no subscription) without throwing', async () => {
    stubFetch({ access: null }, {}, null)
    await expect(fetchViaCookie(config())).resolves.toEqual({})
  })
})

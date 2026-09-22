/**
 * Unit tests for the cached usage service.
 * @module dsh-ocgo-usage/service.test
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ENV_COOKIE, ENV_WORKSPACE_ID } from './config.ts'
import { OcgoUsageService } from './service.ts'

const SAVED_COOKIE = process.env[ENV_COOKIE]
const SAVED_WORKSPACE = process.env[ENV_WORKSPACE_ID]

/** A realistic Go status payload for the mocked fetch. */
const OK_STATUS = JSON.stringify({
  access: {
    endsAt: '2026-09-29T02:24:46.000Z',
    meters: {
      fiveHour: { resetsAt: null, limitMicroCents: '1200000000', usedMicroCents: '0' },
      week: { resetsAt: null, limitMicroCents: '3000000000', usedMicroCents: '1500000000' },
      month: { limitMicroCents: '6000000000', usedMicroCents: '5683871800' },
    },
  },
})

/** Answer the mocked fetch with a JSON body. */
function jsonResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': 'application/json' } })
}

describe('OcgoUsageService', () => {
  let ctx: Context
  let tmp: string

  beforeEach(() => {
    process.env[ENV_COOKIE] = '__Host-console_session=st_test'
    process.env[ENV_WORKSPACE_ID] = 'wrk_test'
    tmp = mkdtempSync(join(tmpdir(), 'dsh-ocgo-usage-svc-'))
    process.env.DSH_HOME = tmp
    ctx = new Context()
  })

  afterEach(() => {
    // Restore mocks FIRST so a failure below cannot leak state into the
    // next test. Cordis 4 exposes no public Context.dispose, and the service
    // owns no timers/subscriptions, so the test context is left for the
    // worker process to reclaim.
    vi.restoreAllMocks()
    if (SAVED_COOKIE === undefined) delete process.env[ENV_COOKIE]
    else process.env[ENV_COOKIE] = SAVED_COOKIE
    if (SAVED_WORKSPACE === undefined) delete process.env[ENV_WORKSPACE_ID]
    else process.env[ENV_WORKSPACE_ID] = SAVED_WORKSPACE
    delete process.env.DSH_HOME
    rmSync(tmp, { recursive: true, force: true })
  })

  it('returns the parsed windows on success', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(OK_STATUS))
    const service = new OcgoUsageService(ctx)
    const view = await service.view()
    expect(view.error).toBeUndefined()
    expect(view.weekly).toEqual({
      kind: 'weekly',
      percent: 50,
      resetInSec: 0,
      status: 'ok',
      usage: 1_500_000_000,
      limit: 3_000_000_000,
    })
    expect(view.monthly?.percent).toBe(94.7)
    expect(view.monthly?.resetsAt).toBe('2026-09-29T02:24:46.000Z')
    expect(view.updatedAt).toBeTypeOf('number')
  })

  it('deduplicates concurrent view() calls into one fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(OK_STATUS))
    const service = new OcgoUsageService(ctx)
    const [a, b] = await Promise.all([service.view(), service.view()])
    expect(a.weekly?.percent).toBe(50)
    expect(b.weekly?.percent).toBe(50)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('serves the cached view within the TTL without refetching', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(OK_STATUS))
    const service = new OcgoUsageService(ctx)
    await service.view()
    await service.view()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('returns a noconfig error when the cookie is missing', async () => {
    delete process.env[ENV_COOKIE]
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(OK_STATUS))
    const service = new OcgoUsageService(ctx)
    const view = await service.view()
    expect(view.error).toBe('noconfig')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('maps an unnamed HTTP failure to an http<status> code and enters cooldown', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('boom', { status: 500 }),
    )
    const service = new OcgoUsageService(ctx)
    const first = await service.view()
    expect(first.error).toBe('http500')
    // Cooldown: the second call reuses the error without fetching again.
    const second = await service.view()
    expect(second.error).toBe('http500')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('surfaces a rejected session cookie as the named unauthorized error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(JSON.stringify({ _tag: 'Unauthorized' }), 401),
    )
    const service = new OcgoUsageService(ctx)
    const view = await service.view()
    expect(view.error).toBe('unauthorized')
    expect(view.message).toContain('cookie')
  })

  it('refresh() bypasses the cache window', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(OK_STATUS))
    const service = new OcgoUsageService(ctx)
    await service.view()
    await service.refresh()
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('answers disabled when the plugin is switched off', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(OK_STATUS))
    const service = new OcgoUsageService(ctx, { enabled: false })
    const view = await service.view()
    expect(view.error).toBe('disabled')
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

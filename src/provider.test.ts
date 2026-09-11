/**
 * Unit tests for the provider matcher.
 * @module dsh-ocgo-usage/provider.test
 */

import { describe, expect, it } from 'vitest'
import { isOpenCodeGo, OCGO_PROVIDER, providerOfModelSelection } from './provider.ts'

describe('isOpenCodeGo', () => {
  it('accepts the exact provider', () => {
    expect(isOpenCodeGo(OCGO_PROVIDER)).toBe(true)
  })

  it('accepts the opencode-go/ model prefix', () => {
    expect(isOpenCodeGo('opencode-go/deepseek-v4-flash')).toBe(true)
  })

  it('rejects other providers and empty input', () => {
    expect(isOpenCodeGo('deepseek-official')).toBe(false)
    expect(isOpenCodeGo('deepseek')).toBe(false)
    expect(isOpenCodeGo(undefined)).toBe(false)
    expect(isOpenCodeGo('')).toBe(false)
  })

  it('does not treat a plain-prefixed unrelated provider as opencode-go', () => {
    expect(isOpenCodeGo('opencode-go-evil')).toBe(false)
  })
})

describe('providerOfModelSelection', () => {
  const selection = { provider: OCGO_PROVIDER, model: 'deepseek-flash' }

  it('reads the effective (next) selection', () => {
    expect(providerOfModelSelection({ lastUsed: null, next: selection })).toBe(OCGO_PROVIDER)
  })

  it('falls back to the last used selection when next is null', () => {
    // The host folds `next` to `lastUsed`, but a stale client row may carry
    // next: null with a usable lastUsed — reporting nothing is correct there.
    expect(providerOfModelSelection({ lastUsed: selection, next: null })).toBeUndefined()
  })

  it('returns undefined while the capability or selection is absent', () => {
    expect(providerOfModelSelection(undefined)).toBeUndefined()
    expect(providerOfModelSelection({ lastUsed: null, next: null })).toBeUndefined()
  })

  it('rejects an empty provider id', () => {
    expect(providerOfModelSelection({ lastUsed: null, next: { provider: '', model: 'm' } })).toBeUndefined()
  })

  it('drives isOpenCodeGo across a provider switch', () => {
    // The composed visibility rule the chip uses: projection value in, boolean out.
    const shown = (value: Parameters<typeof providerOfModelSelection>[0]): boolean =>
      isOpenCodeGo(providerOfModelSelection(value))
    expect(shown({ lastUsed: null, next: selection })).toBe(true)
    expect(shown({ lastUsed: null, next: { provider: 'deepseek', model: 'deepseek-v4-pro' } })).toBe(false)
    expect(shown(undefined)).toBe(false)
  })
})

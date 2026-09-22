/**
 * Unit tests for the configuration loader.
 * @module dsh-ocgo-usage/config.test
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_BASE_URL,
  DEFAULT_CACHE_TTL,
  DEFAULT_TIMEOUT_MS,
  ENV_BASE_URL,
  ENV_CACHE_TTL,
  ENV_COOKIE,
  ENV_TIMEOUT_MS,
  ENV_WORKSPACE_ID,
  loadConfig,
  maskSecret,
  maskedConfigView,
  normalizeCookie,
  writeConfigFile,
} from './config.ts'

const ENV_KEYS = [ENV_COOKIE, ENV_WORKSPACE_ID, ENV_BASE_URL, ENV_CACHE_TTL, ENV_TIMEOUT_MS, 'DSH_HOME']

/** Clear every env var the config reads, remembering the previous values. */
function clearEnv(): Record<string, string | undefined> {
  const saved: Record<string, string | undefined> = {}
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key]
    delete process.env[key]
  }
  return saved
}

function restoreEnv(saved: Record<string, string | undefined>): void {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
}

describe('normalizeCookie', () => {
  const SESSION = '__Host-console_session=st_3d031f22-676f-465f-a81c-ca6702e7c7c2'
  const AUTH = 'auth=Fe26.2**abc*def'

  it('passes through the full browser cookie header, dropping unrelated cookies', () => {
    const pasted = [
      SESSION,
      AUTH,
      '__stripe_mid=36ed3817-80bb-4e8c-8978-6e238410a961b6f74a',
      '__stripe_sid=a5266591-76ef-4a46-876e-8ae7d746301e48a72b',
    ].join(';')
    expect(normalizeCookie(pasted)).toBe(`${SESSION}; ${AUTH}`)
  })

  it('keeps the session cookie when it is the only one (the API accepts it alone)', () => {
    expect(normalizeCookie(SESSION)).toBe(SESSION)
  })

  it('keeps the legacy auth cookie alone so a stale paste still produces a clear 401', () => {
    expect(normalizeCookie(AUTH)).toBe(AUTH)
  })

  it('drops oc_locale (the JSON API is locale-independent)', () => {
    expect(normalizeCookie(`${SESSION}; oc_locale=zh`)).toBe(SESSION)
    expect(normalizeCookie(`oc_locale=zh; ${AUTH}`)).toBe(AUTH)
  })

  it('routes a bare paste by shape: st_… is the session, Fe26.2… is auth', () => {
    expect(normalizeCookie('st_3d031f22-676f-465f-a81c-ca6702e7c7c2')).toBe(SESSION)
    expect(normalizeCookie('Fe26.2**abc*def')).toBe(AUTH)
  })

  it('accepts the non-Host console_session alias', () => {
    expect(normalizeCookie('console_session=st_alias')).toBe('console_session=st_alias')
  })

  it('emits a stable order regardless of the paste order (regression)', () => {
    // The old code turned "oc_locale=zh; ...; auth=..." into "auth=oc_locale=zh".
    expect(normalizeCookie(`${AUTH}; ${SESSION}`)).toBe(`${SESSION}; ${AUTH}`)
    expect(normalizeCookie(`oc_locale=en; desktop_promo_dismissed=1; ${AUTH}`)).toBe(AUTH)
  })

  it('accepts comma-separated cookies (Set-Cookie style)', () => {
    expect(normalizeCookie(`oc_locale=zh, desktop_promo_dismissed=1, ${AUTH}`)).toBe(AUTH)
  })

  it('accepts quoted values', () => {
    expect(normalizeCookie('auth="Fe26.2*quoted"')).toBe('auth=Fe26.2*quoted')
    expect(normalizeCookie('__Host-console_session="st_quoted"')).toBe('__Host-console_session=st_quoted')
  })

  it('rejects input with no real session cookie (no fabricated cookie=)', () => {
    expect(normalizeCookie('oc_locale=zh')).toBeUndefined()
    expect(normalizeCookie('zh')).toBeUndefined()
    expect(normalizeCookie('desktop_promo_dismissed=1; auth=')).toBeUndefined()
    expect(normalizeCookie('__Host-console_session=')).toBeUndefined()
    expect(normalizeCookie('__stripe_mid=36ed3817')).toBeUndefined()
  })

  it('normalizes whitespace and rejects empty input', () => {
    expect(normalizeCookie(`  ${SESSION} ;  oc_locale=zh  `)).toBe(SESSION)
    expect(normalizeCookie('   ')).toBeUndefined()
    expect(normalizeCookie(undefined)).toBeUndefined()
  })
})

describe('loadConfig', () => {
  let savedEnv: Record<string, string | undefined>
  let tmp: string

  beforeEach(() => {
    savedEnv = clearEnv()
    tmp = mkdtempSync(join(tmpdir(), 'dsh-ocgo-usage-test-'))
    process.env.DSH_HOME = tmp
  })

  afterEach(() => {
    restoreEnv(savedEnv)
    rmSync(tmp, { recursive: true, force: true })
  })

  it('returns defaults when nothing is configured', () => {
    const cfg = loadConfig()
    expect(cfg.cookie).toBeUndefined()
    expect(cfg.workspaceID).toBeUndefined()
    expect(cfg.baseUrl).toBe(DEFAULT_BASE_URL)
    expect(cfg.cacheTTL).toBe(DEFAULT_CACHE_TTL)
    expect(cfg.timeoutMs).toBe(DEFAULT_TIMEOUT_MS)
  })

  it('reads env vars and normalizes the cookie', () => {
    process.env[ENV_COOKIE] = 'st_envhandle'
    process.env[ENV_WORKSPACE_ID] = 'wrk_env'
    process.env[ENV_BASE_URL] = 'https://example.com'
    process.env[ENV_CACHE_TTL] = '120'
    process.env[ENV_TIMEOUT_MS] = '5000'
    const cfg = loadConfig()
    expect(cfg.cookie).toBe('__Host-console_session=st_envhandle')
    expect(cfg.workspaceID).toBe('wrk_env')
    expect(cfg.baseUrl).toBe('https://example.com')
    expect(cfg.cacheTTL).toBe(120)
    expect(cfg.timeoutMs).toBe(5000)
  })

  it('env wins over the config file', () => {
    writeFileSync(join(tmp, 'ocgo-usage.json'), JSON.stringify({
      cookie: '__Host-console_session=st_file; auth=Fe26.2*file',
      workspaceID: 'wrk_file',
      cacheTTL: 9999,
    }))
    process.env[ENV_COOKIE] = '__Host-console_session=st_env'
    const cfg = loadConfig()
    expect(cfg.cookie).toBe('__Host-console_session=st_env')
    expect(cfg.workspaceID).toBe('wrk_file')
  })

  it('falls back to the config file and clamps cacheTTL', () => {
    writeFileSync(join(tmp, 'ocgo-usage.json'), JSON.stringify({
      cookie: 'Fe26.2*file',
      workspaceID: 'wrk_file',
      cacheTTL: 9999,
    }))
    const cfg = loadConfig()
    expect(cfg.cookie).toBe('auth=Fe26.2*file')
    expect(cfg.workspaceID).toBe('wrk_file')
    expect(cfg.cacheTTL).toBe(3600)
    expect(cfg.timeoutMs).toBe(DEFAULT_TIMEOUT_MS)
  })

  it('tolerates a broken config file', () => {
    writeFileSync(join(tmp, 'ocgo-usage.json'), '{not json')
    const cfg = loadConfig()
    expect(cfg.cookie).toBeUndefined()
    expect(cfg.baseUrl).toBe(DEFAULT_BASE_URL)
  })
})

describe('masked config view + write', () => {
  let savedEnv: Record<string, string | undefined>
  let tmp: string

  beforeEach(() => {
    savedEnv = clearEnv()
    tmp = mkdtempSync(join(tmpdir(), 'dsh-ocgo-usage-mask-'))
    process.env.DSH_HOME = tmp
  })

  afterEach(() => {
    restoreEnv(savedEnv)
    rmSync(tmp, { recursive: true, force: true })
  })

  it('masks the tail of a secret', () => {
    expect(maskSecret(undefined)).toEqual({ set: false, tail: '' })
    expect(maskSecret('abcd')).toEqual({ set: true, tail: 'abcd' })
    expect(maskSecret('Fe26.2*long-value-xyz1')).toEqual({ set: true, tail: 'xyz1' })
  })

  it('exposes only masked values in the view', () => {
    const cookie = '__Host-console_session=st_secret-cookie-9abc; auth=Fe26.2*legacy'
    const ws = 'wrk_01XXXXXXXXXXXXXXXXXXXX8q2w'
    process.env[ENV_COOKIE] = cookie
    process.env[ENV_WORKSPACE_ID] = ws
    const view = maskedConfigView()
    // The env cookie is normalized on load (stable order, unrelated names dropped).
    const normalized = '__Host-console_session=st_secret-cookie-9abc; auth=Fe26.2*legacy'
    expect(view.cookie).toEqual({ set: true, tail: normalized.slice(-4) })
    expect(view.workspaceID).toEqual({ set: true, tail: ws.slice(-4) })
    expect(JSON.stringify(view)).not.toContain('secret-cookie')
  })

  it('writes new values to the config file and normalizes the cookie', () => {
    const view = writeConfigFile({ cookie: 'st_newhandlexyz', workspaceID: 'wrk_new' })
    // The written cookie is normalized to "__Host-console_session=st_newhandlexyz";
    // its tail is the whole header's last 4 chars.
    expect(view.cookie).toEqual({
      set: true,
      tail: '__Host-console_session=st_newhandlexyz'.slice(-4),
    })
    expect(view.workspaceID).toEqual({ set: true, tail: 'wrk_new'.slice(-4) })
    // loadConfig now reads the written file (normalized cookie).
    const cfg = loadConfig()
    expect(cfg.workspaceID).toBe('wrk_new')
    expect(cfg.cookie).toBe('__Host-console_session=st_newhandlexyz')
  })

  it('preserves other fields and clears a field with null', () => {
    writeFileSync(join(tmp, 'ocgo-usage.json'), JSON.stringify({
      cookie: '__Host-console_session=st_old',
      workspaceID: 'wrk_old',
      baseUrl: 'https://example.com',
      cacheTTL: 120,
    }))
    const view = writeConfigFile({ cookie: null, workspaceID: 'wrk_new2' })
    expect(view.cookie).toEqual({ set: false, tail: '' })
    expect(view.workspaceID).toEqual({ set: true, tail: 'wrk_new2'.slice(-4) })
    const raw = JSON.parse(readFileSync(join(tmp, 'ocgo-usage.json'), 'utf8'))
    expect(raw.baseUrl).toBe('https://example.com')
    expect(raw.cacheTTL).toBe(120)
    expect(raw.cookie).toBeUndefined()
  })

  it('keeps fields absent from the write untouched (no accidental clear)', () => {
    writeFileSync(join(tmp, 'ocgo-usage.json'), JSON.stringify({
      cookie: '__Host-console_session=st_keepme',
      workspaceID: 'wrk_keep',
    }))
    // Only workspaceID is present in the partial; cookie must survive.
    const view = writeConfigFile({ workspaceID: 'wrk_new3' })
    expect(view.workspaceID).toEqual({ set: true, tail: 'wrk_new3'.slice(-4) })
    expect(view.cookie).toEqual({ set: true, tail: 'st_keepme'.slice(-4) })
    const raw = JSON.parse(readFileSync(join(tmp, 'ocgo-usage.json'), 'utf8'))
    expect(raw.cookie).toBe('__Host-console_session=st_keepme')
    expect(raw.workspaceID).toBe('wrk_new3')
  })
})

/**
 * Unit tests for the usage page parser.
 * @module dsh-ocgo-usage/api.test
 */

import { describe, expect, it } from 'vitest'
import { fromSSRHTML, parseDurationToSec } from './api.ts'

/**
 * The embedded server payload exactly as the console emits it (Solid
 * `$R`-indexed object literals, minified keys). The `rollingUsage` key appears
 * twice: first a null declaration, then the populated object — the parser must
 * take the populated one.
 */
const EMBEDDED_PAYLOAD = `
<script>;0x0000;</script>
((self.$R = self.$R || {})["server-fn:3"] = [],
($R => $R[0] = {
    mine: !0,
    useBalance: !0,
    rollingUsage: null,
    weeklyUsage: null,
    monthlyUsage: null
})($R["server-fn:3"]));
$R[28]($R[18],$R[31]={mine:!0,useBalance:!0,allowTraining:!1,region:$R[32]=["us","eu","sg","cn"],rollingUsage:$R[33]={status:"ok",resetInSec:13664,usagePercent:11.4,usage:137231893,limit:1200000000},weeklyUsage:$R[34]={status:"ok",resetInSec:232476,usagePercent:65.9,usage:1978004869,limit:3000000000},monthlyUsage:$R[35]={status:"ok",resetInSec:1993562,usagePercent:42,usage:2522359079,limit:6000000000}});
`

/** One rendered usage-item block in the zh UI, wrapping numbers in comments. */
function renderedItem(label: string, value: string, reset: string): string {
  return `<div data-hk="0" data-slot="usage-item"><div data-slot="usage-header">`
    + `<span data-slot="usage-label">${label}</span>`
    + `<span data-slot="usage-value"><!--$-->${value}<!--/-->%</span></div>`
    + `<div data-slot="progress" role="progressbar" aria-valuenow="${value}">`
    + `<div data-slot="progress-bar" style="width:${value}%"></div></div>`
    + `<span data-slot="reset-time"><!--$-->重置于<!--/--> <!--$-->${reset}<!--/--></span></div>`
}

/** The rendered markup half of the console page (zh locale). */
const RENDERED_PAGE = [
  renderedItem('5 小时用量', '11.4', '3 小时 47 分钟'),
  renderedItem('每周用量', '65.9', '2 天 16 小时'),
  renderedItem('每月用量', '42', '23 天 1 小时'),
].join('\n')

describe('fromSSRHTML — embedded payload', () => {
  it('reads the authoritative usage values from the page payload', () => {
    const parsed = fromSSRHTML(EMBEDDED_PAYLOAD)
    expect(parsed.rolling).toEqual({
      kind: 'rolling',
      percent: 11.4,
      resetInSec: 13664,
      status: 'ok',
      usage: 137231893,
      limit: 1200000000,
    })
    expect(parsed.weekly).toEqual({
      kind: 'weekly',
      percent: 65.9,
      resetInSec: 232476,
      status: 'ok',
      usage: 1978004869,
      limit: 3000000000,
    })
    expect(parsed.monthly).toEqual({
      kind: 'monthly',
      percent: 42,
      resetInSec: 1993562,
      status: 'ok',
      usage: 2522359079,
      limit: 6000000000,
    })
  })

  it('skips the null declaration that precedes the populated payload', () => {
    // Regression: a naive "first match wins" scan reads the null declaration
    // and reports an empty page.
    const parsed = fromSSRHTML(EMBEDDED_PAYLOAD)
    expect(parsed.rolling?.percent).not.toBe(0)
    expect(parsed.weekly?.percent).toBe(65.9)
  })

  it('prefers the payload over the rendered (rounded) markup', () => {
    const parsed = fromSSRHTML(`${RENDERED_PAGE}\n${EMBEDDED_PAYLOAD}`)
    expect(parsed.rolling?.percent).toBe(11.4)
    expect(parsed.weekly?.percent).toBe(65.9)
    expect(parsed.monthly?.percent).toBe(42)
    // Exact seconds come from the payload, not the "23 天 1 小时" phrase.
    expect(parsed.monthly?.resetInSec).toBe(1993562)
  })

  it('marks an exhausted window rate-limited from the payload status', () => {
    const page = 'rollingUsage:{status:"rate-limited",resetInSec:10,usagePercent:100,usage:10,limit:10},'
    expect(fromSSRHTML(page).rolling).toEqual({
      kind: 'rolling',
      percent: 100,
      resetInSec: 10,
      status: 'rate-limited',
      usage: 10,
      limit: 10,
    })
  })

  it('tolerates a payload object with no usage/limit members', () => {
    const page = 'weeklyUsage:{status:"ok",resetInSec:60,usagePercent:3.5},'
    expect(fromSSRHTML(page).weekly).toEqual({
      kind: 'weekly',
      percent: 3.5,
      resetInSec: 60,
      status: 'ok',
    })
  })

  it('tolerates a payload member written as a JS-only shorthand', () => {
    // The console minifies to unquoted literals; the tolerant reader takes the
    // numeric member and leaves the unresolvable one out (the payload still
    // wins over the rendered markup, which is the authoritative order).
    const page = 'rollingUsage:{status:ok,usagePercent:1},' + renderedItem('5 小时用量', '7', '1 小时')
    const parsed = fromSSRHTML(page)
    expect(parsed.rolling?.percent).toBe(1)
    expect(parsed.rolling?.status).toBe('ok')
  })
})

describe('fromSSRHTML — rendered markup fallback', () => {
  it('parses the rendered zh page (comment-wrapped values, decimals)', () => {
    const parsed = fromSSRHTML(RENDERED_PAGE)
    expect(parsed.rolling).toEqual({
      kind: 'rolling',
      percent: 11.4,
      resetInSec: 3 * 3600 + 47 * 60,
      status: 'ok',
    })
    expect(parsed.weekly).toEqual({
      kind: 'weekly',
      percent: 65.9,
      resetInSec: 2 * 86400 + 16 * 3600,
      status: 'ok',
    })
    expect(parsed.monthly).toEqual({
      kind: 'monthly',
      percent: 42,
      resetInSec: 23 * 86400 + 3600,
      status: 'ok',
    })
  })

  it('parses an en-locale rendered page', () => {
    const page = [
      '<div data-slot="usage-item"><span data-slot="usage-label">Rolling Usage</span>',
      '<span data-slot="usage-value"><!--$-->23<!--/-->%</span>',
      '<span data-slot="reset-time"><!--$-->Resets in<!--/-->2 hours 29 minutes<!--/--></span></div>',
      '<div data-slot="usage-item"><span data-slot="usage-label">Weekly Usage</span>',
      '<span data-slot="usage-value"><!--$-->80<!--/-->%</span>',
      '<span data-slot="reset-time"><!--$-->Resets in<!--/-->4 days 6 hours<!--/--></span></div>',
      '<div data-slot="usage-item"><span data-slot="usage-label">Monthly Usage</span>',
      '<span data-slot="usage-value"><!--$-->100<!--/-->%</span>',
      '<span data-slot="reset-time"><!--$-->Resets in<!--/-->12 days<!--/--></span></div>',
    ].join('')
    const parsed = fromSSRHTML(page)
    expect(parsed.rolling?.percent).toBe(23)
    expect(parsed.rolling?.resetInSec).toBe(2 * 3600 + 29 * 60)
    expect(parsed.weekly?.percent).toBe(80)
    expect(parsed.monthly).toEqual({
      kind: 'monthly',
      percent: 100,
      resetInSec: 12 * 86400,
      status: 'rate-limited',
    })
  })

  it('accepts the English "滚动用量" alias for rolling', () => {
    expect(fromSSRHTML(renderedItem('滚动用量', '27', '3 小时 37 分钟')).rolling?.percent).toBe(27)
  })

  it('omits missing windows (new account / trial outside window)', () => {
    const parsed = fromSSRHTML(renderedItem('Weekly Usage', '10', '1 day'))
    expect(parsed.rolling).toBeUndefined()
    expect(parsed.weekly?.percent).toBe(10)
    expect(parsed.monthly).toBeUndefined()
  })

  it('returns an empty result for a login-redirect page', () => {
    const parsed = fromSSRHTML('<html><title>OpenAuth</title><body>Sign in to continue</body></html>')
    expect(parsed.rolling).toBeUndefined()
    expect(parsed.weekly).toBeUndefined()
    expect(parsed.monthly).toBeUndefined()
  })

  it('ignores unknown usage labels', () => {
    const parsed = fromSSRHTML(renderedItem('Something Else', '50', '1 hour'))
    expect(parsed.rolling).toBeUndefined()
    expect(parsed.weekly).toBeUndefined()
    expect(parsed.monthly).toBeUndefined()
  })

  it('clamps percent into [0, 100] keeping one decimal', () => {
    expect(fromSSRHTML(renderedItem('Monthly Usage', '150', '1 day')).monthly?.percent).toBe(100)
    expect(fromSSRHTML('monthlyUsage:{status:"ok",resetInSec:1,usagePercent:120.44},').monthly?.percent).toBe(100)
  })
})

describe('parseDurationToSec', () => {
  it.each([
    ['2 hours 29 minutes', 2 * 3600 + 29 * 60],
    ['45 minutes', 45 * 60],
    ['5 days', 5 * 86400],
    ['30 seconds', 30],
    ['1 week', 604800],
    ['1 month', 2592000],
    ['1 year', 31536000],
    ['2 小时 29 分钟', 2 * 3600 + 29 * 60],
    ['45 分钟', 45 * 60],
    ['5 天', 5 * 86400],
    ['30 秒', 30],
    ['1 周', 604800],
    ['1 个月', 2592000],
    ['1 年', 31536000],
    ['', 0],
    ['garbage text', 0],
  ])('parses %j → %i', (phrase, expected) => {
    expect(parseDurationToSec(phrase)).toBe(expected)
  })

  it('handles embedded SolidStart comment markers', () => {
    expect(parseDurationToSec('2<!--/--> hours 29<!--/--> minutes')).toBe(2 * 3600 + 29 * 60)
  })
})

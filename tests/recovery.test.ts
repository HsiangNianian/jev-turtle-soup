import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

// Run the actual pre-bundle script: mocks must not hide differences from shipped HTML.
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
const script = html.match(/<script>\s*([\s\S]*?)<\/script>/)![1]
function storage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
  }
}
function page(
  options: {
    storage?: ReturnType<typeof storage>
    booted?: boolean
    online?: boolean
    canReload?: boolean
    language?: string
  } = {},
) {
  const listeners = new Map<string, ((event: any) => void)[]>()
  const timers: (() => void)[] = []
  const elements = new Map<string, any>()
  const reload = vi.fn()
  const report = vi.fn(async (_url: string, _init: { body: string }) => undefined)
  const document = {
    documentElement: { lang: options.language ?? 'zh-CN' },
    querySelector: () => ({ getAttribute: () => 'test-build' }),
    getElementById: (id: string) => elements.get(id),
    createElement: () => ({
      style: {},
      setAttribute: vi.fn(),
      appendChild: vi.fn(),
      remove() {
        elements.delete(this.id)
      },
      id: '',
    }),
    body: {
      appendChild: (el: any) => {
        elements.set(el.id, el)
      },
    },
  }
  const navigator = { onLine: options.online ?? true, language: options.language ?? 'zh-CN' }
  const window = {
    __tsBooted: options.booted ?? false,
    __tsCanReload: () => options.canReload ?? true,
    addEventListener: (type: string, cb: (event: any) => void) =>
      listeners.set(type, [...(listeners.get(type) ?? []), cb]),
    setTimeout: (cb: () => void) => timers.push(cb),
  }
  const fire = (type: string, event: any = {}) => listeners.get(type)?.forEach((cb) => cb(event))
  runInNewContext(script, {
    window,
    document,
    navigator,
    URL,
    Date,
    location: {
      pathname: '/play',
      href: 'https://example.test/play',
      origin: 'https://example.test',
      reload,
    },
    sessionStorage: options.storage ?? storage(),
    localStorage: storage(),
    fetch: report,
  })
  return {
    reload,
    report,
    elements,
    window,
    navigator,
    fire,
    fail: (src: string) => fire('error', { target: { tagName: 'SCRIPT', src, type: 'module' } }),
    timeout: () => timers.forEach((cb) => cb()),
    preload: (
      message = 'Failed to fetch dynamically imported module: https://example.test/assets/Page-old.js',
    ) => fire('vite:preloadError', { payload: new Error(message) }),
  }
}

describe('pre-bundle asset recovery', () => {
  it.each([false, true])('ignores third-party script errors (booted=%s)', (booted) => {
    const p = page({ booted })
    p.fail('https://static.cloudflareinsights.com/beacon.min.js')
    expect(p.reload).not.toHaveBeenCalled()
    expect(p.report).not.toHaveBeenCalled()
  })
  it('reloads once for an actual entry failure and records the resource, without query secrets', () => {
    const p = page()
    p.fail('https://example.test/assets/index-old.js?token=private')
    p.fail('https://example.test/assets/index-old.js')
    expect(p.reload).toHaveBeenCalledOnce()
    expect(p.report).toHaveBeenCalledOnce()
    const report = JSON.parse(p.report.mock.calls[0]![1].body)
    expect(report.stack).toContain('/assets/index-old.js')
    expect(JSON.stringify(report)).not.toContain('private')
  })
  it('recovers lazy imports after boot but does not reload for application exceptions', () => {
    const p = page({ booted: true })
    p.preload('Cannot read properties of undefined')
    expect(p.reload).not.toHaveBeenCalled()
    p.preload()
    expect(p.reload).toHaveBeenCalledOnce()
  })
  it('keeps the reload guard after a successful boot and shows a manual fallback on repeated failure', () => {
    const shared = storage()
    const first = page({ storage: shared })
    first.fail('https://example.test/assets/index-old.js')
    const next = page({ storage: shared, booted: true })
    next.fire('turtle-soup:booted')
    next.preload()
    expect(next.reload).not.toHaveBeenCalled()
    expect(next.elements.size).toBe(1)
  })
  it('offers manual recovery when session storage is blocked, without reloading repeatedly', () => {
    const p = page({
      storage: {
        getItem() {
          throw new Error('blocked')
        },
        setItem() {
          throw new Error('blocked')
        },
      },
    })
    p.fail('https://example.test/assets/index-old.js')
    p.timeout()
    expect(p.reload).not.toHaveBeenCalled()
    expect(p.report).toHaveBeenCalledOnce()
    expect(p.elements.size).toBe(1)
  })
  it('lets slow startup finish without a reload or an error report', () => {
    const p = page()
    p.timeout()
    expect(p.reload).not.toHaveBeenCalled()
    expect(p.report).not.toHaveBeenCalled()
    expect(p.elements.size).toBe(1)
    p.window.__tsBooted = true
    p.fire('turtle-soup:booted')
    expect(p.elements.size).toBe(0)
  })
  it('waits for connectivity before retrying an asset failure', () => {
    const p = page({ online: false })
    p.preload()
    expect(p.reload).not.toHaveBeenCalled()
    expect(p.elements.size).toBe(1)
    p.navigator.onLine = true
    p.fire('online')
    expect(p.reload).toHaveBeenCalledOnce()
  })
  it('does not automatically discard unsaved progress', () => {
    const p = page({ booted: true, canReload: false })
    p.preload()
    expect(p.reload).not.toHaveBeenCalled()
    expect(p.elements.size).toBe(1)
  })
})

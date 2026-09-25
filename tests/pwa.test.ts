import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const root = new URL('../', import.meta.url)
const manifest = JSON.parse(readFileSync(new URL('public/manifest.webmanifest', root), 'utf8'))
const worker = readFileSync(new URL('pwa/sw.js', root), 'utf8')
  .replace('__PWA_BUILD__', JSON.stringify('test'))
  .replace('__PWA_URLS__', JSON.stringify(['/', '/assets/app-test.js', '/pwa/icon-192.png']))

function serviceWorker() {
  const handlers = new Map<string, (event: any) => void>()
  const addAll = vi.fn(async (_urls: string[]) => undefined)
  const cacheMatch = vi.fn(async (_url: string) => new Response('cached'))
  const names = vi.fn(async () => [
    'turtle-soup-shell:old',
    'turtle-soup-shell:test',
    'another-app',
  ])
  const remove = vi.fn(async (_name: string) => true)
  const fetch = vi.fn(async (_request: object) => new Response('network'))
  const caches = {
    open: vi.fn(async (_name: string) => ({ addAll, match: cacheMatch })),
    keys: names,
    delete: remove,
  }
  const self = {
    location: { origin: 'https://example.test' },
    addEventListener: (name: string, handler: (event: any) => void) => handlers.set(name, handler),
  }
  runInNewContext(worker, { self, caches, fetch, URL, Response, Promise })

  function dispatch(type: string, request?: object) {
    let result: Promise<unknown> | undefined
    handlers.get(type)!({
      request,
      waitUntil: (promise: Promise<unknown>) => (result = promise),
      respondWith: (promise: Promise<unknown>) => (result = promise),
    })
    return result
  }
  return { addAll, cacheMatch, caches, dispatch, fetch, remove }
}

describe('installable website', () => {
  it('declares a standalone start URL and real PNG icons, including a maskable one', () => {
    const html = readFileSync(new URL('index.html', root), 'utf8')
    expect(html).toContain('rel="manifest" href="/manifest.webmanifest"')
    expect(html).toContain('rel="apple-touch-icon"')
    expect(manifest).toMatchObject({ id: '/', start_url: '/', scope: '/', display: 'standalone' })
    for (const icon of manifest.icons as { src: string; sizes: string; purpose: string }[]) {
      const png = readFileSync(new URL(`public${icon.src}`, root))
      const [width, height] = icon.sizes.split('x').map(Number)
      expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
      expect(png.readUInt32BE(16)).toBe(width)
      expect(png.readUInt32BE(20)).toBe(height)
    }
    expect(manifest.icons.some((icon: { purpose: string }) => icon.purpose === 'maskable')).toBe(
      true,
    )
  })

  it('pre-caches the shell and built chunks without taking over an open page', async () => {
    const sw = serviceWorker()
    await sw.dispatch('install')
    expect(sw.caches.open).toHaveBeenCalledWith('turtle-soup-shell:test')
    expect(sw.addAll).toHaveBeenCalledWith(['/', '/assets/app-test.js', '/pwa/icon-192.png'])
    expect(worker).not.toContain('skipWaiting')
    expect(worker).not.toContain('clients.claim')
  })

  it('uses fresh HTML online and the cached shell only when navigation fails', async () => {
    const sw = serviceWorker()
    const request = { method: 'GET', mode: 'navigate', url: 'https://example.test/daily' }
    const online = (await sw.dispatch('fetch', request)) as Response
    expect(await online.text()).toBe('network')
    expect(sw.cacheMatch).not.toHaveBeenCalled()

    sw.fetch.mockRejectedValueOnce(new TypeError('offline'))
    const offline = (await sw.dispatch('fetch', request)) as Response
    expect(await offline.text()).toBe('cached')
    expect(sw.cacheMatch).toHaveBeenCalledWith('/')
  })

  it('never intercepts API, mutation, cross-origin, or arbitrary page resources', () => {
    const sw = serviceWorker()
    for (const request of [
      { method: 'GET', mode: 'cors', url: 'https://example.test/api/daily' },
      { method: 'POST', mode: 'cors', url: 'https://example.test/api/game/ask' },
      { method: 'GET', mode: 'cors', url: 'https://fonts.googleapis.com/css2' },
      { method: 'GET', mode: 'cors', url: 'https://example.test/og.png' },
    ]) {
      expect(sw.dispatch('fetch', request)).toBeUndefined()
    }
    expect(sw.cacheMatch).not.toHaveBeenCalled()
    expect(sw.fetch).not.toHaveBeenCalled()
  })

  it('serves only listed build assets from cache and removes only its obsolete caches', async () => {
    const sw = serviceWorker()
    const asset = (await sw.dispatch('fetch', {
      method: 'GET',
      mode: 'cors',
      url: 'https://example.test/assets/app-test.js',
    })) as Response
    expect(await asset.text()).toBe('cached')
    expect(sw.fetch).not.toHaveBeenCalled()
    await sw.dispatch('activate')
    expect(sw.remove).toHaveBeenCalledExactlyOnceWith('turtle-soup-shell:old')
  })
})

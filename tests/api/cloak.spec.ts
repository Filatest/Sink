import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetch, postJson } from '../utils'

describe.sequential('proxy link cloaking', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders cloaking iframe without leaking the target url', async () => {
    const payload = {
      url: 'https://target.example/',
      slug: 'cloak-source-test',
      cloaking: true,
      title: 'Cloaked page',
    }
    const createResponse = await postJson('/api/link/create', payload)
    expect(createResponse.status).toBe(201)

    const response = await fetch(`/${payload.slug}`)
    expect(response.status).toBe(200)

    const html = await response.text()
    expect(html).toContain(`src="/_cloak/${payload.slug}"`)
    expect(html).not.toContain(payload.url)
  })

  it('proxies cloaked html and rewrites common same-origin asset urls', async () => {
    const payload = {
      url: 'https://spa.example/',
      slug: 'cloak-proxy-test',
      cloaking: true,
    }
    const createResponse = await postJson('/api/link/create', payload)
    expect(createResponse.status).toBe(201)

    const fetchMock = vi.fn(async () => new Response(`<!DOCTYPE html>
<html>
<head>
  <script src="/assets/app.js"></script>
  <link href="assets/app.css" rel="stylesheet">
</head>
<body>
  <img src="./logo.png">
  <img src="https://cdn.example/logo.png">
</body>
</html>`, {
      headers: {
        'content-type': 'text/html',
        'content-security-policy': 'frame-ancestors none',
        'x-frame-options': 'DENY',
      },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const response = await fetch(`/_cloak/${payload.slug}`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-security-policy')).toBeNull()
    expect(response.headers.get('x-frame-options')).toBeNull()

    const html = await response.text()
    expect(fetchMock).toHaveBeenCalledWith('https://spa.example/', expect.any(Object))
    expect(html).toContain(`src="/_cloak/${payload.slug}/assets/app.js"`)
    expect(html).toContain(`href="/_cloak/${payload.slug}/assets/app.css"`)
    expect(html).toContain(`src="/_cloak/${payload.slug}/logo.png"`)
    expect(html).toContain('src="https://cdn.example/logo.png"')
  })

  it('proxies cloaked static assets by path', async () => {
    const payload = {
      url: 'https://spa-static.example/',
      slug: 'cloak-asset-test',
      cloaking: true,
    }
    const createResponse = await postJson('/api/link/create', payload)
    expect(createResponse.status).toBe(201)

    const fetchMock = vi.fn(async () => new Response('console.log("ok")', {
      headers: { 'content-type': 'application/javascript' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const response = await fetch(`/_cloak/${payload.slug}/assets/app.js`)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('console.log("ok")')
    expect(fetchMock).toHaveBeenCalledWith('https://spa-static.example/assets/app.js', expect.any(Object))
  })

  it('does not proxy non-cloaked links', async () => {
    const payload = {
      url: 'https://plain.example/',
      slug: 'cloak-reserved-test',
    }
    const createResponse = await postJson('/api/link/create', payload)
    expect(createResponse.status).toBe(201)

    const response = await fetch(`/_cloak/${payload.slug}`)
    expect(response.status).toBe(404)
  })
})

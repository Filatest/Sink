import type { H3Event } from 'h3'
import { LinkSchema } from '#shared/schemas/link'
import { withQuery } from 'ufo'

const slugValidator = LinkSchema.shape.slug
const BLOCKED_RESPONSE_HEADERS = [
  'content-encoding',
  'content-length',
  'content-security-policy',
  'content-security-policy-report-only',
  'x-frame-options',
]

function cleanProxyHeaders(headers: Headers): Headers {
  const cleaned = new Headers(headers)
  for (const header of BLOCKED_RESPONSE_HEADERS) {
    cleaned.delete(header)
  }
  return cleaned
}

function rewriteAssetUrl(value: string, targetUrl: string, proxyBase: string): string {
  const trimmed = value.trim()
  if (!trimmed || trimmed.startsWith('#'))
    return value

  try {
    const parsed = new URL(trimmed, targetUrl)
    const target = new URL(targetUrl)
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== target.origin)
      return value

    return `${proxyBase}${parsed.pathname}${parsed.search}${parsed.hash}`
  }
  catch {
    return value
  }
}

export function rewriteCloakedHtml(html: string, targetUrl: string, proxyBase: string): string {
  return html.replace(
    /\b(src|href|poster)=("([^"]*)"|'([^']*)')/gi,
    (match, attribute: string, quoted: string, doubleQuoted?: string, singleQuoted?: string) => {
      const value = doubleQuoted ?? singleQuoted ?? ''
      const quote = quoted.startsWith('"') ? '"' : '\''
      const rewritten = rewriteAssetUrl(value, targetUrl, proxyBase)
      return `${attribute}=${quote}${rewritten}${quote}`
    },
  )
}

function resolveProxyTarget(linkUrl: string, proxiedPath?: string): string {
  if (!proxiedPath)
    return linkUrl

  const target = new URL(linkUrl)
  target.pathname = `/${proxiedPath}`
  target.search = ''
  target.hash = ''
  return target.toString()
}

export async function handleCloakProxy(event: H3Event, proxiedPath?: string): Promise<Response> {
  const slug = getRouterParam(event, 'slug')
  const slugResult = slugValidator.safeParse(slug)
  if (!slug || !slugResult.success) {
    throw createError({ status: 400, statusText: 'Invalid slug format' })
  }

  const { linkCacheTtl, caseSensitive } = useRuntimeConfig(event)
  const lookupSlug = caseSensitive ? slug : slug.toLowerCase()
  let link = await getLink(event, lookupSlug, linkCacheTtl)
  if (!caseSensitive && !link && lookupSlug !== slug) {
    link = await getLink(event, slug, linkCacheTtl)
  }
  if (!link) {
    throw createError({ status: 404, statusText: 'Link not found' })
  }
  if (!link.cloaking) {
    throw createError({ status: 404, statusText: 'Link not found' })
  }

  const targetUrl = withQuery(resolveProxyTarget(link.url, proxiedPath), getQuery(event))
  const response = await fetch(targetUrl, {
    headers: {
      'User-Agent': getHeader(event, 'user-agent') || 'Sink Cloak Proxy',
      'Accept': getHeader(event, 'accept') || '*/*',
    },
    redirect: 'follow',
  })
  const headers = cleanProxyHeaders(response.headers)
  const contentType = headers.get('content-type') || ''

  if (contentType.includes('text/html')) {
    const html = await response.text()
    const proxyBase = `/_cloak/${encodeURIComponent(slug)}`
    const rewritten = rewriteCloakedHtml(html, targetUrl, proxyBase)
    headers.set('content-type', 'text/html; charset=utf-8')
    headers.set('cache-control', 'no-store, private')
    return new Response(rewritten, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

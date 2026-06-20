const MEDIA_PROXY_SCHEME = 'vfan-media'
const DOUBAN_IMAGE_REFERER = 'https://movie.douban.com/explore'

export interface ImageProxyOptions {
  baseUrl?: string
  headers?: Record<string, string>
}

export function isDoubanImageUrl(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith('doubanio.com')
  } catch {
    return false
  }
}

export function resolveImageUrl(url: string, options: ImageProxyOptions = {}): string {
  if (!url) {
    return url
  }

  const targetUrl = resolveTargetUrl(url, options.baseUrl)
  if (!targetUrl || !['http:', 'https:'].includes(targetUrl.protocol)) {
    return url
  }

  const proxyUrl = new URL(`${MEDIA_PROXY_SCHEME}://proxy/resource`)
  proxyUrl.searchParams.set('url', targetUrl.toString())
  proxyUrl.searchParams.set(
    'referer',
    isDoubanImageUrl(targetUrl.toString()) ? DOUBAN_IMAGE_REFERER : (options.baseUrl ?? targetUrl.origin),
  )

  if (options.headers && Object.keys(options.headers).length > 0) {
    proxyUrl.searchParams.set('headers', JSON.stringify(options.headers))
  }

  return proxyUrl.toString()
}

function resolveTargetUrl(url: string, baseUrl: string | undefined): URL | undefined {
  try {
    const normalizedUrl = url.startsWith('//') ? `https:${url}` : url
    return baseUrl ? new URL(normalizedUrl, baseUrl) : new URL(normalizedUrl)
  } catch {
    return undefined
  }
}

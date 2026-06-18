const MEDIA_PROXY_SCHEME = 'vfan-media'
const DOUBAN_IMAGE_REFERER = 'https://movie.douban.com/explore'

export function isDoubanImageUrl(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith('doubanio.com')
  } catch {
    return false
  }
}

export function resolveImageUrl(url: string): string {
  if (!url || !isDoubanImageUrl(url)) {
    return url
  }

  const targetUrl = new URL(url)
  const proxyUrl = new URL(`${MEDIA_PROXY_SCHEME}://proxy/resource`)
  proxyUrl.searchParams.set('url', targetUrl.toString())
  proxyUrl.searchParams.set('referer', DOUBAN_IMAGE_REFERER)
  return proxyUrl.toString()
}

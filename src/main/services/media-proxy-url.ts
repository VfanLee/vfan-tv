import type { MediaProxyRequest } from '@shared/types'

const MEDIA_PROXY_SCHEME = 'vfan-media'

export function createMediaProxyUrl(input: MediaProxyRequest): string {
  const targetUrl = new URL(input.url)

  if (!['http:', 'https:'].includes(targetUrl.protocol)) {
    throw new Error('只支持 http/https 媒体资源')
  }

  const proxyUrl = new URL(`${MEDIA_PROXY_SCHEME}://proxy/resource`)
  proxyUrl.searchParams.set('url', targetUrl.toString())

  if (input.referer) {
    proxyUrl.searchParams.set('referer', input.referer)
  }

  if (input.headers && Object.keys(input.headers).length > 0) {
    proxyUrl.searchParams.set('headers', JSON.stringify(input.headers))
  }

  return proxyUrl.toString()
}

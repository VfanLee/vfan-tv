import type { ReleaseDownloadRouteId } from '../types'

export interface ReleaseRoute {
  id: ReleaseDownloadRouteId
  label: string
  prefix: string
}

export const RELEASE_DOWNLOAD_ROUTES: readonly ReleaseRoute[] = [
  { id: 'direct', label: 'GitHub 直连', prefix: '' },
  { id: 'gh-proxy', label: 'Cloudflare (v4)', prefix: 'https://gh-proxy.org/' },
  { id: 'cloudflare-v4', label: 'Cloudflare (v4，优选)', prefix: 'https://v4.gh-proxy.org/' },
  { id: 'cloudflare-v46', label: 'Cloudflare (v4/v6)', prefix: 'https://v6.gh-proxy.org/' },
  { id: 'fastly-v4', label: 'Fastly (v4)', prefix: 'https://cdn.gh-proxy.org/' },
] as const

export function applyReleaseDownloadRoute(url: string, routeId: ReleaseDownloadRouteId): string {
  const route = RELEASE_DOWNLOAD_ROUTES.find((item) => item.id === routeId)
  if (!route) throw new Error('下载方式无效')
  if (!isGitHubReleaseAssetUrl(url)) throw new Error('安装包下载地址无效')
  return route.prefix ? `${route.prefix}${url}` : url
}

function isGitHubReleaseAssetUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 'github.com' && /\/releases\/download\//.test(url.pathname)
  } catch {
    return false
  }
}

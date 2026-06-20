export interface ReleaseRoute {
  label: string
  prefix: string
}

export const RELEASE_ROUTE_PREFIXES: readonly ReleaseRoute[] = [
  { label: '原始线路', prefix: '' },
  { label: 'gh-proxy', prefix: 'https://gh-proxy.org/' },
  { label: 'Cloudflare (v4)', prefix: 'https://v4.gh-proxy.org/' },
  { label: 'Cloudflare (v4/v6)', prefix: 'https://v6.gh-proxy.org/' },
  { label: 'Fastly (v4)', prefix: 'https://cdn.gh-proxy.org/' },
] as const

export function applyReleaseRoutePrefix(url: string, prefix: string): string {
  return prefix ? `${prefix}${url}` : url
}

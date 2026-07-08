import type { AppSettings, GitHubProxyRouteId } from '../types/settings'

export interface GitHubProxyRoute {
  id: GitHubProxyRouteId
  label: string
  prefix: string
}

export const CUSTOM_GITHUB_PROXY_ROUTE_ID = 'custom'
export const DEFAULT_GITHUB_PROXY_ROUTE_ID: GitHubProxyRouteId = 'gh-proxy'

export const GITHUB_PROXY_ROUTES: readonly GitHubProxyRoute[] = [
  { id: 'direct', label: 'GitHub 直连', prefix: '' },
  { id: 'gh-proxy', label: 'gh-proxy', prefix: 'https://gh-proxy.org/' },
  { id: 'cloudflare-v4', label: 'Cloudflare (v4)', prefix: 'https://v4.gh-proxy.org/' },
  { id: 'cloudflare-v46', label: 'Cloudflare (v4/v6)', prefix: 'https://v6.gh-proxy.org/' },
  { id: 'fastly-v4', label: 'Fastly (v4)', prefix: 'https://cdn.gh-proxy.org/' },
] as const

export const GITHUB_PROXY_TEST_URL = 'https://github.com/vfanlee/vfan-tv/archive/refs/heads/main.zip'

export function normalizeGitHubProxyPrefix(prefix: string): string {
  const trimmed = prefix.trim()
  if (!trimmed) return ''

  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`
}

export function getGitHubProxyPrefix(
  settings: Pick<AppSettings, 'githubProxyCustomPrefix' | 'githubProxyRoute'>,
): string {
  if (settings.githubProxyRoute === CUSTOM_GITHUB_PROXY_ROUTE_ID) {
    return normalizeGitHubProxyPrefix(settings.githubProxyCustomPrefix)
  }

  return GITHUB_PROXY_ROUTES.find((route) => route.id === settings.githubProxyRoute)?.prefix ?? ''
}

export function applyGitHubProxy(url: string, prefix: string): string {
  if (!prefix || !isGitHubUrl(url)) return url

  return `${prefix}${url}`
}

export function resolveGitHubUrl(
  url: string,
  settings: Pick<AppSettings, 'githubProxyCustomPrefix' | 'githubProxyRoute'>,
): string {
  return applyGitHubProxy(url, getGitHubProxyPrefix(settings))
}

export function isGitHubUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase()
    return (
      hostname === 'api.github.com' ||
      hostname === 'github.com' ||
      hostname.endsWith('.github.com') ||
      hostname === 'raw.githubusercontent.com'
    )
  } catch {
    return false
  }
}

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
  { id: 'gh-proxy', label: 'Cloudflare (v4)', prefix: 'https://gh-proxy.org/' },
  { id: 'cloudflare-v4', label: 'Cloudflare (v4，优选)', prefix: 'https://v4.gh-proxy.org/' },
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

  return (
    GITHUB_PROXY_ROUTES.find((route) => route.id === settings.githubProxyRoute)?.prefix ??
    GITHUB_PROXY_ROUTES.find((route) => route.id === DEFAULT_GITHUB_PROXY_ROUTE_ID)?.prefix ??
    ''
  )
}

export function applyGitHubProxy(url: string, prefix: string): string {
  if (!prefix || !isGitHubAccelerableUrl(url)) return url

  return `${prefix}${url}`
}

export function resolveGitHubUrl(
  url: string,
  settings: Pick<AppSettings, 'githubProxyCustomPrefix' | 'githubProxyRoute'>,
): string {
  return applyGitHubProxy(url, getGitHubProxyPrefix(settings))
}

/**
 * GitHub 加速服务仅支持一组明确的 GitHub 资源，不代理普通 GitHub 网页。
 * 仓库、个人主页和 Release 页面等链接保持直连，以便在浏览器中正常打开。
 */
export function isGitHubAccelerableUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    const hostname = parsed.hostname.toLowerCase()

    if (
      hostname === 'api.github.com' ||
      hostname === 'raw.githubusercontent.com' ||
      hostname === 'gist.githubusercontent.com'
    ) {
      return true
    }
    if (hostname !== 'github.com') return false

    return /\/[\w.-]+\/[\w.-]+\/(?:archive(?:\/|$)|blob\/|releases\/download\/)/.test(parsed.pathname)
  } catch {
    return false
  }
}

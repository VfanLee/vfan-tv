export type ThemeMode = 'light' | 'dark' | 'system'
export type GitHubProxyRouteId = 'direct' | 'gh-proxy' | 'cloudflare-v4' | 'cloudflare-v46' | 'fastly-v4' | 'custom'

export interface GitHubProxyTestResult {
  elapsedMs?: number
  errorMessage?: string
  routeId: GitHubProxyRouteId
  status: 'success' | 'error'
}

export interface AppSettings {
  githubProxyCustomPrefix: string
  githubProxyRoute: GitHubProxyRouteId
  theme: ThemeMode
  subscriptionUrl: string
  subscriptionUpdatedAt?: number
}

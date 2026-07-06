import {
  GITHUB_PROXY_ROUTES,
  GITHUB_PROXY_TEST_URL,
  applyGitHubProxy,
  normalizeGitHubProxyPrefix,
} from '@shared/constants'
import type { AppSettings } from '@shared/types'
import type { GitHubProxyRouteId, GitHubProxyTestResult } from '@shared/types'
import type { SettingsRepository } from '../repositories/settings.repository'

const GITHUB_PROXY_TEST_TIMEOUT_MS = 6_000
const GITHUB_PROXY_TEST_HEADERS = { 'User-Agent': 'vfan-tv-github-proxy-test' }

export class SettingsService {
  constructor(private readonly repository: SettingsRepository) {}

  get(): AppSettings {
    return this.repository.get()
  }

  update(input: Partial<AppSettings>): AppSettings {
    return this.repository.update(input)
  }

  async testGitHubProxy(routeId: GitHubProxyRouteId, customPrefix = ''): Promise<GitHubProxyTestResult> {
    const prefix =
      routeId === 'custom'
        ? normalizeGitHubProxyPrefix(customPrefix)
        : (GITHUB_PROXY_ROUTES.find((route) => route.id === routeId)?.prefix ?? '')

    if (routeId === 'custom' && !prefix) {
      return {
        errorMessage: '请输入自定义代理地址',
        routeId,
        status: 'error',
      }
    }

    const startedAt = performance.now()

    try {
      const response = await fetch(applyGitHubProxy(GITHUB_PROXY_TEST_URL, prefix), {
        headers: GITHUB_PROXY_TEST_HEADERS,
        method: 'HEAD',
        redirect: 'manual',
        signal: AbortSignal.timeout(GITHUB_PROXY_TEST_TIMEOUT_MS),
      })

      if (!response.ok && response.status !== 302) {
        return {
          errorMessage: `HTTP ${response.status}`,
          routeId,
          status: 'error',
        }
      }

      return {
        elapsedMs: Math.round(performance.now() - startedAt),
        routeId,
        status: 'success',
      }
    } catch (error) {
      return {
        errorMessage: error instanceof Error && error.name === 'TimeoutError' ? '超时' : '不可用',
        routeId,
        status: 'error',
      }
    }
  }
}

import { randomUUID } from 'crypto'
import { net, session, type Session } from 'electron'
import { networkInterfaces } from 'os'
import { networkSettingsSchema } from '@shared/schemas'
import type {
  NetworkProxyTestInput,
  NetworkProxyTestResult,
  NetworkRouteKey,
  NetworkRouteStatus,
  NetworkRouteSettings,
  NetworkSettings,
  NetworkStatus,
} from '@shared/types'
import { filterSensitiveRequestHeaders } from '../http/source-request-headers'

const PROXY_TEST_URL = 'https://example.com/'
const PROXY_TEST_TIMEOUT_MS = 8_000
const DEFAULT_NETWORK_SETTINGS: NetworkSettings = {
  profiles: [],
  iptv: { mode: 'direct' },
  epg: { mode: 'direct' },
}

export type ContentNetworkRoute =
  | NetworkRouteKey
  | 'subscriptionDirect'
  | 'subscriptionSystem'
  | 'linkPlaybackDirect'
  | 'linkPlaybackSystem'
  | 'vod'
  | 'vodPlayback'
  | 'douban'
  | 'radio'
  | 'update'

export interface ContentNetworkContext {
  readonly id: string
  readonly route: ContentNetworkRoute
  readonly session: Session
}

interface ManagedContext {
  context: ContentNetworkContext
  active: boolean
  references: number
}

export class ContentNetworkService {
  private activeSettings: NetworkSettings = DEFAULT_NETWORK_SETTINGS
  private readonly activeContexts = new Map<ContentNetworkRoute, ContentNetworkContext>()
  private readonly contexts = new Map<string, ManagedContext>()

  async initialize(settings: NetworkSettings): Promise<void> {
    const parsed = networkSettingsSchema.parse(settings)
    const contexts = await this.createInitialContexts(parsed)
    for (const context of contexts) this.activateContext(context)
    this.activeSettings = parsed
  }

  async applySettings(settings: NetworkSettings): Promise<NetworkSettings> {
    const parsed = networkSettingsSchema.parse(settings)
    const routes = await this.createRouteContexts(parsed)
    for (const context of routes) this.activateContext(context)
    this.activeSettings = parsed
    return parsed
  }

  getContext(route: ContentNetworkRoute): ContentNetworkContext {
    const context = this.activeContexts.get(route)
    if (!context) throw new Error(`${getRouteLabel(route)}网络尚未初始化`)
    return context
  }

  retainContext(context: ContentNetworkContext): void {
    const managed = this.contexts.get(context.id)
    if (!managed) throw new Error('网络上下文已失效')
    managed.references += 1
  }

  releaseContext(context: ContentNetworkContext): void {
    const managed = this.contexts.get(context.id)
    if (!managed) return
    managed.references = Math.max(0, managed.references - 1)
    void this.disposeIfUnused(context)
  }

  async withContext<T>(
    route: ContentNetworkRoute,
    callback: (context: ContentNetworkContext) => Promise<T>,
  ): Promise<T> {
    const context = this.getContext(route)
    this.retainContext(context)
    try {
      return await callback(context)
    } finally {
      this.releaseContext(context)
    }
  }

  withIptvContext<T>(callback: (context: ContentNetworkContext) => Promise<T>): Promise<T> {
    return this.withContext('iptv', callback)
  }

  withDoubanContext<T>(callback: (context: ContentNetworkContext) => Promise<T>): Promise<T> {
    return this.withContext('douban', callback)
  }

  withVodContext<T>(callback: (context: ContentNetworkContext) => Promise<T>): Promise<T> {
    return this.withContext('vod', callback)
  }

  withVodPlaybackContext<T>(callback: (context: ContentNetworkContext) => Promise<T>): Promise<T> {
    return this.withContext('vodPlayback', callback)
  }

  withRadioContext<T>(callback: (context: ContentNetworkContext) => Promise<T>): Promise<T> {
    return this.withContext('radio', callback)
  }

  withUpdateContext<T>(callback: (context: ContentNetworkContext) => Promise<T>): Promise<T> {
    return this.withContext('update', callback)
  }

  fetch(url: string, init: RequestInit | undefined, context: ContentNetworkContext): Promise<Response> {
    if (!this.contexts.has(context.id)) throw new Error('网络上下文已失效')
    return context.session.fetch(url, init)
  }

  async fetchWithRedirects(
    url: string,
    init: RequestInit | undefined,
    context: ContentNetworkContext,
    headerOriginUrl = url,
    maxRedirects = 5,
  ): Promise<Response> {
    let currentUrl = url
    const baseHeaders = Object.fromEntries(new Headers(init?.headers).entries())
    for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
      const response = await this.fetch(
        currentUrl,
        {
          ...init,
          headers: filterSensitiveRequestHeaders(headerOriginUrl, currentUrl, baseHeaders),
          redirect: 'manual',
        },
        context,
      )
      if (response.status < 300 || response.status >= 400) return response
      const location = response.headers.get('location')
      if (!location) return response
      await response.body?.cancel().catch(() => undefined)
      currentUrl = new URL(location, currentUrl).toString()
    }
    throw new Error('上游重定向次数过多')
  }

  async getStatus(): Promise<NetworkStatus> {
    const families = new Set<'ipv4' | 'ipv6'>()
    for (const values of Object.values(networkInterfaces())) {
      for (const item of values ?? []) {
        if (item.internal) continue
        if (item.family === 'IPv4') families.add('ipv4')
        if (item.family === 'IPv6') families.add('ipv6')
      }
    }
    return {
      online: net.isOnline(),
      ipFamilies: [...families],
      systemProxyStatus: await this.resolveSystemProxyStatus(),
      routes: {
        iptv: toRouteStatus(this.activeSettings.iptv, this.activeSettings),
        epg: toRouteStatus(this.activeSettings.epg, this.activeSettings),
      },
    }
  }

  /** 检测操作系统代理当前是否为测试地址解析出代理路由 */
  private async resolveSystemProxyStatus(): Promise<NetworkStatus['systemProxyStatus']> {
    const context = this.activeContexts.get('subscriptionSystem')
    if (!context) return 'unknown'
    try {
      const directives = (await context.session.resolveProxy(PROXY_TEST_URL))
        .split(';')
        .map((directive) => directive.trim())
        .filter(Boolean)
      if (directives.length === 0) return 'unknown'
      return directives.some((directive) => !/^DIRECT(?:\s|$)/i.test(directive)) ? 'enabled' : 'disabled'
    } catch {
      return 'unknown'
    }
  }

  async test(input: NetworkProxyTestInput): Promise<NetworkProxyTestResult> {
    const parsed = networkSettingsSchema.parse(input.settings)
    const context = await this.createTemporaryContext(input.route, parsed[input.route], parsed)
    const startedAt = performance.now()
    try {
      const response = await this.fetch(
        PROXY_TEST_URL,
        { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(PROXY_TEST_TIMEOUT_MS) },
        context,
      )
      await response.body?.cancel()
      if (response.status < 200 || response.status >= 400) {
        return { status: 'error', errorMessage: `测试地址返回 HTTP ${response.status}` }
      }
      return {
        status: 'success',
        elapsedMs: Math.max(1, Math.round(performance.now() - startedAt)),
        route: await context.session.resolveProxy(PROXY_TEST_URL),
      }
    } catch (error) {
      return { status: 'error', errorMessage: toPublicNetworkError(error) }
    } finally {
      await this.discard(context)
    }
  }

  async clearCache(): Promise<void> {
    await Promise.all(
      [...new Set([...this.contexts.values()].map(({ context }) => context.session))].map((value) =>
        value.clearCache().catch(() => undefined),
      ),
    )
  }

  getRouteDescription(route: ContentNetworkRoute): string {
    if (route === 'update' || route === 'subscriptionSystem' || route === 'linkPlaybackSystem') return '跟随系统'
    if (
      route === 'subscriptionDirect' ||
      route === 'linkPlaybackDirect' ||
      route === 'vod' ||
      route === 'vodPlayback' ||
      route === 'douban' ||
      route === 'radio'
    )
      return '固定直连'
    const settings = this.activeSettings[route]
    if (settings.mode !== 'custom') return settings.mode === 'direct' ? '直连' : '跟随系统'
    const profile = this.activeSettings.profiles.find((item) => item.id === settings.activeProfileId)
    return profile ? `自定义代理（${profile.name}）` : '自定义代理'
  }

  private activateContext(context: ContentNetworkContext): void {
    const managed = this.contexts.get(context.id)
    if (!managed) throw new Error('网络上下文无效')
    const previous = this.activeContexts.get(context.route)
    if (previous && previous !== context) {
      const previousManaged = this.contexts.get(previous.id)
      if (previousManaged) previousManaged.active = false
    }
    managed.active = true
    this.activeContexts.set(context.route, context)
    if (previous && previous !== context) void this.disposeIfUnused(previous)
  }

  private createContext(
    route: NetworkRouteKey,
    routeSettings: NetworkRouteSettings,
    settings: NetworkSettings,
  ): Promise<ContentNetworkContext> {
    return this.createTemporaryContext(route, routeSettings, settings)
  }

  private async createRouteContexts(settings: NetworkSettings): Promise<ContentNetworkContext[]> {
    const contexts: ContentNetworkContext[] = []
    try {
      for (const route of ['iptv', 'epg'] as const) {
        contexts.push(await this.createContext(route, settings[route], settings))
      }
      return contexts
    } catch (error) {
      await Promise.all(contexts.map((context) => this.discard(context)))
      throw error
    }
  }

  private async createInitialContexts(settings: NetworkSettings): Promise<ContentNetworkContext[]> {
    const contexts = await this.createRouteContexts(settings)
    try {
      contexts.push(await this.createFixedDirectContext('vod'))
      contexts.push(await this.createFixedDirectContext('vodPlayback'))
      contexts.push(await this.createFixedDirectContext('douban'))
      contexts.push(await this.createFixedDirectContext('radio'))
      contexts.push(await this.createLinkPlaybackContext('linkPlaybackDirect', 'direct'))
      contexts.push(await this.createLinkPlaybackContext('linkPlaybackSystem', 'system'))
      contexts.push(await this.createSubscriptionContext('subscriptionDirect', 'direct'))
      contexts.push(await this.createSubscriptionContext('subscriptionSystem', 'system'))
      contexts.push(await this.createUpdateContext())
      return contexts
    } catch (error) {
      await Promise.all(contexts.map((context) => this.discard(context)))
      throw error
    }
  }

  private async createFixedDirectContext(
    route: 'vod' | 'vodPlayback' | 'douban' | 'radio',
  ): Promise<ContentNetworkContext> {
    const context: ContentNetworkContext = {
      id: randomUUID(),
      route,
      session: session.fromPartition(`vfan-${route}-${randomUUID()}`, { cache: true }),
    }
    await context.session.setProxy({ mode: 'direct' })
    this.contexts.set(context.id, { context, active: false, references: 0 })
    return context
  }

  private async createUpdateContext(): Promise<ContentNetworkContext> {
    const context: ContentNetworkContext = {
      id: randomUUID(),
      route: 'update',
      session: session.fromPartition('electron-updater', { cache: false }),
    }
    await context.session.setProxy({ mode: 'system' })
    this.contexts.set(context.id, { context, active: false, references: 0 })
    return context
  }

  private async createSubscriptionContext(
    route: 'subscriptionDirect' | 'subscriptionSystem',
    mode: 'direct' | 'system',
  ): Promise<ContentNetworkContext> {
    const context: ContentNetworkContext = {
      id: randomUUID(),
      route,
      session: session.fromPartition(`vfan-${route}-${randomUUID()}`, { cache: false }),
    }
    await context.session.setProxy({ mode })
    this.contexts.set(context.id, { context, active: false, references: 0 })
    return context
  }

  private async createLinkPlaybackContext(
    route: 'linkPlaybackDirect' | 'linkPlaybackSystem',
    mode: 'direct' | 'system',
  ): Promise<ContentNetworkContext> {
    const context: ContentNetworkContext = {
      id: randomUUID(),
      route,
      session: session.fromPartition(`vfan-${route}-${randomUUID()}`, { cache: true }),
    }
    await context.session.setProxy({ mode })
    this.contexts.set(context.id, { context, active: false, references: 0 })
    return context
  }

  private async createTemporaryContext(
    route: NetworkRouteKey,
    routeSettings: NetworkRouteSettings,
    settings: NetworkSettings,
  ): Promise<ContentNetworkContext> {
    const context: ContentNetworkContext = {
      id: randomUUID(),
      route,
      session: session.fromPartition(`vfan-${route}-${randomUUID()}`, { cache: true }),
    }
    await context.session.setProxy(toProxyConfig(routeSettings, settings))
    this.contexts.set(context.id, { context, active: false, references: 0 })
    return context
  }

  private async discard(context: ContentNetworkContext): Promise<void> {
    if (this.activeContexts.get(context.route) === context) return
    const managed = this.contexts.get(context.id)
    if (managed) managed.active = false
    await this.disposeIfUnused(context)
  }

  private async disposeIfUnused(context: ContentNetworkContext): Promise<void> {
    const managed = this.contexts.get(context.id)
    if (!managed || managed.active || managed.references > 0) return
    this.contexts.delete(context.id)
    await context.session.clearCache().catch(() => undefined)
    await context.session.clearStorageData().catch(() => undefined)
  }
}

function toProxyConfig(route: NetworkRouteSettings, settings: NetworkSettings): Electron.ProxyConfig {
  if (route.mode === 'direct') return { mode: 'direct' }
  if (route.mode === 'system') return { mode: 'system' }
  const profile = settings.profiles.find((item) => item.id === route.activeProfileId)
  if (!profile) throw new Error('请选择有效的代理配置')
  return {
    mode: 'fixed_servers',
    proxyRules: `${profile.protocol}://${formatProxyHost(profile.host)}:${profile.port}`,
    proxyBypassRules: '<local>;127.0.0.1;localhost',
  }
}

function toRouteStatus(route: NetworkRouteSettings, settings: NetworkSettings): NetworkRouteStatus {
  const activeProfile = settings.profiles.find((profile) => profile.id === route.activeProfileId)
  return {
    ...route,
    activeProfileName: route.mode === 'custom' ? activeProfile?.name : undefined,
  }
}

function formatProxyHost(host: string): string {
  const normalized = host.replace(/^\[|\]$/g, '')
  return normalized.includes(':') ? `[${normalized}]` : normalized
}

function getRouteLabel(route: ContentNetworkRoute): string {
  if (route === 'iptv') return 'IPTV 直播'
  if (route === 'epg') return 'EPG 节目单'
  if (route === 'subscriptionDirect') return '订阅直连更新'
  if (route === 'subscriptionSystem') return '订阅系统代理更新'
  if (route === 'linkPlaybackDirect') return 'URL 解析播放直连'
  if (route === 'linkPlaybackSystem') return 'URL 解析播放系统代理'
  if (route === 'vod') return '点播服务'
  if (route === 'vodPlayback') return '点播播放'
  if (route === 'douban') return '豆瓣服务'
  if (route === 'radio') return '蜻蜓电台'
  return '应用更新'
}

function toPublicNetworkError(error: unknown): string {
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) return '连接超时'
  return '无法通过该网络配置建立连接'
}

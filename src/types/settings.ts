export type SettingsSectionId = 'appearance' | 'subscriptions' | 'vod-sources' | 'iptv' | 'data-management' | 'about'

export type ThemeMode = 'light' | 'dark' | 'system'
export type NetworkRouteMode = 'direct' | 'system' | 'custom'
export type NetworkProxyProtocol = 'http' | 'https' | 'socks5'
export type NetworkRouteKey = 'iptv'

export interface NetworkProxyProfile {
  id: string
  name: string
  protocol: NetworkProxyProtocol
  host: string
  port: number
}

export interface NetworkRouteSettings {
  mode: NetworkRouteMode
  activeProfileId?: string
}

export interface NetworkSettings {
  profiles: NetworkProxyProfile[]
  iptv: NetworkRouteSettings
}

export interface NetworkRouteStatus extends NetworkRouteSettings {
  activeProfileName?: string
}

export interface NetworkStatus {
  online: boolean
  ipFamilies: Array<'ipv4' | 'ipv6'>
  systemProxyStatus: 'enabled' | 'disabled' | 'unknown'
  routes: Record<NetworkRouteKey, NetworkRouteStatus>
}

export interface NetworkProxyTestInput {
  route: NetworkRouteKey
  settings: NetworkSettings
}

export interface NetworkProxyTestResult {
  status: 'success' | 'error'
  elapsedMs?: number
  route?: string
  errorMessage?: string
}

export interface SubscriptionConfig {
  id: string
  url: string
  /** 最近一次成功同步时间，未同步过为空 */
  syncedAt?: number
}

export interface AppSettings {
  theme: ThemeMode
  subscriptions: SubscriptionConfig[]
  activeSubscriptionId?: string
  network: NetworkSettings
}

/** update_settings 可修改的字段；网络配置须走网络设置接口 */
export type AppSettingsPatch = Partial<Pick<AppSettings, 'theme' | 'subscriptions'>> & {
  activeSubscriptionId?: string | null
}

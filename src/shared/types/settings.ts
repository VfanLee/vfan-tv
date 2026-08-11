export type ThemeMode = 'light' | 'dark' | 'system'
export type NetworkRouteMode = 'direct' | 'system' | 'custom'
export type NetworkProxyProtocol = 'http' | 'https' | 'socks5'
export type NetworkRouteKey = 'iptv' | 'epg'

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
  epg: NetworkRouteSettings
}

export interface NetworkRouteStatus extends NetworkRouteSettings {
  activeProfileName?: string
}

export interface NetworkStatus {
  online: boolean
  ipFamilies: Array<'ipv4' | 'ipv6'>
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
}

export interface AppSettings {
  theme: ThemeMode
  subscriptions: SubscriptionConfig[]
  activeSubscriptionId?: string
  iptvEpg: import('./iptv').IptvEpgSettings
  network: NetworkSettings
}

import type { NetworkProxyProfile } from '@/types'

/** 格式化配置地址 */
export function formatProfileAddress(profile: NetworkProxyProfile): string {
  const host = profile.host.includes(':') && !profile.host.startsWith('[') ? `[${profile.host}]` : profile.host
  return `${host}:${profile.port}`
}

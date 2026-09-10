import type { NetworkRouteKey } from '@/types'

/** 支持单独配置网络访问策略的业务路由 */
export const ROUTES: Array<{
  key: NetworkRouteKey
  title: string
  description: string
}> = [
  {
    key: 'iptv',
    title: 'IPTV 直播网络',
    description: 'IPTV 目录、台标、线路探测、直播墙预览、直播清单和媒体分片。',
  },
]

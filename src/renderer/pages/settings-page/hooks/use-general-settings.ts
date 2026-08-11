import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { SubscriptionConfig, SubscriptionNetworkMode } from '@shared/types'
import { deleteSourceSubscription, getSettings, syncSourceSubscription, updateSettings } from '@renderer/platform/api'

interface GeneralSettingsOptions {
  apiAvailable: boolean
  refreshIptvSources: () => Promise<void>
  refreshVodSources: () => Promise<void>
}

export interface GeneralSettingsState {
  isSyncingSubscription: boolean
  syncingSubscriptionMode?: SubscriptionNetworkMode
  subscriptions: SubscriptionConfig[]
  activeSubscriptionId?: string
  resetSubscription: () => void
  addSubscription: (url: string) => Promise<void>
  deleteSubscription: (id: string) => Promise<void>
  selectSubscription: (id: string) => Promise<void>
  syncSubscription: (mode: SubscriptionNetworkMode) => Promise<void>
}

/** 加载订阅列表，并提供添加、选择、同步和删除操作 */
export function useGeneralSettings({
  apiAvailable,
  refreshIptvSources,
  refreshVodSources,
}: GeneralSettingsOptions): GeneralSettingsState {
  const [subscriptions, setSubscriptions] = useState<SubscriptionConfig[]>([])
  const [activeSubscriptionId, setActiveSubscriptionId] = useState<string>()
  const [syncingSubscriptionMode, setSyncingSubscriptionMode] = useState<SubscriptionNetworkMode>()
  const isSyncingSubscription = syncingSubscriptionMode !== undefined

  /** 加载订阅列表和当前订阅 */
  useEffect(() => {
    let active = true
    void getSettings().then((settings) => {
      if (!active) return
      setSubscriptions(settings?.subscriptions ?? [])
      setActiveSubscriptionId(settings?.activeSubscriptionId)
    })
    return () => {
      active = false
    }
  }, [])

  /** 使用指定网络模式同步当前订阅 */
  const syncSubscription = async (mode: SubscriptionNetworkMode): Promise<void> => {
    if (!apiAvailable || !activeSubscriptionId) return
    await syncSubscriptionById(activeSubscriptionId, mode)
  }

  /** 按订阅 ID 同步指定订阅 */
  const syncSubscriptionById = async (subscriptionId: string, mode: SubscriptionNetworkMode): Promise<void> => {
    if (!apiAvailable || !subscriptions.some((item) => item.id === subscriptionId)) return
    setSyncingSubscriptionMode(mode)
    try {
      const result = await syncSourceSubscription(subscriptionId, mode)
      await Promise.all([refreshVodSources(), refreshIptvSources()])
      toast.success(`订阅${getSubscriptionNetworkLabel(mode)}更新完成`, {
        description: `网络=${getSubscriptionNetworkDescription(mode)}；已更新 VOD ${result.vod.created + result.vod.updated} 个，IPTV ${result.iptv.created + result.iptv.updated} 个。`,
      })
    } catch (error) {
      toast.error(`订阅${getSubscriptionNetworkLabel(mode)}更新失败`, {
        description: `网络=${getSubscriptionNetworkDescription(mode)}；${error instanceof Error ? error.message : String(error)}`,
      })
    } finally {
      setSyncingSubscriptionMode(undefined)
    }
  }

  /** 添加订阅地址，立即同步并设为当前订阅 */
  const addSubscription = async (rawUrl: string): Promise<void> => {
    const url = rawUrl.trim()
    if (!apiAvailable || !url) return
    setSyncingSubscriptionMode('direct')
    try {
      const parsedUrl = new URL(url)
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error('订阅地址仅支持 HTTP 或 HTTPS')
      if (subscriptions.some((item) => item.url === url)) throw new Error('该订阅地址已存在')
      const item = { id: crypto.randomUUID(), url }
      const next = [...subscriptions, item]
      await updateSettings({ subscriptions: next, activeSubscriptionId: item.id })
      let result: Awaited<ReturnType<typeof syncSourceSubscription>>
      try {
        result = await syncSourceSubscription(item.id, 'direct')
      } catch (error) {
        await updateSettings({ subscriptions, activeSubscriptionId })
        throw error
      }
      setSubscriptions(next)
      setActiveSubscriptionId(item.id)
      await Promise.all([refreshVodSources(), refreshIptvSources()])
      toast.success('订阅源已添加', {
        description: `网络=固定直连；已更新 VOD ${result.vod.created + result.vod.updated} 个，IPTV ${result.iptv.created + result.iptv.updated} 个。`,
      })
    } catch (error) {
      toast.error('添加失败', {
        description: `网络=固定直连；${error instanceof Error ? error.message : '订阅地址无效'}`,
      })
    } finally {
      setSyncingSubscriptionMode(undefined)
    }
  }

  /** 将指定订阅设为当前订阅并同步内容源 */
  const selectSubscription = async (id: string): Promise<void> => {
    if (!apiAvailable || id === activeSubscriptionId || !subscriptions.some((item) => item.id === id)) return
    setSyncingSubscriptionMode('direct')
    try {
      const result = await syncSourceSubscription(id, 'direct')
      setActiveSubscriptionId(id)
      await Promise.all([refreshVodSources(), refreshIptvSources()])
      toast.success('订阅源已切换', {
        description: `网络=固定直连；已更新 VOD ${result.vod.created + result.vod.updated} 个，IPTV ${result.iptv.created + result.iptv.updated} 个。`,
      })
    } catch (error) {
      toast.error('切换失败', {
        description: `网络=固定直连；${error instanceof Error ? error.message : String(error)}`,
      })
    } finally {
      setSyncingSubscriptionMode(undefined)
    }
  }

  /** 删除指定订阅 */
  const deleteSubscription = async (id: string): Promise<void> => {
    if (!apiAvailable) return
    await deleteSourceSubscription(id)
    const next = subscriptions.filter((item) => item.id !== id)
    setSubscriptions(next)
    setActiveSubscriptionId((current) => (current === id ? next[0]?.id : current))
    await Promise.all([refreshVodSources(), refreshIptvSources()])
    toast.success('订阅源已删除')
  }

  return {
    isSyncingSubscription,
    syncingSubscriptionMode,
    subscriptions,
    activeSubscriptionId,
    resetSubscription: () => {
      setSubscriptions([])
      setActiveSubscriptionId(undefined)
    },
    addSubscription,
    deleteSubscription,
    selectSubscription,
    syncSubscription,
  }
}

/** 获取订阅网络标签 */
function getSubscriptionNetworkLabel(mode: SubscriptionNetworkMode): string {
  return mode === 'direct' ? '直连' : '系统代理'
}

/** 获取订阅网络说明 */
function getSubscriptionNetworkDescription(mode: SubscriptionNetworkMode): string {
  return mode === 'direct' ? '固定直连' : '跟随系统'
}

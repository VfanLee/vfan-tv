import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { SubscriptionConfig } from '@shared/types'
import { deleteSourceSubscription, getSettings, syncSourceSubscription, updateSettings } from '@renderer/platform/api'

interface GeneralSettingsOptions {
  apiAvailable: boolean
  refreshIptvSources: () => Promise<void>
  refreshVodSources: () => Promise<void>
}

export interface GeneralSettingsState {
  isSyncingSubscription: boolean
  subscriptions: SubscriptionConfig[]
  activeSubscriptionId?: string
  resetSubscription: () => void
  addSubscription: (url: string) => Promise<void>
  deleteSubscription: (id: string) => Promise<void>
  selectSubscription: (id: string) => Promise<void>
  syncSubscription: () => Promise<void>
}

export function useGeneralSettings({
  apiAvailable,
  refreshIptvSources,
  refreshVodSources,
}: GeneralSettingsOptions): GeneralSettingsState {
  const [subscriptions, setSubscriptions] = useState<SubscriptionConfig[]>([])
  const [activeSubscriptionId, setActiveSubscriptionId] = useState<string>()
  const [isSyncingSubscription, setIsSyncingSubscription] = useState(false)

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

  const syncSubscription = async (): Promise<void> => {
    if (!apiAvailable || !activeSubscriptionId) return
    await syncSubscriptionById(activeSubscriptionId)
  }

  const syncSubscriptionById = async (subscriptionId: string): Promise<void> => {
    if (!apiAvailable || !subscriptions.some((item) => item.id === subscriptionId)) return
    setIsSyncingSubscription(true)
    try {
      const result = await syncSourceSubscription(subscriptionId)
      await Promise.all([refreshVodSources(), refreshIptvSources()])
      toast.success('订阅同步完成', {
        description: `已更新订阅 VOD 源和 IPTV 源：VOD ${result.vod.created + result.vod.updated} 个，IPTV ${result.iptv.created + result.iptv.updated} 个。`,
      })
    } catch (error) {
      toast.error('订阅同步失败', { description: error instanceof Error ? error.message : String(error) })
    } finally {
      setIsSyncingSubscription(false)
    }
  }

  const addSubscription = async (rawUrl: string): Promise<void> => {
    const url = rawUrl.trim()
    if (!apiAvailable || !url) return
    setIsSyncingSubscription(true)
    try {
      const parsedUrl = new URL(url)
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error('订阅地址仅支持 HTTP 或 HTTPS')
      if (subscriptions.some((item) => item.url === url)) throw new Error('该订阅地址已存在')
      const item = { id: crypto.randomUUID(), url }
      const next = [...subscriptions, item]
      await updateSettings({ subscriptions: next, activeSubscriptionId: item.id })
      let result: Awaited<ReturnType<typeof syncSourceSubscription>>
      try {
        result = await syncSourceSubscription(item.id)
      } catch (error) {
        await updateSettings({ subscriptions, activeSubscriptionId })
        throw error
      }
      setSubscriptions(next)
      setActiveSubscriptionId(item.id)
      await Promise.all([refreshVodSources(), refreshIptvSources()])
      toast.success('订阅源已添加', {
        description: `已更新订阅 VOD 源和 IPTV 源：VOD ${result.vod.created + result.vod.updated} 个，IPTV ${result.iptv.created + result.iptv.updated} 个。`,
      })
    } catch (error) {
      toast.error('添加失败', { description: error instanceof Error ? error.message : '订阅地址无效' })
    } finally {
      setIsSyncingSubscription(false)
    }
  }

  const selectSubscription = async (id: string): Promise<void> => {
    if (!apiAvailable || id === activeSubscriptionId || !subscriptions.some((item) => item.id === id)) return
    setIsSyncingSubscription(true)
    try {
      const result = await syncSourceSubscription(id)
      setActiveSubscriptionId(id)
      await Promise.all([refreshVodSources(), refreshIptvSources()])
      toast.success('订阅源已切换', {
        description: `已更新订阅 VOD 源和 IPTV 源：VOD ${result.vod.created + result.vod.updated} 个，IPTV ${result.iptv.created + result.iptv.updated} 个。`,
      })
    } catch (error) {
      toast.error('切换失败', { description: error instanceof Error ? error.message : String(error) })
    } finally {
      setIsSyncingSubscription(false)
    }
  }

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

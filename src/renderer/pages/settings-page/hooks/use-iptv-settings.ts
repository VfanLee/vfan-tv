import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { IptvEpgSettings } from '@shared/types'
import { getSettings, updateSettings } from '@renderer/platform/api'

/** IPTV 节目单设置的默认值 */
const defaultSettings: IptvEpgSettings = { mode: 'source' }
/** 加载并保存 IPTV 节目单设置 */
export function useIptvSettings(apiAvailable: boolean): {
  epg: IptvEpgSettings
  isSavingEpg: boolean
  saveEpg: (epg: IptvEpgSettings) => Promise<void>
} {
  const [epg, setEpg] = useState<IptvEpgSettings>(defaultSettings)
  const [isSavingEpg, setIsSavingEpg] = useState(false)

  /** 加载 IPTV 节目单设置 */
  useEffect(() => {
    let active = true
    void getSettings().then((settings) => {
      if (active && settings) setEpg(settings.iptvEpg)
    })
    return () => {
      active = false
    }
  }, [apiAvailable])

  /** 保存 IPTV 节目单配置 */
  const saveEpg = async (next: IptvEpgSettings): Promise<void> => {
    if (!apiAvailable) return
    setIsSavingEpg(true)
    try {
      const settings = await updateSettings({ iptvEpg: next })
      setEpg(settings.iptvEpg)
      toast.success('节目单设置已保存')
    } catch (error) {
      toast.error('保存失败', { description: error instanceof Error ? error.message : String(error) })
    } finally {
      setIsSavingEpg(false)
    }
  }

  return {
    epg,
    isSavingEpg,
    saveEpg,
  }
}

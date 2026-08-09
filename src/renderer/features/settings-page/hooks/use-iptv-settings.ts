import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { IptvEpgSettings } from '@shared/types'
import { getSettings, testIptvEpg, updateSettings } from '@renderer/platform/api'

const defaultSettings: IptvEpgSettings = { mode: 'source', lastTest: { status: 'idle' } }
export function useIptvSettings(apiAvailable: boolean): {
  epg: IptvEpgSettings
  isSavingEpg: boolean
  isTesting: boolean
  saveEpg: (epg: IptvEpgSettings) => Promise<void>
  test: (epg: IptvEpgSettings) => Promise<void>
} {
  const [epg, setEpg] = useState<IptvEpgSettings>(defaultSettings)
  const [isSavingEpg, setIsSavingEpg] = useState(false)
  const [isTesting, setIsTesting] = useState(false)

  useEffect(() => {
    let active = true
    void getSettings().then((settings) => {
      if (active && settings) setEpg(settings.iptvEpg)
    })
    return () => {
      active = false
    }
  }, [apiAvailable])

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

  const test = async (next: IptvEpgSettings): Promise<void> => {
    if (!apiAvailable) return
    setIsTesting(true)
    setEpg({ ...next, lastTest: { status: 'testing' } })
    try {
      const result = await testIptvEpg(next)
      const tested = { ...next, lastTest: result }
      setEpg(tested)
      await updateSettings({ iptvEpg: tested })
      if (result.status === 'success') toast.success('EPG 连接可用', { description: result.actualSource })
      else toast.warning('EPG 测试未通过', { description: result.errorMessage })
    } finally {
      setIsTesting(false)
    }
  }

  return {
    epg,
    isSavingEpg,
    isTesting,
    saveEpg,
    test,
  }
}

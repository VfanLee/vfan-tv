import { create } from 'zustand'
import { clamp } from 'es-toolkit/math'
import { toast } from 'sonner'
import { isDesktopRuntime, listUiPreferences, setUiPreference } from '@/platform/tauri'
import type { RadioChannel, RadioMiniWindowPlaybackExit } from '@/types'

export type RadioPlaybackStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error'
export type RadioPlaybackCommand = 'none' | 'play' | 'pause' | 'retry' | 'stop'

interface RadioPlaybackState {
  channel?: RadioChannel
  command: RadioPlaybackCommand
  commandId: number
  errorMessage: string
  isMuted: boolean
  status: RadioPlaybackStatus
  volume: number
  pause: () => void
  pauseForExternalMedia: () => void
  playChannel: (channel: RadioChannel) => void
  resume: () => void
  retry: () => void
  restoreFromMiniWindow: (exit: RadioMiniWindowPlaybackExit) => void
  setChannelProgram: (title?: string) => void
  setError: (message: string) => void
  setMuted: (muted: boolean) => void
  setStatus: (status: RadioPlaybackStatus) => void
  setVolume: (volume: number) => void
  stop: () => void
  toggle: () => void
}

/** 电台播放命令留在内存，用户选择与音量由数据库保存 */
export const useRadioPlayerStore = create<RadioPlaybackState>()((set, get) => ({
  command: 'none',
  commandId: 0,
  errorMessage: '',
  isMuted: false,
  status: 'idle',
  volume: 0.8,
  pause: () => {
    const { channel, commandId, status } = get()
    if (!channel || !['loading', 'playing'].includes(status)) return
    set({ command: 'pause', commandId: commandId + 1, status: 'paused' })
  },
  pauseForExternalMedia: () => {
    const { channel, commandId, status } = get()
    if (!channel || !['loading', 'playing'].includes(status)) return
    set({ command: 'pause', commandId: commandId + 1, status: 'paused' })
  },
  playChannel: (channel) => {
    const current = get()
    if (current.channel?.id === channel.id && ['loading', 'playing'].includes(current.status)) return
    saveRadioPreference('channel', { id: channel.id, title: channel.title, coverUrl: channel.coverUrl ?? '' })
    set({
      channel,
      command: 'play',
      commandId: current.commandId + 1,
      errorMessage: '',
      status: 'loading',
    })
  },
  resume: () => {
    const current = get()
    if (!current.channel || ['loading', 'playing'].includes(current.status)) return
    set({
      command: 'play',
      commandId: current.commandId + 1,
      errorMessage: '',
      status: 'loading',
    })
  },
  retry: () => {
    const { channel, commandId } = get()
    if (!channel) return
    set({
      command: 'retry',
      commandId: commandId + 1,
      errorMessage: '',
      status: 'loading',
    })
  },
  restoreFromMiniWindow: (exit) => {
    saveRadioPreference('channel', {
      id: exit.channel.id,
      title: exit.channel.title,
      coverUrl: exit.channel.coverUrl ?? '',
    })
    saveRadioPreference('volume', clamp(exit.volume, 0, 1))
    saveRadioPreference('isMuted', exit.isMuted)
    set((state) => ({
      channel: exit.channel,
      command: exit.isPlaying ? 'play' : 'pause',
      commandId: state.commandId + 1,
      errorMessage: '',
      isMuted: exit.isMuted,
      status: exit.isPlaying ? 'loading' : 'paused',
      volume: clamp(exit.volume, 0, 1),
    }))
  },
  setChannelProgram: (title) =>
    set((state) =>
      state.channel
        ? {
            channel: {
              ...state.channel,
              nowPlayingTitle: title || state.channel.nowPlayingTitle,
            },
          }
        : state,
    ),
  setError: (message) => set({ errorMessage: message, status: 'error' }),
  setMuted: (muted) => {
    set({ isMuted: muted })
    saveRadioPreference('isMuted', muted)
  },
  setStatus: (status) => set({ status, ...(status !== 'error' ? { errorMessage: '' } : {}) }),
  setVolume: (volume) => {
    const next = clamp(volume, 0, 1)
    set({ volume: next })
    saveRadioPreference('volume', next)
  },
  stop: () => {
    const { channel, commandId } = get()
    if (!channel) return
    set({
      command: 'stop',
      commandId: commandId + 1,
      errorMessage: '',
      status: 'paused',
    })
  },
  toggle: () => {
    const current = get()
    if (!current.channel) return
    if (['loading', 'playing'].includes(current.status)) {
      current.pause()
      return
    }
    set({
      command: 'play',
      commandId: current.commandId + 1,
      errorMessage: '',
      status: 'loading',
    })
  },
}))

/** 按操作顺序保存电台偏好，失败保留当前播放并显示错误 */
let preferenceWrites: Promise<void> = Promise.resolve()

/** 保存用户偏好，不持久化节目缓存与播放命令 */
function saveRadioPreference(key: string, value: Parameters<typeof setUiPreference>[2]): void {
  if (!isDesktopRuntime()) return
  preferenceWrites = preferenceWrites
    .then(() => setUiPreference('radio', key, value))
    .catch((error: unknown) => {
      toast.error('保存电台偏好失败', { description: String(error) })
    })
}

/** 在首次渲染前恢复电台选择和音量，不自动播放 */
export async function initializeRadioPreferences(): Promise<void> {
  if (!isDesktopRuntime()) return
  const preferences = await listUiPreferences('radio')
  for (const { key, value } of preferences) {
    if (key === 'volume' && typeof value === 'number' && value >= 0 && value <= 1)
      useRadioPlayerStore.setState({ volume: value })
    if (key === 'isMuted' && typeof value === 'boolean') useRadioPlayerStore.setState({ isMuted: value })
    if (
      key === 'channel' &&
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      typeof value.id === 'number' &&
      typeof value.title === 'string'
    ) {
      useRadioPlayerStore.setState({
        channel: {
          id: value.id,
          title: value.title,
          coverUrl: typeof value.coverUrl === 'string' ? value.coverUrl : undefined,
        },
      })
    }
  }
}

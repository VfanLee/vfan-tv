import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { RADIO_PLAYER_STORAGE_KEY } from '@shared/constants'
import type { RadioChannel, RadioMiniWindowPlaybackExit } from '@shared/types'

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

export const useRadioPlayerStore = create<RadioPlaybackState>()(
  persist(
    (set, get) => ({
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
      restoreFromMiniWindow: (exit) =>
        set((state) => ({
          channel: exit.channel,
          command: exit.isPlaying ? 'play' : 'pause',
          commandId: state.commandId + 1,
          errorMessage: '',
          isMuted: exit.isMuted,
          status: exit.isPlaying ? 'loading' : 'paused',
          volume: Math.min(Math.max(exit.volume, 0), 1),
        })),
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
      setMuted: (muted) => set({ isMuted: muted }),
      setStatus: (status) => set({ status, ...(status !== 'error' ? { errorMessage: '' } : {}) }),
      setVolume: (volume) => set({ volume: Math.min(Math.max(volume, 0), 1) }),
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
    }),
    {
      name: RADIO_PLAYER_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: ({ channel, isMuted, volume }) => ({ channel, isMuted, volume }),
    },
  ),
)

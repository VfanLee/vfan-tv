import { useEffect } from 'react'
import { useRadioPlayerStore } from '@/stores'
import { RadioStreamEngine } from './radio-stream-engine'
import { useRadioProgramRefresh } from './use-radio-program-refresh'

/** 将全局电台状态连接到音频播放引擎 */
export function RadioPlaybackEngine(): React.JSX.Element {
  const channel = useRadioPlayerStore((state) => state.channel)
  const command = useRadioPlayerStore((state) => state.command)
  const commandId = useRadioPlayerStore((state) => state.commandId)
  const isMuted = useRadioPlayerStore((state) => state.isMuted)
  const volume = useRadioPlayerStore((state) => state.volume)

  useRadioProgramRefresh(channel?.id, (title) => {
    useRadioPlayerStore.getState().setChannelProgram(title)
  })

  /** 组件卸载时暂停电台播放 */
  useEffect(
    () => () => {
      useRadioPlayerStore.getState().pauseForExternalMedia()
    },
    [],
  )

  return (
    <RadioStreamEngine
      channel={channel}
      command={command}
      commandId={commandId}
      isMuted={isMuted}
      volume={volume}
      onError={(message) => useRadioPlayerStore.getState().setError(message)}
      onStatusChange={(status) => useRadioPlayerStore.getState().setStatus(status)}
    />
  )
}

export { RadioStreamEngine } from './radio-stream-engine'
// 保留公共播放器模块原有的节目刷新 hook 入口。
// eslint-disable-next-line react-refresh/only-export-components
export { useRadioProgramRefresh } from './use-radio-program-refresh'
export { RadioPlayerPanel } from './radio-player-panel'
export { RadioBottomPlayer } from './radio-bottom-player'
export { RadioPlaybackControlIcon, RadioBackground, RadioStationCover, RadioSignal } from './radio-player-visuals'

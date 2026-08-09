import { ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc'
import type { AppApi, SearchEvent } from '@shared/types'

// 媒体 API 除请求方法外还包含事件订阅；订阅必须返回清理函数以防页面切换后重复监听。
export function createMediaApi(): Pick<AppApi, 'vod' | 'iptv' | 'media'> {
  return {
    vod: {
      search: (keyword) => ipcRenderer.invoke(IPC_CHANNELS.vod.search, keyword),
      cancelSearch: (searchId) => ipcRenderer.invoke(IPC_CHANNELS.vod.cancelSearch, searchId),
      getCatalogPage: (input) => ipcRenderer.invoke(IPC_CHANNELS.vod.getCatalogPage, input),
      getDetail: (sourceId, vodId) => ipcRenderer.invoke(IPC_CHANNELS.vod.getDetail, sourceId, vodId),
      probeMedia: (input) => ipcRenderer.invoke(IPC_CHANNELS.vod.probeMedia, input),
      onSearchEvent: (listener) => subscribe<SearchEvent>(IPC_CHANNELS.vod.searchEvent, listener),
    },
    iptv: {
      getCatalog: (sourceId, force) => ipcRenderer.invoke(IPC_CHANNELS.iptv.getCatalog, sourceId, force),
      getPrograms: (sourceId, channelIds) => ipcRenderer.invoke(IPC_CHANNELS.iptv.getPrograms, sourceId, channelIds),
      getProgramSchedule: (sourceId, channelId, date) =>
        ipcRenderer.invoke(IPC_CHANNELS.iptv.getProgramSchedule, sourceId, channelId, date),
      getPlaybackTarget: (sourceId, channelId, streamId) =>
        ipcRenderer.invoke(IPC_CHANNELS.iptv.getPlaybackTarget, sourceId, channelId, streamId),
      testEpg: (settings) => ipcRenderer.invoke(IPC_CHANNELS.iptv.testEpg, settings),
    },
    media: {
      getPlaybackTarget: (input) => ipcRenderer.invoke(IPC_CHANNELS.media.getPlaybackTarget, input),
      getAssociatedAudioUrl: (mediaSessionId, url) =>
        ipcRenderer.invoke(IPC_CHANNELS.media.getAssociatedAudioUrl, mediaSessionId, url),
      getImageUrl: (sourceType, sourceId, url, baseUrl) =>
        ipcRenderer.invoke(IPC_CHANNELS.media.getImageUrl, sourceType, sourceId, url, baseUrl),
      getPlaybackSessionInfo: (mediaSessionId) =>
        ipcRenderer.invoke(IPC_CHANNELS.media.getPlaybackSessionInfo, mediaSessionId),
      retainPlaybackSession: (mediaSessionId) =>
        ipcRenderer.invoke(IPC_CHANNELS.media.retainPlaybackSession, mediaSessionId),
      releasePlaybackSession: (mediaSessionId) =>
        ipcRenderer.invoke(IPC_CHANNELS.media.releasePlaybackSession, mediaSessionId),
      reportPlaybackEvent: (event) => ipcRenderer.invoke(IPC_CHANNELS.media.reportPlaybackEvent, event),
    },
  }
}

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, payload: T): void => listener(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

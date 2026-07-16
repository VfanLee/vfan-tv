import { ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc'
import type { AppApi, SearchEvent } from '@shared/types'

export function createMediaApi(): Pick<AppApi, 'vod' | 'live' | 'media'> {
  return {
    vod: {
      search: (keyword) => ipcRenderer.invoke(IPC_CHANNELS.vod.search, keyword),
      cancelSearch: (searchId) => ipcRenderer.invoke(IPC_CHANNELS.vod.cancelSearch, searchId),
      probeMedia: (input) => ipcRenderer.invoke(IPC_CHANNELS.vod.probeMedia, input),
      onSearchEvent: (listener) => subscribe<SearchEvent>(IPC_CHANNELS.vod.searchEvent, listener),
    },
    live: { loadPlaylist: (url) => ipcRenderer.invoke(IPC_CHANNELS.live.loadPlaylist, url) },
    media: {
      getProxyBaseUrl: () => ipcRenderer.invoke(IPC_CHANNELS.media.getProxyBaseUrl),
      detectStreamType: (input) => ipcRenderer.invoke(IPC_CHANNELS.media.detectStreamType, input),
    },
  }
}

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, payload: T): void => listener(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

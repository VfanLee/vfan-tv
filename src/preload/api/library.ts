import { ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc'
import type { AppApi } from '@shared/types'

export function createLibraryApi(): Pick<AppApi, 'home' | 'recent' | 'favorites' | 'radio'> {
  return {
    home: {
      get: () => ipcRenderer.invoke(IPC_CHANNELS.home.get),
      getHot: (input) => ipcRenderer.invoke(IPC_CHANNELS.home.getHot, input),
    },
    recent: {
      list: (limit) => ipcRenderer.invoke(IPC_CHANNELS.recent.list, limit),
      upsert: (input) => ipcRenderer.invoke(IPC_CHANNELS.recent.upsert, input),
      remove: (title) => ipcRenderer.invoke(IPC_CHANNELS.recent.remove, title),
    },
    favorites: {
      list: () => ipcRenderer.invoke(IPC_CHANNELS.favorites.list),
      isFavorite: (sourceId, vodId) => ipcRenderer.invoke(IPC_CHANNELS.favorites.isFavorite, sourceId, vodId),
      add: (input) => ipcRenderer.invoke(IPC_CHANNELS.favorites.add, input),
      remove: (sourceId, vodId) => ipcRenderer.invoke(IPC_CHANNELS.favorites.remove, sourceId, vodId),
    },
    radio: {
      getCategories: () => ipcRenderer.invoke(IPC_CHANNELS.radio.getCategories),
      getCategoryChannels: (categoryId, page, pageSize) =>
        ipcRenderer.invoke(IPC_CHANNELS.radio.getCategoryChannels, categoryId, page, pageSize),
      getChannelDetail: (channelId) => ipcRenderer.invoke(IPC_CHANNELS.radio.getChannelDetail, channelId),
      searchChannels: (keyword, page, pageSize) =>
        ipcRenderer.invoke(IPC_CHANNELS.radio.searchChannels, keyword, page, pageSize),
      getLivePrograms: (channelIds) => ipcRenderer.invoke(IPC_CHANNELS.radio.getLivePrograms, channelIds),
      getRegions: () => ipcRenderer.invoke(IPC_CHANNELS.radio.getRegions),
      getBillboard: (categoryId, regionId) => ipcRenderer.invoke(IPC_CHANNELS.radio.getBillboard, categoryId, regionId),
    },
  }
}

import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { AppApi, SearchEvent } from '@shared/types'

const api: AppApi = {
  sources: {
    list: () => ipcRenderer.invoke('sources:list'),
    create: (input) => ipcRenderer.invoke('sources:create', input),
    update: (id, input) => ipcRenderer.invoke('sources:update', id, input),
    delete: (id) => ipcRenderer.invoke('sources:delete', id),
    previewImport: (payload) => ipcRenderer.invoke('sources:preview-import', payload),
    confirmImport: (payload) => ipcRenderer.invoke('sources:confirm-import', payload),
    importFromFile: () => ipcRenderer.invoke('sources:import-from-file'),
    exportToFile: () => ipcRenderer.invoke('sources:export-to-file'),
  },
  home: {
    get: () => ipcRenderer.invoke('home:get'),
    getHot: (input) => ipcRenderer.invoke('home:get-hot', input),
  },
  recent: {
    list: (limit) => ipcRenderer.invoke('recent:list', limit),
    upsert: (input) => ipcRenderer.invoke('recent:upsert', input),
    remove: (title) => ipcRenderer.invoke('recent:remove', title),
  },
  favorites: {
    list: () => ipcRenderer.invoke('favorites:list'),
    isFavorite: (sourceId, vodId) => ipcRenderer.invoke('favorites:is-favorite', sourceId, vodId),
    add: (input) => ipcRenderer.invoke('favorites:add', input),
    remove: (sourceId, vodId) => ipcRenderer.invoke('favorites:remove', sourceId, vodId),
  },
  vod: {
    search: (keyword) => ipcRenderer.invoke('vod:search', keyword),
    cancelSearch: (searchId) => ipcRenderer.invoke('vod:cancel-search', searchId),
    onSearchEvent: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: SearchEvent): void => listener(payload)
      ipcRenderer.on('vod:search-event', handler)
      return () => ipcRenderer.removeListener('vod:search-event', handler)
    },
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    update: (input) => ipcRenderer.invoke('settings:update', input),
  },
  updates: {
    getCurrentVersion: () => ipcRenderer.invoke('updates:get-current-version'),
    check: () => ipcRenderer.invoke('updates:check'),
  },
  window: {
    isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
  },
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  const target = window as Window &
    typeof globalThis & {
      electron: typeof electronAPI
      api: typeof api
    }
  target.electron = electronAPI
  target.api = api
}

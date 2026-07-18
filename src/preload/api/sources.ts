import { ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc'
import type { AppApi } from '@shared/types'

export function createSourcesApi(): Pick<AppApi, 'sources' | 'liveSources'> {
  return {
    sources: {
      list: () => ipcRenderer.invoke(IPC_CHANNELS.sources.list),
      create: (input) => ipcRenderer.invoke(IPC_CHANNELS.sources.create, input),
      update: (id, input) => ipcRenderer.invoke(IPC_CHANNELS.sources.update, id, input),
      switchBackup: (id, backupUrl) => ipcRenderer.invoke(IPC_CHANNELS.sources.switchBackup, id, backupUrl),
      reorder: (sourceIds) => ipcRenderer.invoke(IPC_CHANNELS.sources.reorder, sourceIds),
      delete: (id) => ipcRenderer.invoke(IPC_CHANNELS.sources.delete, id),
      clear: () => ipcRenderer.invoke(IPC_CHANNELS.sources.clear),
      previewImport: (payload) => ipcRenderer.invoke(IPC_CHANNELS.sources.previewImport, payload),
      confirmImport: (payload) => ipcRenderer.invoke(IPC_CHANNELS.sources.confirmImport, payload),
      importFromFile: () => ipcRenderer.invoke(IPC_CHANNELS.sources.importFromFile),
      exportToFile: () => ipcRenderer.invoke(IPC_CHANNELS.sources.exportToFile),
      syncSubscription: (url) => ipcRenderer.invoke(IPC_CHANNELS.sources.syncSubscription, url),
    },
    liveSources: {
      list: () => ipcRenderer.invoke(IPC_CHANNELS.liveSources.list),
      create: (input) => ipcRenderer.invoke(IPC_CHANNELS.liveSources.create, input),
      update: (id, input) => ipcRenderer.invoke(IPC_CHANNELS.liveSources.update, id, input),
      reorder: (sourceIds) => ipcRenderer.invoke(IPC_CHANNELS.liveSources.reorder, sourceIds),
      delete: (id) => ipcRenderer.invoke(IPC_CHANNELS.liveSources.delete, id),
      clear: () => ipcRenderer.invoke(IPC_CHANNELS.liveSources.clear),
      previewImport: (payload) => ipcRenderer.invoke(IPC_CHANNELS.liveSources.previewImport, payload),
      confirmImport: (payload) => ipcRenderer.invoke(IPC_CHANNELS.liveSources.confirmImport, payload),
      importFromFile: () => ipcRenderer.invoke(IPC_CHANNELS.liveSources.importFromFile),
      exportToFile: () => ipcRenderer.invoke(IPC_CHANNELS.liveSources.exportToFile),
    },
  }
}

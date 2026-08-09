import { ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc'
import type { AppApi } from '@shared/types'

export function createSourcesApi(): Pick<AppApi, 'sources' | 'iptvSources'> {
  return {
    sources: {
      list: () => ipcRenderer.invoke(IPC_CHANNELS.sources.list),
      create: (input) => ipcRenderer.invoke(IPC_CHANNELS.sources.create, input),
      update: (id, input) => ipcRenderer.invoke(IPC_CHANNELS.sources.update, id, input),
      switchBackup: (id, backupUrl) => ipcRenderer.invoke(IPC_CHANNELS.sources.switchBackup, id, backupUrl),
      testSpeed: (id) => ipcRenderer.invoke(IPC_CHANNELS.sources.testSpeed, id),
      reorder: (sourceIds) => ipcRenderer.invoke(IPC_CHANNELS.sources.reorder, sourceIds),
      delete: (id) => ipcRenderer.invoke(IPC_CHANNELS.sources.delete, id),
      clear: () => ipcRenderer.invoke(IPC_CHANNELS.sources.clear),
      previewImport: (payload) => ipcRenderer.invoke(IPC_CHANNELS.sources.previewImport, payload),
      confirmImport: (payload) => ipcRenderer.invoke(IPC_CHANNELS.sources.confirmImport, payload),
      importFromFile: () => ipcRenderer.invoke(IPC_CHANNELS.sources.importFromFile),
      exportToFile: () => ipcRenderer.invoke(IPC_CHANNELS.sources.exportToFile),
      syncSubscription: (subscriptionId) => ipcRenderer.invoke(IPC_CHANNELS.sources.syncSubscription, subscriptionId),
      deleteSubscription: (subscriptionId) =>
        ipcRenderer.invoke(IPC_CHANNELS.sources.deleteSubscription, subscriptionId),
    },
    iptvSources: {
      list: () => ipcRenderer.invoke(IPC_CHANNELS.iptvSources.list),
      create: (input) => ipcRenderer.invoke(IPC_CHANNELS.iptvSources.create, input),
      update: (id, input) => ipcRenderer.invoke(IPC_CHANNELS.iptvSources.update, id, input),
      reorder: (sourceIds) => ipcRenderer.invoke(IPC_CHANNELS.iptvSources.reorder, sourceIds),
      delete: (id) => ipcRenderer.invoke(IPC_CHANNELS.iptvSources.delete, id),
      clear: () => ipcRenderer.invoke(IPC_CHANNELS.iptvSources.clear),
      previewImport: (payload) => ipcRenderer.invoke(IPC_CHANNELS.iptvSources.previewImport, payload),
      confirmImport: (payload) => ipcRenderer.invoke(IPC_CHANNELS.iptvSources.confirmImport, payload),
      importFromFile: () => ipcRenderer.invoke(IPC_CHANNELS.iptvSources.importFromFile),
      exportToFile: () => ipcRenderer.invoke(IPC_CHANNELS.iptvSources.exportToFile),
    },
  }
}

import { ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc'
import type { AppApi, UpdateEvent } from '@shared/types'

export function createSystemApi(): Pick<AppApi, 'settings' | 'updates' | 'window' | 'shell'> {
  return {
    settings: {
      get: () => ipcRenderer.invoke(IPC_CHANNELS.settings.get),
      update: (input) => ipcRenderer.invoke(IPC_CHANNELS.settings.update, input),
      testGitHubProxy: (routeId, customPrefix) =>
        ipcRenderer.invoke(IPC_CHANNELS.settings.testGitHubProxy, routeId, customPrefix),
      initializeAppData: () => ipcRenderer.invoke(IPC_CHANNELS.settings.initializeAppData),
      exportAppData: (clientData) => ipcRenderer.invoke(IPC_CHANNELS.settings.exportAppData, clientData),
      importAppData: () => ipcRenderer.invoke(IPC_CHANNELS.settings.importAppData),
    },
    updates: {
      getCurrentVersion: () => ipcRenderer.invoke(IPC_CHANNELS.updates.getCurrentVersion),
      check: () => ipcRenderer.invoke(IPC_CHANNELS.updates.check),
      download: () => ipcRenderer.invoke(IPC_CHANNELS.updates.download),
      install: () => ipcRenderer.invoke(IPC_CHANNELS.updates.install),
      onUpdateEvent: (listener) => subscribe(IPC_CHANNELS.updates.event, listener),
    },
    window: {
      isMaximized: () => ipcRenderer.invoke(IPC_CHANNELS.window.isMaximized),
      toggleMaximize: () => ipcRenderer.invoke(IPC_CHANNELS.window.toggleMaximize),
    },
    shell: { openExternal: (url) => ipcRenderer.invoke(IPC_CHANNELS.shell.openExternal, url) },
  }
}

function subscribe(channel: string, listener: (event: UpdateEvent) => void): () => void {
  const handler = (_event: IpcRendererEvent, payload: UpdateEvent): void => listener(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

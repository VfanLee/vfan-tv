import { ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc'
import type { AppApi, MiniWindowPlaybackExit, UpdateEvent } from '@shared/types'

// 系统能力按白名单暴露，不向 renderer 透传 ipcRenderer 或任意 channel 调用权。
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
      enterMiniWindowMode: (context) => ipcRenderer.invoke(IPC_CHANNELS.window.enterMiniWindowMode, context),
      getMiniWindowPlayback: () => ipcRenderer.invoke(IPC_CHANNELS.window.getMiniWindowPlayback),
      updateMiniWindowPlayback: (input) => ipcRenderer.invoke(IPC_CHANNELS.window.updateMiniWindowPlayback, input),
      resizeMiniWindow: (input) => ipcRenderer.invoke(IPC_CHANNELS.window.resizeMiniWindow, input),
      moveMiniWindow: (input) => ipcRenderer.invoke(IPC_CHANNELS.window.moveMiniWindow, input),
      getMiniWindowAlwaysOnTop: (sessionId) =>
        ipcRenderer.invoke(IPC_CHANNELS.window.getMiniWindowAlwaysOnTop, sessionId),
      setMiniWindowAlwaysOnTop: (sessionId, enabled) =>
        ipcRenderer.invoke(IPC_CHANNELS.window.setMiniWindowAlwaysOnTop, sessionId, enabled),
      exitMiniWindowMode: (input) => ipcRenderer.invoke(IPC_CHANNELS.window.exitMiniWindowMode, input),
      onMiniWindowModeExit: (listener) =>
        subscribe<MiniWindowPlaybackExit>(IPC_CHANNELS.window.miniWindowModeExit, listener),
    },
    shell: { openExternal: (url) => ipcRenderer.invoke(IPC_CHANNELS.shell.openExternal, url) },
  }
}

function subscribe<T extends UpdateEvent | MiniWindowPlaybackExit>(
  channel: string,
  listener: (event: T) => void,
): () => void {
  const handler = (_event: IpcRendererEvent, payload: T): void => listener(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

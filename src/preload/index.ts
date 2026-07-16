import { contextBridge } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { AppApi } from '@shared/types'
import { createLibraryApi } from './api/library'
import { createMediaApi } from './api/media'
import { createSourcesApi } from './api/sources'
import { createSystemApi } from './api/system'

const api: AppApi = {
  ...createSourcesApi(),
  ...createLibraryApi(),
  ...createMediaApi(),
  ...createSystemApi(),
}

const electronProcess = process as NodeJS.Process & { contextIsolated?: boolean }

if (electronProcess.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  const target = window as Window & typeof globalThis & { electron: typeof electronAPI; api: typeof api }
  target.electron = electronAPI
  target.api = api
}

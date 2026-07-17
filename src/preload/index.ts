import { contextBridge } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { AppApi } from '@shared/types'
import { createLibraryApi } from './api/library'
import { createMediaApi } from './api/media'
import { createSourcesApi } from './api/sources'
import { createSystemApi } from './api/system'

// preload 是 renderer 与 main 之间的唯一桥梁；仅聚合经过白名单约束的领域 API。
const api: AppApi = {
  ...createSourcesApi(),
  ...createLibraryApi(),
  ...createMediaApi(),
  ...createSystemApi(),
}

const electronProcess = process as NodeJS.Process & { contextIsolated?: boolean }

if (electronProcess.contextIsolated) {
  try {
    // contextIsolation 开启时必须使用 contextBridge，不能直接向 window 写入特权对象。
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

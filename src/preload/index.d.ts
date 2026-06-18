import { ElectronAPI } from '@electron-toolkit/preload'
import type { AppApi } from '@shared/types'

declare global {
  interface Window {
    electron: ElectronAPI
    api?: AppApi
  }
}

import type { ApplicationContext } from '../app/composition-root'
import { registerAppDataIpc } from '../modules/app-data/ipc'
import { registerHomeIpc } from '../modules/home/ipc'
import { registerLibraryIpc } from '../modules/library/ipc'
import { registerLiveSourcesIpc } from '../modules/live-sources/ipc'
import { registerMediaIpc } from '../modules/media/ipc'
import { registerSettingsIpc } from '../modules/settings/ipc'
import { registerSourcesIpc } from '../modules/sources/ipc'
import { registerUpdatesIpc } from '../modules/updates/ipc'
import { registerRadioIpc } from '../modules/radio/ipc'
import { registerShellIpc } from './shell'
import { registerWindowIpc } from './window'

// 仅负责聚合领域 handler；具体 IPC 行为应留在所属领域模块的 ipc.ts 中。
export function registerIpcHandlers(context: ApplicationContext): void {
  registerSourcesIpc(context)
  registerLiveSourcesIpc(context)
  registerHomeIpc(context)
  registerLibraryIpc(context)
  registerMediaIpc(context)
  registerRadioIpc(context)
  registerSettingsIpc(context)
  registerAppDataIpc(context)
  registerUpdatesIpc(context)
  registerWindowIpc(context)
  registerShellIpc(context)
}

import type { ApplicationContext } from '../app/composition-root'
import { registerAppDataIpc } from '../modules/app-data/ipc'
import { registerHomeIpc } from '../modules/home/ipc'
import { registerLibraryIpc } from '../modules/library/ipc'
import { registerLiveSourcesIpc } from '../modules/live-sources/ipc'
import { registerMediaIpc } from '../modules/media/ipc'
import { registerSettingsIpc } from '../modules/settings/ipc'
import { registerSourcesIpc } from '../modules/sources/ipc'
import { registerUpdatesIpc } from '../modules/updates/ipc'
import { registerShellIpc } from './shell'
import { registerWindowIpc } from './window'

export function registerIpcHandlers(context: ApplicationContext): void {
  registerSourcesIpc(context)
  registerLiveSourcesIpc(context)
  registerHomeIpc(context)
  registerLibraryIpc(context)
  registerMediaIpc(context)
  registerSettingsIpc(context)
  registerAppDataIpc(context)
  registerUpdatesIpc(context)
  registerWindowIpc(context)
  registerShellIpc(context)
}
